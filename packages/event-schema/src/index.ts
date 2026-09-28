import { z } from 'zod';

export const EventSourceEnum = z.enum([
  'kubernetes',
  'prometheus',
  'alertmanager',
  'sentry',
  'github',
  'azure',
  'manual',
  'ai_commander'
]);
export type EventSource = z.infer<typeof EventSourceEnum>;

export const EventSeverityEnum = z.enum([
  'INFO',
  'WARNING',
  'ERROR',
  'CRITICAL'
]);
export type EventSeverity = z.infer<typeof EventSeverityEnum>;

export const NormalizedEventSchema = z.object({
  id: z.string().uuid(),
  source: EventSourceEnum,
  eventType: z.string(), // e.g. "pod.oomkilled", "alert.firing", "deployment.promoted", "exception.unhandled"
  severity: EventSeverityEnum,
  timestamp: z.string().datetime(),
  environment: z.string().default('production'),
  service: z.string(),
  cluster: z.string().default('aks-primary-eu'),
  namespace: z.string().default('default'),
  entityId: z.string().optional(), // Pod name, deployment name, commit hash
  title: z.string(),
  description: z.string(),
  payload: z.record(z.any()),
  labels: z.record(z.string()).default({}),
  metadata: z.record(z.any()).default({})
});
export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

export const IncidentStateEnum = z.enum([
  'DETECTED',
  'CORRELATED',
  'TRIAGED',
  'INVESTIGATING',
  'DIAGNOSED',
  'PROPOSED',
  'REMEDIATION_PROPOSED',
  'AWAITING_APPROVAL',
  'APPROVED',
  'AUTO_EXECUTION_READY',
  'EXECUTING',
  'EXECUTION_FAILED',
  'VERIFYING',
  'NOT_RECOVERED',
  'UNKNOWN',
  'STALE',
  'RECONCILIATION_REQUIRED',
  'REPROPOSED',
  'REJECTED',
  'EXPIRED',
  'RESOLVED',
  'ESCALATED',
  'POSTMORTEM'
]);
export type IncidentState = z.infer<typeof IncidentStateEnum>;

export const ExecutionStateEnum = z.enum([
  'PENDING',
  'CLAIMED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
  'EXPIRED'
]);
export type ExecutionState = z.infer<typeof ExecutionStateEnum>;

export const CanonicalErrorCodeEnum = z.enum([
  'TARGET_NOT_FOUND',
  'TARGET_AMBIGUOUS',
  'STALE_TARGET',
  'STALE_PROPOSAL',
  'APPROVAL_EXPIRED',
  'APPROVAL_QUORUM_UNSATISFIED',
  'UNSUPPORTED_ACTION',
  'PARAMETER_REJECTED',
  'CREDENTIAL_SCOPE_INVALID',
  'DEPENDENCY_UNAVAILABLE',
  'LEASE_LOST',
  'UNKNOWN_EXTERNAL_OUTCOME',
  'VERIFICATION_UNKNOWN',
  'TENANT_FORBIDDEN',
  'RECONCILIATION_REQUIRED',
  'UNKNOWN'
]);
export type CanonicalErrorCode = z.infer<typeof CanonicalErrorCodeEnum>;

export const IncidentSeverityEnum = z.enum([
  'SEV-1',
  'SEV-2',
  'SEV-3',
  'SEV-4'
]);
export type IncidentSeverity = z.infer<typeof IncidentSeverityEnum>;

export const RiskClassEnum = z.enum([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
]);
export type RiskClass = z.infer<typeof RiskClassEnum>;

export const RemediationActionTypeEnum = z.enum([
  'rollback_deployment',
  'restart_pod',
  'scale_workload',
  'cordon_node',
  'traffic_drain',
  'feature_flag_disable'
]);
export type RemediationActionType = z.infer<typeof RemediationActionTypeEnum>;

export const RemediationStatusEnum = z.enum([
  'PROPOSED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXECUTING',
  'SUCCESS',
  'FAILED',
  'VERIFIED'
]);
export type RemediationStatus = z.infer<typeof RemediationStatusEnum>;

