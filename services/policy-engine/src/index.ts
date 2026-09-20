import type { RemediationProposal, RiskClass } from '@ai-sre/event-schema';
import { canApproveRisk, type UserRole } from '@ai-sre/auth';

export interface PolicyEvaluationResult {
  allowed: boolean;
  ruleEvaluated: string;
  riskClass: RiskClass;
  requiresHumanApproval: boolean;
  reason: string;
}

export class PolicyEngine {
  // Allow-listed remediation actions (PRD §12 & §13)
  private allowedActions = new Set([
    'rollback_deployment',
    'restart_pod',
    'scale_workload',
    'cordon_node',
    'traffic_drain',
    'feature_flag_disable'
  ]);

  /**
   * Evaluates if a remediation proposal can proceed and whether it mandates human approval.
   */
  public evaluateProposal(proposal: RemediationProposal): PolicyEvaluationResult {
    // Rule 1: Allow-list check
    if (!this.allowedActions.has(proposal.action)) {
      return {
        allowed: false,
        ruleEvaluated: 'RULE_ALLOWLIST_REMEDIATION_ACTION',
        riskClass: proposal.risk,
        requiresHumanApproval: true,
        reason: `Action '${proposal.action}' is not in the approved remediation allow-list.`
      };
    }

    // Rule 2: Risk-based approval requirements (PRD §13.2)
    if (proposal.risk === 'CRITICAL') {
      return {
        allowed: true,
        ruleEvaluated: 'RULE_CRITICAL_MULTI_PARTY_GATE',
        riskClass: 'CRITICAL',
        requiresHumanApproval: true,
        reason: `CRITICAL actions require explicit elevated human sign-off; autonomous execution is strictly prohibited.`
      };
    }

    if (proposal.risk === 'HIGH') {
      return {
        allowed: true,
        ruleEvaluated: 'RULE_HIGH_RISK_HUMAN_APPROVAL_REQUIRED',
        riskClass: 'HIGH',
        requiresHumanApproval: true,
        reason: `HIGH risk actions (production rollback) require authenticated SRE approval.`
      };
    }

    if (proposal.risk === 'MEDIUM') {
      const isProduction = proposal.environment.toLowerCase() === 'production';
      return {
        allowed: true,
        ruleEvaluated: 'RULE_MEDIUM_RISK_ENVIRONMENT_GATE',
        riskClass: 'MEDIUM',
        requiresHumanApproval: isProduction,
        reason: isProduction
          ? `MEDIUM risk action in production requires human sign-off.`
          : `MEDIUM risk action in non-prod may auto-execute.`
      };
    }

    // LOW risk (e.g. restart unhealthy pod)
    return {
      allowed: true,
      ruleEvaluated: 'RULE_LOW_RISK_AUTO_EXECUTION',
      riskClass: 'LOW',
      requiresHumanApproval: false,
      reason: `LOW risk actions are eligible for automated execution under configured rate limits.`
    };
  }

  /**
   * Validates if a specific user role is authorized to approve this risk level
   */
  public authorizeApproval(role: UserRole, risk: RiskClass): boolean {
    return canApproveRisk(role, risk);
  }
}
