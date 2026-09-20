import { randomUUID } from 'node:crypto';
import type { Incident, IncidentState, IncidentSeverity, NormalizedEvent } from '@ai-sre/event-schema';
import { IncidentStateMachine } from './state-machine.js';

export interface TimelineEntry {
  id: string;
  incidentId: string;
  timestamp: string;
  type: 'EVENT' | 'STATE_CHANGE' | 'AI_HYPOTHESIS' | 'REMEDIATION_PROPOSED' | 'APPROVAL' | 'EXECUTION' | 'VERIFICATION';
  title: string;
  description: string;
  data?: any;
}

export class IncidentRepository {
  private incidents: Map<string, Incident> = new Map();
  private timeline: Map<string, TimelineEntry[]> = new Map();
  private incidentEvents: Map<string, NormalizedEvent[]> = new Map();

  public createIncident(data: {
    title: string;
    service: string;
    severity?: IncidentSeverity;
    environment?: string;
    cluster?: string;
    namespace?: string;
    initialEvent?: NormalizedEvent;
  }): Incident {
    const id = randomUUID();
    const now = new Date().toISOString();

    const incident: Incident = {
      id,
      tenantId: 'tenant-eu-default',
      title: data.title,
      service: data.service,
      environment: data.environment || 'production',
      cluster: data.cluster || 'aks-primary-eu',
      namespace: data.namespace || 'payments',
      severity: data.severity || 'SEV-1',
      state: 'DETECTED',
      createdAt: now,
      updatedAt: now,
      hypotheses: [],
      remediationProposals: [],
      mttdSeconds: 120,
      errorBudgetImpactPercent: 1.4,
      eventIds: data.initialEvent ? [data.initialEvent.id] : []
    };

    this.incidents.set(id, incident);
    this.timeline.set(id, []);
    this.incidentEvents.set(id, data.initialEvent ? [data.initialEvent] : []);

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

  public getIncident(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  public listIncidents(): Incident[] {
    return Array.from(this.incidents.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public transitionState(incidentId: string, targetState: IncidentState, reason?: string): Incident {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error(`Incident with id ${incidentId} not found`);
    }

    IncidentStateMachine.assertTransition(incidentId, incident.state, targetState);

    const previousState = incident.state;
    incident.state = targetState;
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

    return incident;
  }

  public addTimelineEntry(incidentId: string, entry: Omit<TimelineEntry, 'id' | 'incidentId' | 'timestamp'>): TimelineEntry {
    const fullEntry: TimelineEntry = {
      id: randomUUID(),
      incidentId,
      timestamp: new Date().toISOString(),
      ...entry
    };

    const list = this.timeline.get(incidentId) || [];
    list.push(fullEntry);
    this.timeline.set(incidentId, list);
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
  }

  public getEvents(incidentId: string): NormalizedEvent[] {
    return this.incidentEvents.get(incidentId) || [];
  }

  public updateIncident(incident: Incident): void {
    incident.updatedAt = new Date().toISOString();
    this.incidents.set(incident.id, incident);
  }
}