export const RemediationProposalSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string(),
  action: RemediationActionTypeEnum,
  risk: RiskClassEnum,
  environment: z.string(),
  namespace: z.string(),
  targetResource: z.string(),
  parameters: z.record(z.any()),
  expectedImpact: z.string(),
  blastRadius: z.string(),
  status: RemediationStatusEnum.default('PROPOSED'),
  proposedBy: z.string().default('ai-agent-remediation'),
  reason: z.string(),
  idempotencyKey: z.string().uuid(),
  createdAt: z.string().datetime(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
  rejectionReason: z.string().optional(),
  proposalHash: z.string().optional(),
  snapshotHash: z.string().optional(),
  policyVersion: z.string().optional(),
  evidenceSetHash: z.string().optional(),
  expiresAt: z.string().optional(),
  approvalSnapshot: z.any().optional()
});
export type RemediationProposal = z.infer<typeof RemediationProposalSchema>;

export const EvidenceTypeEnum = z.enum([
  'METRIC_ANOMALY',
  'K8S_EVENT',
  'GIT_COMMIT',
  'DEPLOYMENT_DIFF',
  'EXCEPTION_TRACE',
  'LOG_CLUSTER',
  'BASELINE_DEVIATION'
]);
export type EvidenceType = z.infer<typeof EvidenceTypeEnum>;

export const EvidenceObjectSchema = z.object({
  id: z.string().uuid(),
  incidentId: z.string(),
  type: EvidenceTypeEnum,
  source: EventSourceEnum,
  title: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(100),
  isContradictory: z.boolean().default(false),
  provenance: z.object({
    sourceSystem: z.string(),
    queryOrFilter: z.string().optional(),
    extractedAt: z.string().datetime(),
    untrustedInputHash: z.string()
  }),
  data: z.record(z.any())
});
export type EvidenceObject = z.infer<typeof EvidenceObjectSchema>;

export const HypothesisSchema = z.object({
  id: z.string(),
  rank: z.number().int().min(1),
  title: z.string(),
  rootCause: z.string(),
  confidence: z.number().min(0).max(100),
  supportingEvidenceCount: z.number().int().default(0),
  contradictoryEvidenceCount: z.number().int().default(0),
  supportingEvidenceIds: z.array(z.string()).default([]),
  contradictoryEvidenceIds: z.array(z.string()).default([]),
  explanation: z.string(),
  proposedAction: RemediationActionTypeEnum.optional(),
  targetRevision: z.union([z.string(), z.number()]).optional()
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const IncidentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().default('tenant-eu-default'),
  title: z.string(),
  service: z.string(),
  environment: z.string().default('production'),
  cluster: z.string().default('aks-primary-eu'),
  namespace: z.string().default('default'),
  severity: IncidentSeverityEnum,
  state: IncidentStateEnum,
  version: z.number().int().default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  leadingHypothesis: HypothesisSchema.optional(),
  hypotheses: z.array(HypothesisSchema).default([]),
  remediationProposals: z.array(RemediationProposalSchema).default([]),
  mttdSeconds: z.number().optional(),
  mttrSeconds: z.number().optional(),
  errorBudgetImpactPercent: z.number().default(0),
  eventIds: z.array(z.string()).default([])
});
export type Incident = z.infer<typeof IncidentSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  tenant: z.string(),
  actor: z.string(),
  actorType: z.enum(['USER', 'SYSTEM', 'AI_AGENT']),
  action: z.string(),
  target: z.string(),
  requestId: z.string().uuid(),
  incidentId: z.string().optional(),
  policyDecision: z.object({
    allowed: z.boolean(),
    ruleEvaluated: z.string(),
    riskClass: RiskClassEnum.optional(),
    requiresApproval: z.boolean()
  }).optional(),
  approvalId: z.string().optional(),
  modelMetadata: z.object({
    provider: z.string(),
    model: z.string(),
    promptHash: z.string(),
    tokenCount: z.number().optional()
  }).optional(),
  evidenceReferences: z.array(z.string()).default([]),
  executionResult: z.object({
    status: z.enum(['SUCCESS', 'FAILED', 'VERIFIED']),
    details: z.record(z.any())
  }).optional(),
  integrityMetadata: z.object({
    previousHash: z.string(),
    currentHash: z.string(),
    hashAlgorithm: z.literal('SHA-256')
  })
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * Valid transitions according to PRD §7.1 and backward-compatible states:
 */
