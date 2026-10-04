import { PrismaClient, getPrismaClient } from './index.js';
import {
  IncidentStateMachine,
  type Incident,
  type IncidentState,
  type IncidentSeverity,
  type NormalizedEvent,
  type EvidenceObject,
  type RemediationProposal,
  type TenantContext,
  asError
} from '@ai-sre/event-schema';
import { createHash, randomUUID } from 'node:crypto';

export interface CreateIncidentInput {
  id?: string;
  tenantId?: string;
  title: string;
  service: string;
  severity?: IncidentSeverity;
  environment?: string;
  cluster?: string;
  namespace?: string;
  initialEvent?: NormalizedEvent;
}

export interface TransitionStateOptions {
  expectedVersion?: number;
  tenantId?: string;
}

export class PrismaIncidentRepository {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  public async createIncident(data: CreateIncidentInput): Promise<Incident> {
    const tenantId = data.tenantId || 'tenant-eu-default';
    const severity = (data.severity || 'SEV-1') as string;
    const environment = data.environment || 'production';
    const cluster = data.cluster || 'aks-aisre-prod';
    const namespace = data.namespace || 'sre-demo';

    let mttdSeconds: number | undefined;
    if (data.initialEvent?.timestamp) {
      const eventTime = new Date(data.initialEvent.timestamp).getTime();
      const nowTime = Date.now();
      mttdSeconds = Math.max(1, Math.round(Math.abs(nowTime - eventTime) / 1000));
    }

