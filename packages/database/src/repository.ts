import { PrismaClient, getPrismaClient } from './index.js';
import {
  IncidentStateMachine,
  type Incident,
  type IncidentState,
  type IncidentSeverity,
  type NormalizedEvent,
  type EvidenceObject,
  type RemediationProposal
} from '@ai-sre/event-schema';

export interface CreateIncidentInput {
  tenantId?: string;
  title: string;
  service: string;
  severity?: IncidentSeverity;
  environment?: string;
  cluster?: string;
  namespace?: string;
  initialEvent?: NormalizedEvent;
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

    const created = await this.prisma.incident.create({
      data: {
        tenantId,
        title: data.title,
        service: data.service,
        severity,
        environment,
        cluster,
        namespace,
        state: 'DETECTED',
        timeline: {
          create: [
            {
              type: 'STATE_CHANGE',
              title: `Incident DETECTED: ${data.title}`,
              description: `Incident automatically opened with severity ${severity} on service ${data.service}.`
            },
            ...(data.initialEvent ? [{
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
        proposals: true
      }
    });

    return this.mapToDomainIncident(created);
  }

  public async getIncident(id: string): Promise<Incident | null> {
    const found = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        timeline: true,
        evidence: true,
        proposals: true
      }
    });

    if (!found) return null;
    return this.mapToDomainIncident(found);
  }

  public async listIncidents(tenantId?: string): Promise<Incident[]> {
    const incidents = await this.prisma.incident.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        timeline: true,
        evidence: true,
        proposals: true
      }
    });

    return incidents.map(inc => this.mapToDomainIncident(inc));
  }

  public async transitionState(incidentId: string, targetState: IncidentState, reason?: string): Promise<Incident> {
    const current = await this.prisma.incident.findUnique({ where: { id: incidentId } });
    if (!current) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    // Enforce FSM transition rules at persistence boundary (PRD §19)
    IncidentStateMachine.assertTransition(incidentId, current.state as IncidentState, targetState);

    const previousState = current.state;
    const now = new Date();

    const updated = await this.prisma.incident.update({
      where: { id: incidentId },
      data: {
        state: targetState,
        updatedAt: now,
        timeline: {
          create: {
            type: 'STATE_CHANGE',
            title: `State changed: ${previousState} ➔ ${targetState}`,
            description: reason || `Transitioned to ${targetState}.`
          }
        }
      },
      include: {
        timeline: true,
        evidence: true,
        proposals: true
      }
    });

    return this.mapToDomainIncident(updated);
  }

  public async addEvidence(incidentId: string, ev: EvidenceObject): Promise<void> {
    await this.prisma.evidenceRecord.create({
      data: {
        id: ev.id,
        incidentId,
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

  public async recordProposal(proposal: RemediationProposal): Promise<{ isDuplicate: boolean; id: string }> {
    try {
      const created = await this.prisma.remediationRecord.create({
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
      });
      return { isDuplicate: false, id: created.id };
    } catch (error: any) {
      // P2002 is Prisma's unique constraint violation error code
      if (error.code === 'P2002' || error.message?.includes('idempotencyKey')) {
        return { isDuplicate: true, id: proposal.id };
      }
      throw error;
    }
  }

  public async getProposalByIdempotencyKey(key: string): Promise<any | null> {
    return this.prisma.remediationRecord.findUnique({
      where: { idempotencyKey: key }
    });
  }

  public async getProposals(incidentId: string): Promise<any[]> {
    return this.prisma.remediationRecord.findMany({
      where: { incidentId },
      orderBy: { createdAt: 'desc' }
    });
  }

  public async updateProposalStatus(proposalId: string, status: string): Promise<void> {
    await this.prisma.remediationRecord.update({
      where: { id: proposalId },
      data: { status, updatedAt: new Date() }
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
  }): Promise<void> {
    await this.prisma.timelineEntry.create({
      data: {
        incidentId,
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
      data: event.payload as any
    });
  }

  public async updateIncident(incident: Incident): Promise<Incident> {
    const updated = await this.prisma.incident.update({
      where: { id: incident.id },
      data: {
        state: incident.state,
        severity: incident.severity,
        updatedAt: new Date()
      },
      include: {
        timeline: true,
        evidence: true,
        proposals: true
      }
    });

    return this.mapToDomainIncident(updated);
  }

  public async recordAuditEntry(entry: {
    tenant: string;
    actor: string;
    action: string;
    targetResource: string;
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
      payloadHash: r.payloadHash,
      previousHash: r.previousHash,
      hash: r.hash,
      metadata: r.metadata
    }));
  }

  /**
   * Performs a live SELECT 1 database ping to verify PostgreSQL connectivity.
   */
  public async ping(): Promise<boolean> {
    try {
      const res = await this.prisma.$queryRawUnsafe('SELECT 1 as alive');
      return Array.isArray(res) && res.length > 0;
    } catch (err) {
      return false;
    }
  }

  private mapToDomainIncident(raw: any): Incident {
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
      createdAt: raw.createdAt.toISOString(),
      updatedAt: raw.updatedAt.toISOString(),
      hypotheses: [],
      remediationProposals: (raw.proposals || []).map((p: any) => ({
        id: p.id,
        incidentId: p.incidentId,
        action: p.action,
        targetResource: p.targetResource,
        parameters: p.parameters,
        riskAssessment: p.riskAssessment,
        status: p.status,
        idempotencyKey: p.idempotencyKey,
        createdAt: p.createdAt.toISOString()
      })),
      mttdSeconds: 120,
      errorBudgetImpactPercent: 1.4,
      eventIds: []
    };
  }
}