export const ALLOWED_TRANSITIONS: Record<IncidentState, IncidentState[]> = {
  DETECTED: ['CORRELATED', 'TRIAGED', 'INVESTIGATING', 'RESOLVED'],
  CORRELATED: ['PROPOSED', 'INVESTIGATING', 'RESOLVED'],
  TRIAGED: ['INVESTIGATING', 'RESOLVED', 'PROPOSED', 'REMEDIATION_PROPOSED'],
  INVESTIGATING: ['DIAGNOSED', 'PROPOSED', 'REMEDIATION_PROPOSED', 'ESCALATED', 'RESOLVED'],
  DIAGNOSED: ['PROPOSED', 'REMEDIATION_PROPOSED', 'INVESTIGATING', 'ESCALATED'],
  PROPOSED: ['AWAITING_APPROVAL', 'AUTO_EXECUTION_READY', 'RESOLVED', 'REMEDIATION_PROPOSED', 'INVESTIGATING'],
  REMEDIATION_PROPOSED: ['AWAITING_APPROVAL', 'AUTO_EXECUTION_READY', 'EXECUTING', 'INVESTIGATING', 'RESOLVED'],
  AWAITING_APPROVAL: ['APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTING', 'REMEDIATION_PROPOSED', 'ESCALATED'],
  APPROVED: ['EXECUTING', 'STALE', 'REJECTED', 'AWAITING_APPROVAL'],
  AUTO_EXECUTION_READY: ['EXECUTING', 'AWAITING_APPROVAL', 'STALE'],
  EXECUTING: ['VERIFYING', 'EXECUTION_FAILED', 'UNKNOWN', 'STALE', 'ESCALATED'],
  EXECUTION_FAILED: ['REPROPOSED', 'INVESTIGATING', 'ESCALATED', 'POSTMORTEM'],
  VERIFYING: ['RESOLVED', 'NOT_RECOVERED', 'UNKNOWN', 'ESCALATED', 'REMEDIATION_PROPOSED'],
  NOT_RECOVERED: ['REPROPOSED', 'PROPOSED', 'ESCALATED', 'POSTMORTEM', 'INVESTIGATING'],
  UNKNOWN: ['VERIFYING', 'RECONCILIATION_REQUIRED', 'ESCALATED', 'NOT_RECOVERED', 'RESOLVED'],
  STALE: ['REPROPOSED', 'PROPOSED', 'INVESTIGATING', 'ESCALATED'],
  RECONCILIATION_REQUIRED: ['EXECUTING', 'VERIFYING', 'ESCALATED', 'UNKNOWN'],
  REPROPOSED: ['AWAITING_APPROVAL', 'AUTO_EXECUTION_READY', 'PROPOSED', 'INVESTIGATING'],
  REJECTED: ['PROPOSED', 'REPROPOSED', 'POSTMORTEM'],
  EXPIRED: ['PROPOSED', 'REPROPOSED', 'POSTMORTEM'],
  ESCALATED: ['INVESTIGATING', 'AWAITING_APPROVAL', 'RESOLVED', 'POSTMORTEM', 'REPROPOSED'],
  RESOLVED: ['POSTMORTEM', 'INVESTIGATING'],
  POSTMORTEM: []
};

export class IllegalStateTransitionError extends Error {
  constructor(public fromState: IncidentState, public toState: IncidentState, public incidentId: string) {
    super(`Illegal state transition for incident ${incidentId}: cannot transition from '${fromState}' to '${toState}'.`);
    this.name = 'IllegalStateTransitionError';
  }
}

