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
  'TRIAGED',
  'INVESTIGATING',
  'DIAGNOSED',
  'REMEDIATION_PROPOSED',
  'AWAITING_APPROVAL',
  'EXECUTING',
  'VERIFYING',
  'RESOLVED',
  'ESCALATED',
  'POSTMORTEM'
]);
export type IncidentState = z.infer<typeof IncidentStateEnum>;

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
  rejectionReason: z.string().optional()
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
