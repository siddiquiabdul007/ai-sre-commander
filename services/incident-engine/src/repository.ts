import { randomUUID } from 'node:crypto';
import type { Incident, IncidentState, IncidentSeverity, NormalizedEvent } from '@ai-sre/event-schema';
import { IncidentStateMachine } from './state-machine.js';
import { PrismaIncidentRepository, getPrismaClient } from '@ai-sre/database';

export interface TimelineEntry {
  id: string;
  incidentId: string;
  timestamp: string;
  type: 'EVENT' | 'STATE_CHANGE' | 'AI_HYPOTHESIS' | 'REMEDIATION_PROPOSED' | 'APPROVAL' | 'EXECUTION' | 'VERIFICATION';
  title: string;
  description: string;
  data?: any;
}

export interface CreateIncidentOptions {
  title: string;
  service: string;
  severity?: IncidentSeverity;
  environment?: string;
  cluster?: string;
  namespace?: string;
  tenantId?: string;
  initialEvent?: NormalizedEvent;
}

export class IncidentRepository {
  private incidents: Map<string, Incident> = new Map();
  private timeline: Map<string, TimelineEntry[]> = new Map();
  private incidentEvents: Map<string, NormalizedEvent[]> = new Map();
  private prismaRepo: PrismaIncidentRepository | null = null;
  private incidentWriteQueues: Map<string, Promise<any>> = new Map();

  constructor(prismaRepo?: PrismaIncidentRepository | null) {
    if (prismaRepo !== undefined) {
      this.prismaRepo = prismaRepo;
    } else if (process.env.DATABASE_URL) {
      try {
        this.prismaRepo = new PrismaIncidentRepository(getPrismaClient());
      } catch (err) {
        console.warn('[IncidentRepository] Failed to initialize Prisma client, falling back to local memory store:', err);
      }
    }
  }

  private queueDbWrite(incidentId: string, writeFn: () => Promise<any>): void {
    if (!this.prismaRepo) return;
    const current = this.incidentWriteQueues.get(incidentId) || Promise.resolve();
    const next = current
      .then(async () => {
        await writeFn();
      })
      .catch((err) => {
        console.warn(`[IncidentRepository] Async DB write queue error for ${incidentId}:`, err.message);
      });
    this.incidentWriteQueues.set(incidentId, next);
  }

  public getPrismaRepository(): PrismaIncidentRepository | null {
    return this.prismaRepo;
  }

  public createIncident(data: CreateIncidentOptions): Incident {
    const id = randomUUID();
    const now = new Date().toISOString();
    const tenantId = data.tenantId || (process.env.DEMO_MODE === 'true' ? 'tenant-eu-default' : 'tenant-default');

    let mttdSeconds: number | undefined;
    if (data.initialEvent?.timestamp) {
      const eventTime = new Date(data.initialEvent.timestamp).getTime();
      const nowTime = Date.now();
      mttdSeconds = Math.max(1, Math.round(Math.abs(nowTime - eventTime) / 1000));
    }

    const incident: Incident = {
      id,
      tenantId,
      title: data.title,
      service: data.service,
      environment: data.environment || 'production',
      cluster: data.cluster || 'aks-aisre-prod',
      namespace: data.namespace || 'sre-demo',
      severity: data.severity || 'SEV-1',
      state: 'DETECTED',
      version: 1,
      createdAt: now,
      updatedAt: now,
      hypotheses: [],
      remediationProposals: [],
      mttdSeconds,
      errorBudgetImpactPercent: 0,
      eventIds: data.initialEvent ? [data.initialEvent.id] : []
    };

    this.incidents.set(id, incident);
    this.timeline.set(id, []);
    this.incidentEvents.set(id, data.initialEvent ? [data.initialEvent] : []);

    // Durably persist to PostgreSQL first in the queue
    this.queueDbWrite(id, async () => {
      await this.prismaRepo!.createIncident({
        id,
        tenantId: incident.tenantId,
        title: incident.title,
        service: incident.service,
        severity: incident.severity,
        environment: incident.environment,
        cluster: incident.cluster,
        namespace: incident.namespace,
        initialEvent: data.initialEvent
      });
    });

    this.addTimelineEntry(id, {
      type: 'STATE_CHANGE',
      title: `Incident DETECTED: ${incident.title}`,
      description: `Incident automatically opened with severity ${incident.severity} on service ${incident.service}.`
    });

    if (data.initialEvent) {
      this.addTimelineEntry(id, {
        type: 'EVENT',
        title: `Triggering Signal: ${data.initialEvent.title}`,
        description: data.initialEvent.description,
        data: data.initialEvent.payload
      });
    }

    return incident;
  }

  public async createIncidentAsync(data: CreateIncidentOptions): Promise<Incident> {
    if (this.prismaRepo) {
      const created = await this.prismaRepo.createIncident(data);
      this.incidents.set(created.id, created);
      return created;
    }
    return this.createIncident(data);
  }