    const created = await this.prisma.incident.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        tenantId,
        title: data.title,
        service: data.service,
        severity,
        environment,
        cluster,
        namespace,
        state: 'DETECTED',
        version: 1,
        mttdSeconds,
        timeline: {
          create: [
            {
              tenantId,
              type: 'STATE_CHANGE',
              title: `Incident DETECTED: ${data.title}`,
              description: `Incident automatically opened with severity ${severity} on service ${data.service}.`
            },
            ...(data.initialEvent ? [{
              tenantId,
              type: 'EVENT',
              title: `Triggering Signal: ${data.initialEvent.title}`,
              description: data.initialEvent.description,
              data: data.initialEvent.payload as any
            }] : [])
          ]
        }
      },
      include: {
        timeline: true,
        evidence: true,
        proposals: true,
        remediationProposals: {
          include: {
            approvals: true,
            executions: true
          }
        },
        executions: true,
        verificationRuns: true
      }
    });

    return this.mapToDomainIncident(created);
  }

  public async getIncident(id: string, tenantId?: string): Promise<Incident | null> {
    const found = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        timeline: true,
        evidence: true,
        proposals: true,
        remediationProposals: {
          include: {
            approvals: true,
            executions: true
          }
        },
        executions: true,
        verificationRuns: true
      }
    });

    if (!found) return null;
    if (tenantId && found.tenantId !== tenantId) {
      const err = new Error(`Access denied: Incident ${id} belongs to different tenant`);
      (err as any).code = 'TENANT_FORBIDDEN';
      throw err;
    }

    return this.mapToDomainIncident(found);
  }

  public async listIncidents(tenantId?: string): Promise<Incident[]> {
    const incidents = await this.prisma.incident.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        timeline: true,
        evidence: true,
        proposals: true,
        remediationProposals: {
          include: {
            approvals: true,
            executions: true
          }
        },
        executions: true,
        verificationRuns: true
      }
    });

    return incidents.map(inc => this.mapToDomainIncident(inc));
  }

  /**
   * FR-P1-010: Indexed query for correlation scoped by tenant, service, environment, state and time.
   */
  public async findCandidateIncidents(filter: {
    tenantId: string;
    service?: string;
    environment?: string;
    since?: Date;
  }): Promise<Incident[]> {
    const where: any = {
      tenantId: filter.tenantId,
      state: {
        notIn: ['RESOLVED', 'POSTMORTEM']
      }
    };
    if (filter.service) {
      where.service = { equals: filter.service, mode: 'insensitive' };
    }
    if (filter.environment) {
      where.environment = filter.environment;
    }
    if (filter.since) {
      where.createdAt = { gte: filter.since };
    }

    const incidents = await this.prisma.incident.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        timeline: true,
        evidence: true,
        proposals: true,
        remediationProposals: true,
        executions: true,
        verificationRuns: true
      }
    });

    return incidents.map(inc => this.mapToDomainIncident(inc));
  }


  /**
   * Atomic transactional state transition asserting version and tenant preconditions.
   * FR-P0-002: Optimistic concurrency locking.
   */
  public async transitionState(
    incidentId: string,
    targetState: IncidentState,
    reason?: string,
    options?: TransitionStateOptions
  ): Promise<Incident> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.incident.findUnique({
        where: { id: incidentId }
      });

      if (!current) {
        throw new Error(`Incident ${incidentId} not found`);
      }

      if (options?.tenantId && current.tenantId !== options.tenantId) {
        const err = new Error(`Tenant mismatch: access to incident ${incidentId} forbidden`);
        (err as any).code = 'TENANT_FORBIDDEN';
        throw err;
      }

      if (options?.expectedVersion !== undefined && current.version !== options.expectedVersion) {
        const err = new Error(
          `Conflict: Incident ${incidentId} has version ${current.version}, expected ${options.expectedVersion}`
        );
        (err as any).code = 'STALE_STATE';
        (err as any).statusCode = 409;
        throw err;
      }

      if (current.state === targetState) {
        return current;
      }

      IncidentStateMachine.assertTransition(incidentId, current.state as IncidentState, targetState);

      const previousState = current.state;
      const now = new Date();
      let mttrSeconds = current.mttrSeconds;
      let resolvedAt = current.resolvedAt;

      if (targetState === 'RESOLVED' && !resolvedAt) {
        resolvedAt = now;
        mttrSeconds = Math.max(1, Math.round((now.getTime() - current.createdAt.getTime()) / 1000));
      }

      return tx.incident.update({
        where: { id: incidentId },
        data: {
          state: targetState,
          version: { increment: 1 },
          resolvedAt,
          mttrSeconds,
          updatedAt: now,
          timeline: {
            create: {
              tenantId: current.tenantId,
              type: 'STATE_CHANGE',
              title: `State changed: ${previousState} ➔ ${targetState}`,
              description: reason || `Transitioned to ${targetState}.`
            }
          }
        },
        include: {
          timeline: true,
          evidence: true,
          proposals: true,
          remediationProposals: {
            include: {
              approvals: true,
              executions: true
            }
          },
          executions: true,
          verificationRuns: true
        }
      });
    });

    return this.mapToDomainIncident(updated);
  }

  public async addEvidence(incidentId: string, ev: EvidenceObject, tenantId?: string): Promise<void> {
    const tid = tenantId || 'tenant-eu-default';
    await this.prisma.evidenceRecord.create({
      data: {
        id: ev.id,
        incidentId,
        tenantId: tid,
        type: ev.type,
        source: ev.source,
        title: ev.title,
        summary: ev.summary,
        confidence: ev.confidence,
        isContradictory: ev.isContradictory || false,
        provenance: ev.provenance as any,
        data: (ev as any).data || null
      }
    });
  }

  public async recordProposal(proposal: RemediationProposal, tenantId?: string): Promise<{ isDuplicate: boolean; id: string }> {
    const tid = tenantId || proposal.environment || 'tenant-eu-default';
    const computedRisk = proposal.risk;
    const proposalHash = createHash('sha256')
      .update(JSON.stringify({
        action: proposal.action,
        targetResource: proposal.targetResource,
        parameters: proposal.parameters,
        risk: computedRisk,
        environment: proposal.environment
      }))
      .digest('hex');

    try {
      const created = await this.prisma.remediationProposal.create({
        data: {
          id: proposal.id,
          incidentId: proposal.incidentId,
          tenantId: tid,
          action: proposal.action,
          targetResource: proposal.targetResource,
          parameters: proposal.parameters as any,
          computedRisk,
          modelRisk: (proposal as any).modelRisk || proposal.risk,
          proposalHash: (proposal as any).proposalHash || proposalHash,
          snapshotHash: (proposal as any).snapshotHash || (proposal as any).proposalHash || proposalHash,
          policyVersion: (proposal as any).policyVersion || 'v2.1-deterministic',
          evidenceSetHash: (proposal as any).evidenceSetHash || null,
          status: proposal.status || 'PROPOSED',
          idempotencyKey: proposal.idempotencyKey,
          expectedImpact: proposal.expectedImpact,
          blastRadius: proposal.blastRadius,
          proposedBy: proposal.proposedBy,
          reason: proposal.reason,
          expiresAt: (proposal as any).expiresAt
            ? new Date((proposal as any).expiresAt)
            : ((proposal as any).expiresInSeconds !== undefined
                ? new Date(Date.now() + (proposal as any).expiresInSeconds * 1000)
                : null)
        }
      });

      // Also mirror to legacy RemediationRecord for compatibility
      await this.prisma.remediationRecord.create({
        data: {
          id: proposal.id,
          incidentId: proposal.incidentId,
          action: proposal.action,
          targetResource: proposal.targetResource,
          parameters: proposal.parameters as any,
          riskAssessment: {
            risk: proposal.risk,
            blastRadius: proposal.blastRadius,
            expectedImpact: proposal.expectedImpact
          } as any,
          status: proposal.status,
          idempotencyKey: proposal.idempotencyKey
        }
      }).catch(() => {});

      return { isDuplicate: false, id: created.id };
    } catch (error: unknown) {
      const err = asError(error);
      const code = (error as any)?.code;
      if (code === 'P2002' || err.message.includes('idempotencyKey')) {
        return { isDuplicate: true, id: proposal.id };
      }
      throw error;
    }
  }

  public async createRemediationProposal(data: {
    incidentId: string;
    action: string;
    targetResource: string;
    parameters: Record<string, any>;
    computedRisk: string;
    proposalHash?: string;
    snapshotHash?: string;
    policyVersion?: string;
    evidenceSetHash?: string;
    tenantId?: string;
    expiresInSeconds?: number;
    expiresAt?: Date;
  }): Promise<any> {
    const id = randomUUID();
    const idempotencyKey = randomUUID();
    const expiresInSeconds = data.expiresInSeconds || 900;
    const expiresAt = data.expiresAt || new Date(Date.now() + expiresInSeconds * 1000);
    const proposal: any = {
      id,
      incidentId: data.incidentId,
      action: data.action,
      targetResource: data.targetResource,
      parameters: data.parameters,
      risk: data.computedRisk,
      computedRisk: data.computedRisk,
      environment: 'production',
      blastRadius: 'service-local',
      expectedImpact: 'Remediation',
      reason: 'Automated remediation',
      proposedBy: 'ai',
      idempotencyKey,
      proposalHash: data.proposalHash,
      snapshotHash: data.snapshotHash || data.proposalHash,
      policyVersion: data.policyVersion || 'v2.1-deterministic',
      evidenceSetHash: data.evidenceSetHash,
      expiresInSeconds,
      expiresAt,
      status: 'PROPOSED'
    };
    await this.recordProposal(proposal, data.tenantId);
    return this.prisma.remediationProposal.findUnique({ where: { id } });
  }

  public async getProposalByIdempotencyKey(key: string): Promise<any | null> {
    const modern = await this.prisma.remediationProposal.findUnique({
      where: { idempotencyKey: key },
      include: { approvals: true, executions: true }
    });
    if (modern) return modern;

    return this.prisma.remediationRecord.findUnique({
      where: { idempotencyKey: key }
    });
  }

  public async getProposal(
    ctxOrId: TenantContext | string,
    optionalProposalId?: string
  ): Promise<any | null> {
    const isDual = optionalProposalId !== undefined;
    const proposalId = isDual ? optionalProposalId : (ctxOrId as string);
    const tenantId = isDual
      ? (typeof ctxOrId === 'string' ? ctxOrId : ctxOrId.tenantId)
      : undefined;

    const modern = await this.prisma.remediationProposal.findUnique({
      where: { id: proposalId },
      include: { approvals: true, executions: true }
    });

    if (modern) {
      if (tenantId && modern.tenantId && modern.tenantId !== tenantId) {
        const err = new Error(`Access denied: Proposal ${proposalId} belongs to different tenant`);
        (err as any).code = 'TENANT_FORBIDDEN';
        throw err;
      }
      return modern;
    }

    const legacy = await this.prisma.remediationRecord.findUnique({
      where: { id: proposalId }
    });

    if (legacy) {
      if (tenantId && (legacy as any).tenantId && (legacy as any).tenantId !== tenantId) {
        const err = new Error(`Access denied: Proposal ${proposalId} belongs to different tenant`);
        (err as any).code = 'TENANT_FORBIDDEN';
        throw err;
      }
      return legacy;
    }

    return null;
  }

  public async getProposals(incidentId: string): Promise<any[]> {
    const modern = await this.prisma.remediationProposal.findMany({
      where: { incidentId },
      include: { approvals: true, executions: true },
      orderBy: { createdAt: 'desc' }
    });
    if (modern.length > 0) return modern;

    return this.prisma.remediationRecord.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'desc' }
    });
  }

  public async updateProposalStatus(proposalId: string, status: string): Promise<void> {
    await this.prisma.remediationProposal.update({
      where: { id: proposalId },
      data: { status, updatedAt: new Date() }
    }).catch(() => {});

    await this.prisma.remediationRecord.update({
      where: { id: proposalId },
      data: { status, updatedAt: new Date() }
    }).catch(() => {});
  }

  /**
   * FR-P1-003, FR-P1-004, FR-P1-005, FR-P1-006: Add Approval with multi-party quorum
   */
  public async addApproval(
    proposalIdOrPayload: string | {
      proposalId: string;
      approverSubject: string;
      approverName?: string;
      approverEmail?: string;
      role: string;
      justification: string;
      proposalHash: string;
      tenantId?: string;
      requiredQuorum?: number;
    },
    approvalPayload?: {
      approverSubject: string;
      approverName?: string;
      approverEmail?: string;
      role: string;
      justification: string;
      proposalHash: string;
      tenantId?: string;
      requiredQuorum?: number;
    }
  ): Promise<{ approval: any; quorumSatisfied: boolean; distinctApprovers: number }> {
    const proposalId = typeof proposalIdOrPayload === 'string'
      ? proposalIdOrPayload
      : proposalIdOrPayload.proposalId;
    const approval = typeof proposalIdOrPayload === 'string'
      ? approvalPayload!
      : proposalIdOrPayload;

    const tid = approval.tenantId || 'tenant-eu-default';
    const justificationHash = createHash('sha256').update(approval.justification).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.remediationProposal.findUnique({
        where: { id: proposalId },
        include: { approvals: true }
      });

      if (!proposal) {
        throw new Error(`Proposal ${proposalId} not found`);
      }

      // FR-P1-007: Tenant isolation verification
      if (proposal.tenantId && proposal.tenantId !== tid) {
        const err = new Error(`Tenant mismatch: access to proposal ${proposalId} forbidden`);
        (err as any).code = 'TENANT_FORBIDDEN';
        throw err;
      }

      // FR-P1-006: Approval expiry verification
      if (proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()) {
        const err = new Error(`Approval rejected: proposal ${proposalId} has expired`);
        (err as any).code = 'APPROVAL_EXPIRED';
        throw err;
      }

      // Check snapshot hash matches (FR-P1-005)
      if (proposal.proposalHash !== approval.proposalHash) {
        const err = new Error(`Proposal snapshot mismatch: parameters changed after generation`);
        (err as any).code = 'STALE_PROPOSAL';
        throw err;
      }

      // Check duplicate approval from same subject (FR-P1-004)
      const existing = proposal.approvals.find(a => a.approverSubject === approval.approverSubject);
      if (existing) {
        const err = new Error(`Duplicate approval: subject ${approval.approverSubject} has already approved`);
        (err as any).code = 'DUPLICATE_APPROVER';
        throw err;
      }

      // Record approval
      const createdApproval = await tx.approval.create({
        data: {
          proposalId,
          tenantId: tid,
          approverSubject: approval.approverSubject,
          approverName: approval.approverName,
          approverEmail: approval.approverEmail,
          role: approval.role,
          justificationHash,
          justification: approval.justification,
          proposalHash: approval.proposalHash,
          snapshotHash: (approval as any).snapshotHash || approval.proposalHash,
          deploymentUid: (approval as any).deploymentUid,
          resourceVersion: (approval as any).resourceVersion,
          targetReplicaSetUid: (approval as any).targetReplicaSetUid,
          targetTemplateHash: (approval as any).targetTemplateHash,
          expiresAt: proposal.expiresAt
        }
      });

      const requiredQuorum = approval.requiredQuorum || 1;
      const allApprovals = [...proposal.approvals, createdApproval];
      const distinctSubjects = new Set(allApprovals.map(a => a.approverSubject));
      const quorumSatisfied = distinctSubjects.size >= requiredQuorum;

      if (quorumSatisfied) {
        await tx.remediationProposal.update({
          where: { id: proposalId },
          data: {
            status: 'APPROVED',
            approvedBy: approval.approverEmail || approval.approverSubject,
            approvedAt: new Date(),
            updatedAt: new Date()
          }
        });
        await tx.remediationRecord.update({
          where: { id: proposalId },
          data: { status: 'APPROVED', updatedAt: new Date() }
        }).catch(() => {});
      }

      return {
        approval: createdApproval,
        quorumSatisfied,
        distinctApprovers: distinctSubjects.size
      };
    });
  }

  /**
   * FR-P0-003 & FR-P0-004: Exactly-one-claim execution protocol with lease.
   */
  public async claimExecution(data: {
    proposalId: string;
    incidentId: string;
    idempotencyKey: string;
    claimedBy: string;
    leaseDurationMs?: number;
    tenantId?: string;
  }): Promise<{ execution: any; isNewClaim: boolean; requiresReconciliation?: boolean }> {
    const leaseDuration = data.leaseDurationMs || 30000;
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseDuration);
    const tenantId = data.tenantId || 'tenant-eu-default';

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.execution.findUnique({
          where: { idempotencyKey: data.idempotencyKey }
        });

        if (!existing) {
          // First claim
          const created = await tx.execution.create({
            data: {
              proposalId: data.proposalId,
              incidentId: data.incidentId,
              tenantId,
              idempotencyKey: data.idempotencyKey,
              status: 'CLAIMED',
              attempt: 1,
              claimedBy: data.claimedBy,
              leaseUntil
            }
          });
          return { execution: created, isNewClaim: true };
        }

        // Existing execution record
        if (existing.status === 'SUCCEEDED' || existing.status === 'FAILED') {
          return { execution: existing, isNewClaim: false };
        }

        if (existing.status === 'EXECUTING' || existing.status === 'UNKNOWN') {
          return { execution: existing, isNewClaim: false, requiresReconciliation: true };
        }

        if (existing.status === 'CLAIMED') {
          const isLeaseActive = existing.leaseUntil && existing.leaseUntil.getTime() > now.getTime();
          if (isLeaseActive && existing.claimedBy !== data.claimedBy) {
            const err = new Error(`Execution lease currently held by ${existing.claimedBy} until ${existing.leaseUntil}`);
            (err as any).code = 'LEASE_HELD';
            (err as any).statusCode = 423;
            throw err;
          }

          // Renew or take over expired lease
          const renewed = await tx.execution.update({
            where: { id: existing.id },
            data: {
              claimedBy: data.claimedBy,
              leaseUntil,
              attempt: { increment: 1 },
              updatedAt: now
            }
          });
          return { execution: renewed, isNewClaim: true };
        }

        return { execution: existing, isNewClaim: false };
      }, { maxWait: 15000, timeout: 15000 });
    } catch (err: unknown) {
      const error = asError(err);
      const code = (err as any)?.code;
      if (code === 'P2002' || error.message.includes('Unique constraint failed') || code === 'P2034' || code === 'P2028') {
        const existing = await this.prisma.execution.findUnique({
          where: { idempotencyKey: data.idempotencyKey }
        });
        if (existing) {
          const isLeaseActive = existing.leaseUntil && existing.leaseUntil.getTime() > Date.now();
          if (isLeaseActive && existing.claimedBy !== data.claimedBy) {
            const leaseErr = new Error(`Execution lease currently held by ${existing.claimedBy} until ${existing.leaseUntil}`);
            (leaseErr as any).code = 'LEASE_HELD';
            (leaseErr as any).statusCode = 423;
            throw leaseErr;
          }
          return { execution: existing, isNewClaim: false };
        }
      }
      throw err;
    }
  }

  public async updateExecution(
    ctxOrId: TenantContext | string,
    executionIdOrData: string | {
      status?: string;
      desiredStateHash?: string;
      observedStateHash?: string;
      externalRequestId?: string;
      errorCode?: string;
      errorDetails?: any;
    },
    optionalData?: {
      status?: string;
      desiredStateHash?: string;
      observedStateHash?: string;
      externalRequestId?: string;
      errorCode?: string;
      errorDetails?: any;
    }
  ): Promise<any> {
    const isCtxMode = optionalData !== undefined;
    const executionId = isCtxMode ? (executionIdOrData as string) : (ctxOrId as string);
    const data = isCtxMode ? optionalData : (executionIdOrData as any);
    const tenantId = isCtxMode
      ? (typeof ctxOrId === 'string' ? ctxOrId : ctxOrId.tenantId)
      : undefined;

    if (tenantId) {
      const existing = await this.prisma.execution.findUnique({
        where: { id: executionId }
      });
      if (existing && existing.tenantId !== tenantId) {
        const err = new Error(`Access denied: Execution ${executionId} belongs to different tenant`);
        (err as any).code = 'TENANT_FORBIDDEN';
        throw err;
      }
    }

    return this.prisma.execution.update({
      where: { id: executionId },
      data: {
        ...data,
        updatedAt: new Date()
      }
    });
  }

  public async getExecution(
    ctxOrId: TenantContext | string,
    optionalExecutionId?: string
  ): Promise<any | null> {
    const isDual = optionalExecutionId !== undefined;
    const executionId = isDual ? optionalExecutionId : (ctxOrId as string);
    const tenantId = isDual
      ? (typeof ctxOrId === 'string' ? ctxOrId : ctxOrId.tenantId)
      : undefined;

    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { verificationRuns: true }
    });

    if (!execution) return null;

    if (tenantId && execution.tenantId !== tenantId) {
      const err = new Error(`Access denied: Execution ${executionId} belongs to different tenant`);
      (err as any).code = 'TENANT_FORBIDDEN';
      throw err;
    }

    return execution;
  }

  public async recordVerificationRun(data: {
    incidentId: string;
    executionId?: string;
    tenantId?: string;
    status: string;
    summary: string;
    evidenceJson?: any;
    startTime?: Date;
    endTime?: Date;
  }): Promise<any> {
    return this.prisma.verificationRun.create({
      data: {
        incidentId: data.incidentId,
        executionId: data.executionId,
        tenantId: data.tenantId || 'tenant-eu-default',
        status: data.status,
        summary: data.summary,
        evidenceJson: data.evidenceJson || null,
        startTime: data.startTime || new Date(),
        endTime: data.endTime || new Date()
      }
    });
  }

  public async getEvidenceForIncident(incidentId: string): Promise<EvidenceObject[]> {
    const records = await this.prisma.evidenceRecord.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'asc' }
    });

    return records.map(r => ({
      id: r.id,
      incidentId: r.incidentId,
      type: r.type as any,
      source: r.source as any,
      title: r.title,
      summary: r.summary,
      confidence: r.confidence,
      isContradictory: r.isContradictory,
      provenance: r.provenance as any,
      data: (r.data as any) || {}
    }));
  }

  public async getTimeline(incidentId: string): Promise<any[]> {
    const entries = await this.prisma.timelineEntry.findMany({
      where: { incidentId },
      orderBy: { timestamp: 'asc' }
    });

    return entries.map(e => ({
      id: e.id,
      incidentId: e.incidentId,
      timestamp: e.timestamp.toISOString(),
      type: e.type,
      title: e.title,
      description: e.description,
      data: e.data
    }));
  }

  public async addTimelineEntry(incidentId: string, entry: {
    type: string;
    title: string;
    description: string;
    data?: any;
    tenantId?: string;
  }): Promise<void> {
    await this.prisma.timelineEntry.create({
      data: {
        incidentId,
        tenantId: entry.tenantId || 'tenant-eu-default',
        type: entry.type,
        title: entry.title,
        description: entry.description,
        data: entry.data || null
      }
    });
  }

  public async linkEvent(incidentId: string, event: NormalizedEvent): Promise<void> {
    await this.addTimelineEntry(incidentId, {
      type: 'EVENT',
      title: `Correlated Event: ${event.title}`,
      description: event.description,
      data: event.payload as any,
      tenantId: event.environment
    });
  }

  public async updateIncident(incident: Incident): Promise<Incident> {
    const current = await this.prisma.incident.findUnique({
      where: { id: incident.id },
      select: { state: true }
    });

    const data: any = {
      severity: incident.severity,
      mttdSeconds: incident.mttdSeconds,
      mttrSeconds: incident.mttrSeconds,
      errorBudgetImpactPercent: incident.errorBudgetImpactPercent,
      updatedAt: new Date()
    };

    // Preserve transactional state machine authority (FR-P0-002)
    if (current && current.state === incident.state) {
      data.state = incident.state;
    }

    const updated = await this.prisma.incident.update({
      where: { id: incident.id },
      data,
      include: {
        timeline: true,
        evidence: true,
        proposals: true,
        remediationProposals: {
          include: {
            approvals: true,
            executions: true
          }
        },
        executions: true,
        verificationRuns: true
      }
    });

    return this.mapToDomainIncident(updated);
  }

  public async recordAuditEntry(entry: {
    tenant: string;
    actor: string;
    action: string;
    targetResource: string;
    proposalHash?: string;
    approvalIds?: string;
    executionId?: string;
    targetUid?: string;
    stateHashes?: string;
    payloadHash: string;
    previousHash: string;
    hash: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.prisma.auditRecord.create({
      data: {
        tenant: entry.tenant,
        actor: entry.actor,
        action: entry.action,
        targetResource: entry.targetResource,
        proposalHash: entry.proposalHash,
        approvalIds: entry.approvalIds,
        executionId: entry.executionId,
        targetUid: entry.targetUid,
        stateHashes: entry.stateHashes,
        payloadHash: entry.payloadHash,
        previousHash: entry.previousHash,
        hash: entry.hash,
        metadata: entry.metadata as any
      }
    });
  }

  public async getAuditTrail(limit = 100): Promise<any[]> {
    const records = await this.prisma.auditRecord.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit
    });

    return records.map(r => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      tenant: r.tenant,
      actor: r.actor,
      action: r.action,
      target: r.targetResource,
      targetResource: r.targetResource,
      proposalHash: r.proposalHash,
      approvalIds: r.approvalIds,
      executionId: r.executionId,
      targetUid: r.targetUid,
      stateHashes: r.stateHashes,
      payloadHash: r.payloadHash,
      previousHash: r.previousHash,
      hash: r.hash,
      metadata: r.metadata
    }));
  }

  public async ping(): Promise<boolean> {
    try {
      const res = await this.prisma.$queryRawUnsafe('SELECT 1 as alive');
      return Array.isArray(res) && res.length > 0;
    } catch (err) {
      return false;
    }
  }

  private mapToDomainIncident(raw: any): Incident {
    const proposalsList = raw.remediationProposals?.length
      ? raw.remediationProposals
      : raw.proposals || [];

    return {
      id: raw.id,
      tenantId: raw.tenantId,
      title: raw.title,
      service: raw.service,
      environment: raw.environment,
      cluster: raw.cluster,
      namespace: raw.namespace,
      severity: raw.severity as IncidentSeverity,
      state: raw.state as IncidentState,
      version: raw.version || 1,
      createdAt: raw.createdAt.toISOString(),
      updatedAt: raw.updatedAt.toISOString(),
      resolvedAt: raw.resolvedAt ? raw.resolvedAt.toISOString() : undefined,
      hypotheses: (() => {
        const aiTimeline = raw.timeline?.find((t: any) => t.type === 'AI_HYPOTHESIS' && !t.title?.includes('Failed'));
        if (!aiTimeline) return [];
        const d = aiTimeline.data as any;
        if (d?.hypotheses && Array.isArray(d.hypotheses) && d.hypotheses.length > 0) {
          return d.hypotheses;
        }
        return [{
          id: d?.hypothesisId || 'hyp-1',
          title: aiTimeline.title.replace(/^AI Finding:\s*/, ''),
          confidence: d?.confidence ?? 92,
          description: aiTimeline.description
        }];
      })(),
      leadingHypothesis: (() => {
        const aiTimeline = raw.timeline?.find((t: any) => t.type === 'AI_HYPOTHESIS' && !t.title?.includes('Failed'));
        if (!aiTimeline) return undefined;
        const d = aiTimeline.data as any;
        if (d?.leadingHypothesis) return d.leadingHypothesis;
        return {
          id: d?.hypothesisId || 'hyp-1',
          title: aiTimeline.title.replace(/^AI Finding:\s*/, ''),
          confidence: d?.confidence ?? 92,
          description: aiTimeline.description
        };
      })(),
      remediationProposals: proposalsList.map((p: any) => ({
        id: p.id,
        incidentId: p.incidentId,
        action: p.action,
        risk: p.computedRisk || p.riskAssessment?.risk || 'HIGH',
        environment: raw.environment,
        namespace: raw.namespace,
        targetResource: p.targetResource,
        parameters: p.parameters || {},
        expectedImpact: p.expectedImpact || p.riskAssessment?.expectedImpact || '',
        blastRadius: p.blastRadius || p.riskAssessment?.blastRadius || '',
        status: p.status,
        idempotencyKey: p.idempotencyKey,
        createdAt: p.createdAt.toISOString(),
        approvedBy: p.approvedBy,
        approvedAt: p.approvedAt ? p.approvedAt.toISOString() : undefined,
        rejectionReason: p.rejectionReason,
        proposedBy: p.proposedBy || 'ai-agent-remediation',
        reason: p.reason || ''
      })),
      mttdSeconds: raw.mttdSeconds ?? undefined,
      mttrSeconds: raw.mttrSeconds ?? undefined,
      errorBudgetImpactPercent: raw.errorBudgetImpactPercent ?? 0,
      eventIds: []
    };
  }
}