export class IncidentStateMachine {
  public static canTransition(current: IncidentState, target: IncidentState): boolean {
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    return allowed.includes(target);
  }

  public static assertTransition(incidentId: string, current: IncidentState, target: IncidentState): void {
    if (!this.canTransition(current, target)) {
      throw new IllegalStateTransitionError(current, target, incidentId);
    }
  }
}

/**
 * FR-P1-007 / R6: Strongly typed immutable TenantContext for repository methods.
 */
export interface TenantContext {
  tenantId: string;
  subject: string;
  roles: readonly string[];
  authzVersion: string;
}

/**
 * FR-P1-005 / R7: State-bound approval snapshot contract.
 */
export interface ApprovalSnapshot {
  proposalHash: string;
  deploymentUid?: string;
  resourceVersion?: string;
  targetReplicaSetUid?: string;
  targetRevision?: number;
  targetTemplateHash?: string;
  evidenceSetHash?: string;
  policyVersion: string;
  approvedAt: string;
  expiresAt: string;
}

/**
 * R9: Narrowing helper to safely extract Error from unknown.
 */
export function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    const err = new Error((error as any).message);
    Object.assign(err, error);
    return err;
  }
  return new Error(String(error));
}

/**
 * R9: Explicit typed interfaces at system boundaries.
 */
export interface AuthContext {
  tenantId: string;
  subject: string;
  roles: readonly string[];
  authzVersion: string;
}

export interface IncidentRepositoryContract {
  createIncident(data: any): Promise<Incident>;
  getIncident(id: string, tenantId?: string): Promise<Incident | null>;
  listIncidents(tenantId?: string): Promise<Incident[]>;
  transitionState(id: string, targetState: IncidentState, reason: string, options?: { tenantId?: string; expectedVersion?: number }): Promise<Incident>;
  addTimelineEntry(incidentId: string, entry: any): Promise<any>;
}

export interface ExecutionRepositoryContract {
  claimExecution(data: {
    proposalId: string;
    incidentId: string;
    idempotencyKey: string;
    claimedBy: string;
    leaseDurationMs?: number;
    tenantId: string;
  }): Promise<{ execution: any; isNewClaim: boolean; requiresReconciliation?: boolean }>;
  getExecution(ctx: TenantContext | string, executionId: string): Promise<any | null>;
  updateExecution(ctx: TenantContext | string, executionId: string, data: any): Promise<any>;
}

export interface ProposalRepositoryContract {
  recordProposal(proposal: RemediationProposal, tenantId?: string): Promise<{ isDuplicate: boolean; id: string }>;
  getProposal(ctx: TenantContext | string, proposalId: string): Promise<any | null>;
  getProposals(incidentId: string, tenantId?: string): Promise<any[]>;
  updateProposalStatus(ctx: TenantContext | string, proposalId: string, status: string): Promise<void>;
}

export interface ApprovalRepositoryContract {
  addApproval(proposalIdOrPayload: any, approvalPayload?: any): Promise<{ approval: any; quorumSatisfied: boolean; distinctApprovers: number }>;
}

export interface EvidenceStoreContract {
  recordEvidence(incidentId: string, evidence: EvidenceObject, tenantId?: string): Promise<void>;
  getEvidenceForIncident(incidentId: string, tenantId?: string): Promise<EvidenceObject[]>;
}

export interface KubernetesMutationGateway {
  getDeployment(name: string): Promise<any>;
  rollbackDeployment(name: string, targetRevision?: number, options?: { expectedResourceVersion?: string; approvalSnapshot?: ApprovalSnapshot }): Promise<any>;
  scaleDeployment(name: string, replicas: number, options?: { expectedResourceVersion?: string }): Promise<any>;
  restartPod(podName: string, options?: { expectedUid?: string; expectedOwner?: string }): Promise<any>;
}

export * from './template-canonicalizer.js';