  public getIncident(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  public async getIncidentAsync(id: string, tenantId?: string): Promise<Incident | null> {
    const queue = this.incidentWriteQueues.get(id);
    if (queue) {
      await queue;
    }
    const local = this.incidents.get(id);
    if (this.prismaRepo) {
      try {
        const found = await this.prismaRepo.getIncident(id, tenantId);
        if (found) {
          if (!local || (found.version || 1) >= (local.version || 1)) {
            this.incidents.set(found.id, found);
            return found;
          }
          return local;
        }
      } catch (err: any) {
        console.warn(`[IncidentRepository] DB getIncident error for ${id}:`, err.message);
      }
    }
    if (!local) return null;
    if (tenantId && local.tenantId !== tenantId) return null;
    return local;
  }

  public listIncidents(): Incident[] {
    return Array.from(this.incidents.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public async listIncidentsAsync(tenantId?: string): Promise<Incident[]> {
    if (this.prismaRepo) {
      const list = await this.prismaRepo.listIncidents(tenantId);
      for (const item of list) {
        this.incidents.set(item.id, item);
      }
      return list;
    }
    const all = this.listIncidents();
    if (tenantId) {
      return all.filter(i => i.tenantId === tenantId);
    }
    return all;
  }

  public async findCandidateIncidents(filter: {
    tenantId: string;
    service?: string;
    environment?: string;
    since?: Date;
  }): Promise<Incident[]> {
    if (this.prismaRepo) {
      return this.prismaRepo.findCandidateIncidents(filter);
    }
    const all = Array.from(this.incidents.values());
    return all.filter(inc => {
      if (inc.tenantId !== filter.tenantId) return false;
      if (inc.state === 'RESOLVED' || inc.state === 'POSTMORTEM') return false;
      if (filter.service && inc.service.toLowerCase() !== filter.service.toLowerCase()) return false;
      if (filter.environment && inc.environment !== filter.environment) return false;
      if (filter.since && new Date(inc.createdAt).getTime() < filter.since.getTime()) return false;
      return true;
    });
  }


  public transitionState(
    incidentId: string,
    targetState: IncidentState,
    reason?: string,
    options?: { expectedVersion?: number; tenantId?: string }
  ): Incident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident with id ${incidentId} not found`);
    }

    if (options?.tenantId && incident.tenantId !== options.tenantId) {
      const err = new Error(`Tenant mismatch: access to incident ${incidentId} forbidden`);
      (err as any).code = 'TENANT_FORBIDDEN';
      throw err;
    }

    if (options?.expectedVersion !== undefined && incident.version !== options.expectedVersion) {
      const err = new Error(
        `Conflict: Incident ${incidentId} has version ${incident.version}, expected ${options.expectedVersion}`
      );
      (err as any).code = 'STALE_STATE';
      (err as any).statusCode = 409;
      throw err;
    }

    if (incident.state === targetState) {
      return incident;
    }

    IncidentStateMachine.assertTransition(incidentId, incident.state, targetState);

    const previousState = incident.state;
    incident.state = targetState;
    incident.version = (incident.version || 1) + 1;
    incident.updatedAt = new Date().toISOString();

    if (targetState === 'RESOLVED' && !incident.resolvedAt) {
      incident.resolvedAt = incident.updatedAt;
      const createdMs = new Date(incident.createdAt).getTime();
      const resolvedMs = new Date(incident.resolvedAt).getTime();
      incident.mttrSeconds = Math.round((resolvedMs - createdMs) / 1000);
    }

    this.addTimelineEntry(incidentId, {
      type: 'STATE_CHANGE',
      title: `State changed: ${previousState} ➔ ${targetState}`,
      description: reason || `Transitioned to ${targetState}.`
    });

    this.queueDbWrite(incidentId, async () => {
      await this.prismaRepo!.transitionState(incidentId, targetState, reason, options);
    });

    return incident;
  }

  public async transitionStateAsync(
    incidentId: string,
    targetState: IncidentState,
    reason?: string,
    options?: { expectedVersion?: number; tenantId?: string }
  ): Promise<Incident> {
    if (this.prismaRepo) {
      const updated = await this.prismaRepo.transitionState(incidentId, targetState, reason, options);
      this.incidents.set(updated.id, updated);
      return updated;
    }
    return this.transitionState(incidentId, targetState, reason, options);
  }

  public addTimelineEntry(
    incidentId: string,
    entry: Omit<TimelineEntry, 'id' | 'incidentId' | 'timestamp'>
  ): TimelineEntry {
    const fullEntry: TimelineEntry = {
      id: randomUUID(),
      incidentId,
      timestamp: new Date().toISOString(),
      ...entry
    };

    const list = this.timeline.get(incidentId) || [];
    list.push(fullEntry);
    this.timeline.set(incidentId, list);

    this.queueDbWrite(incidentId, async () => {
      await this.prismaRepo!.addTimelineEntry(incidentId, {
        type: entry.type,
        title: entry.title,
        description: entry.description,
        data: entry.data
      });
    });

    return fullEntry;
  }

  public getTimeline(incidentId: string): TimelineEntry[] {
    return this.timeline.get(incidentId) || [];
  }

  public linkEvent(incidentId: string, event: NormalizedEvent): void {
    const incident = this.incidents.get(incidentId);
    if (!incident) return;

    if (!incident.eventIds.includes(event.id)) {
      incident.eventIds.push(event.id);
    }

    const events = this.incidentEvents.get(incidentId) || [];
    events.push(event);
    this.incidentEvents.set(incidentId, events);

    this.addTimelineEntry(incidentId, {
      type: 'EVENT',
      title: `Correlated Event: ${event.title}`,
      description: event.description,
      data: { source: event.source, eventType: event.eventType }
    });

    this.queueDbWrite(incidentId, async () => {
      await this.prismaRepo!.linkEvent(incidentId, event);
    });
  }

  public getEvents(incidentId: string): NormalizedEvent[] {
    return this.incidentEvents.get(incidentId) || [];
  }

  public updateIncident(incident: Incident): void {
    incident.updatedAt = new Date().toISOString();
    this.incidents.set(incident.id, incident);

    this.queueDbWrite(incident.id, async () => {
      await this.prismaRepo!.updateIncident(incident);
    });
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
    const queue = this.incidentWriteQueues.get(data.incidentId);
    if (queue) {
      await queue;
    }
    if (this.prismaRepo) {
      return this.prismaRepo.recordVerificationRun(data);
    }
    return { id: `mock-vr-${Date.now()}`, ...data, createdAt: new Date() };
  }
}


