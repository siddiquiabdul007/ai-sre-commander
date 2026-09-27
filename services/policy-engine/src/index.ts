import type { RemediationProposal, RiskClass } from '@ai-sre/event-schema';
import { canApproveRisk, type UserRole } from '@ai-sre/auth';

export interface ActionCapability {
  action: string;
  description: string;
  supportedEnvironments: string[];
  requiredKubernetesVerbs: string[];
  deriveRisk: (context: {
    environment: string;
    targetResource: string;
    parameters?: Record<string, any>;
    blastRadius?: string;
  }) => RiskClass;
  requiresHumanApproval: (riskClass: RiskClass, environment: string) => boolean;
  requiredQuorum: (riskClass: RiskClass) => number;
  validateParameters: (params: Record<string, any> | undefined) => { valid: boolean; error?: string };
}

/**
 * FR-P1-002: Single Capability Registry shared by policy and execution.
 */
export const CAPABILITY_REGISTRY: Record<string, ActionCapability> = {
  rollback_deployment: {
    action: 'rollback_deployment',
    description: 'Rolls back a Deployment revision restoring complete PodTemplateSpec.',
    supportedEnvironments: ['production', 'staging', 'development'],
    requiredKubernetesVerbs: ['get', 'list', 'patch', 'update'],
    deriveRisk: (ctx) => {
      // Production rollback is always HIGH risk (FR-P1-001)
      if (ctx.environment.toLowerCase() === 'production') {
        return 'HIGH';
      }
      return 'MEDIUM';
    },
    requiresHumanApproval: (risk, env) => {
      return env.toLowerCase() === 'production' || risk === 'HIGH' || risk === 'CRITICAL';
    },
    requiredQuorum: (risk) => {
      return risk === 'CRITICAL' ? 2 : 1;
    },
    validateParameters: (params) => {
      if (!params) return { valid: true };
      if (params.targetRevision !== undefined && typeof params.targetRevision !== 'number') {
        return { valid: false, error: 'targetRevision must be a numeric revision number.' };
      }
      return { valid: true };
    }
  },

  restart_pod: {
    action: 'restart_pod',
    description: 'Deletes a target Pod by UID and namespace to trigger fresh controller recreation.',
    supportedEnvironments: ['production', 'staging', 'development'],
    requiredKubernetesVerbs: ['get', 'list', 'delete'],
    deriveRisk: (ctx) => {
      if (ctx.environment.toLowerCase() === 'production') {
        return 'MEDIUM';
      }
      return 'LOW';
    },
    requiresHumanApproval: (risk, env) => {
      if (risk === 'CRITICAL' || risk === 'HIGH') return true;
      return env.toLowerCase() === 'production';
    },
    requiredQuorum: () => 1,
    validateParameters: (params) => {
      if (params && params.replicas !== undefined) {
        return { valid: false, error: 'replicas parameter is not supported on restart_pod.' };
      }
      return { valid: true };
    }
  },

  scale_workload: {
    action: 'scale_workload',
    description: 'Scales Deployment replica count within strictly bounded parameters.',
    supportedEnvironments: ['production', 'staging', 'development'],
    requiredKubernetesVerbs: ['get', 'list', 'patch', 'update'],
    deriveRisk: (ctx) => {
      const replicas = ctx.parameters?.replicas;
      if (typeof replicas === 'number' && (replicas > 10 || replicas <= 0)) {
        return 'CRITICAL';
      }
      if (ctx.environment.toLowerCase() === 'production') {
        return 'HIGH';
      }
      return 'MEDIUM';
    },
    requiresHumanApproval: (risk, env) => {
      return env.toLowerCase() === 'production' || risk === 'HIGH' || risk === 'CRITICAL';
    },
    requiredQuorum: (risk) => {
      return risk === 'CRITICAL' ? 2 : 1;
    },
    validateParameters: (params) => {
      if (!params || typeof params.replicas !== 'number') {
        return { valid: false, error: 'scale_workload requires a numeric replicas parameter.' };
      }
      if (!Number.isInteger(params.replicas) || !Number.isFinite(params.replicas)) {
        return { valid: false, error: 'replicas must be a finite integer.' };
      }
      if (params.replicas < 1 || params.replicas > 20) {
        return { valid: false, error: 'replicas must be between 1 and 20.' };
      }
      return { valid: true };
    }
  }
};

export interface PolicyEvaluationResult {
  allowed: boolean;
  ruleEvaluated: string;
  riskClass: RiskClass;
  requiresHumanApproval: boolean;
  requiredQuorum: number;
  reason: string;
  policyVersion: string;
  requiredKubernetesVerbs: string[];
}

export class PolicyEngine {
  public static readonly POLICY_VERSION = 'v2.1-deterministic';

  /**
   * Evaluates if a remediation proposal can proceed and derives canonical risk.
   * FR-P1-001: Deterministic risk classification independent of untrusted proposal.risk metadata.
   */
  public evaluateProposal(proposal: RemediationProposal): PolicyEvaluationResult {
    const capability = CAPABILITY_REGISTRY[proposal.action];

    // Rule 1: Allow-list check against Capability Registry
    if (!capability) {
      return {
        allowed: false,
        ruleEvaluated: 'RULE_UNSUPPORTED_CAPABILITY',
        riskClass: proposal.risk || 'CRITICAL',
        requiresHumanApproval: true,
        requiredQuorum: 2,
        reason: `Action '${proposal.action}' is not in the approved remediation allow-list (unsupported by capability registry).`,
        policyVersion: PolicyEngine.POLICY_VERSION,
        requiredKubernetesVerbs: []
      };
    }

    // Rule 2: Environment constraint check
    const env = (proposal.environment || 'production').toLowerCase();
    if (!capability.supportedEnvironments.includes(env)) {
      return {
        allowed: false,
        ruleEvaluated: 'RULE_UNSUPPORTED_ENVIRONMENT',
        riskClass: 'CRITICAL',
        requiresHumanApproval: true,
        requiredQuorum: 2,
        reason: `Action '${proposal.action}' is not permitted in environment '${proposal.environment}'.`,
        policyVersion: PolicyEngine.POLICY_VERSION,
        requiredKubernetesVerbs: capability.requiredKubernetesVerbs
      };
    }

    // Rule 3: Parameter constraints validation
    const paramValidation = capability.validateParameters(proposal.parameters);
    if (!paramValidation.valid) {
      return {
        allowed: false,
        ruleEvaluated: 'RULE_PARAMETER_CONSTRAINTS_FAILED',
        riskClass: 'CRITICAL',
        requiresHumanApproval: true,
        requiredQuorum: 2,
        reason: paramValidation.error || 'Parameter validation failed.',
        policyVersion: PolicyEngine.POLICY_VERSION,
        requiredKubernetesVerbs: capability.requiredKubernetesVerbs
      };
    }

    // Rule 4: FR-P1-001: Deterministic risk derivation
    // Model risk is advisory only; canonical risk is derived from action, environment, parameters, blast radius
    const canonicalRisk = capability.deriveRisk({
      environment: proposal.environment,
      targetResource: proposal.targetResource,
      parameters: proposal.parameters,
      blastRadius: proposal.blastRadius
    });

    // The effective risk is the higher of canonical risk and model proposal risk (never lower)
    const riskRank: Record<RiskClass, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    const proposalRank = proposal.risk ? (riskRank[proposal.risk] || 1) : 1;
    const canonicalRank = riskRank[canonicalRisk];
    const effectiveRisk: RiskClass = proposalRank > canonicalRank ? proposal.risk : canonicalRisk;

    const requiresHumanApproval = capability.requiresHumanApproval(effectiveRisk, proposal.environment);
    const requiredQuorum = capability.requiredQuorum(effectiveRisk);

    if (effectiveRisk === 'CRITICAL') {
      return {
        allowed: true,
        ruleEvaluated: 'RULE_CRITICAL_MULTI_PARTY_QUORUM',
        riskClass: 'CRITICAL',
        requiresHumanApproval: true,
        requiredQuorum,
        reason: 'CRITICAL actions require multi-party quorum sign-off; autonomous execution is prohibited.',
        policyVersion: PolicyEngine.POLICY_VERSION,
        requiredKubernetesVerbs: capability.requiredKubernetesVerbs
      };
    }

    if (effectiveRisk === 'HIGH') {
      return {
        allowed: true,
        ruleEvaluated: 'RULE_HIGH_RISK_HUMAN_APPROVAL_REQUIRED',
        riskClass: 'HIGH',
        requiresHumanApproval: true,
        requiredQuorum,
        reason: 'HIGH risk action requires authenticated SRE operator approval before execution.',
        policyVersion: PolicyEngine.POLICY_VERSION,
        requiredKubernetesVerbs: capability.requiredKubernetesVerbs
      };
    }

    if (effectiveRisk === 'MEDIUM') {
      return {
        allowed: true,
        ruleEvaluated: 'RULE_MEDIUM_RISK_GATE',
        riskClass: 'MEDIUM',
        requiresHumanApproval,
        requiredQuorum,
        reason: requiresHumanApproval
          ? 'MEDIUM risk action in production requires human operator sign-off.'
          : 'MEDIUM risk action in non-production is eligible for automated execution.',
        policyVersion: PolicyEngine.POLICY_VERSION,
        requiredKubernetesVerbs: capability.requiredKubernetesVerbs
      };
    }

    return {
      allowed: true,
      ruleEvaluated: 'RULE_LOW_RISK_AUTO_EXECUTION',
      riskClass: 'LOW',
      requiresHumanApproval: false,
      requiredQuorum: 0,
      reason: 'LOW risk action is eligible for automated execution.',
      policyVersion: PolicyEngine.POLICY_VERSION,
      requiredKubernetesVerbs: capability.requiredKubernetesVerbs
    };
  }

  /**
   * Validates if a specific user role is authorized to approve this risk level
   */
  public authorizeApproval(role: UserRole, risk: RiskClass): boolean {
    return canApproveRisk(role, risk);
  }
}
