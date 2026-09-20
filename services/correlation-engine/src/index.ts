import type { NormalizedEvent, Incident } from '@ai-sre/event-schema';
import { IncidentRepository } from '@ai-sre/incident-engine';

export interface CorrelationResult {
  matchedIncidentId?: string;
  isNewIncident: boolean;
  incident: Incident;
  confidence: number;
  reason: string;
}

export class CorrelationEngine {
  constructor(
    private incidentRepo: IncidentRepository,
    private windowMinutes: number = 30
  ) {}

  /**
   * Correlates an incoming event with active incidents or creates a new incident.
   */
  public correlate(event: NormalizedEvent): CorrelationResult {
    const activeIncidents: Incident[] = this.incidentRepo
      .listIncidents()
      .filter((inc: Incident) => !['RESOLVED', 'POSTMORTEM'].includes(inc.state));

    const eventTime = new Date(event.timestamp).getTime();

    // 1. Check for exact service and environment match within the time window
    for (const incident of activeIncidents) {
      if (
        incident.service.toLowerCase() === event.service.toLowerCase() &&
        incident.environment === event.environment
      ) {
        const incidentTime = new Date(incident.createdAt).getTime();
        const diffMinutes = Math.abs(eventTime - incidentTime) / (1000 * 60);

        if (diffMinutes <= this.windowMinutes) {
          this.incidentRepo.linkEvent(incident.id, event);
          return {
            matchedIncidentId: incident.id,
            isNewIncident: false,
            incident,
            confidence: 95,
            reason: `Matched active incident for service '${event.service}' within ${Math.round(diffMinutes)}m window.`
          };
        }
      }
    }

    // 2. If it's an error or critical alert and no active incident exists, trigger incident creation
    const isTriggeringEvent =
      event.severity === 'CRITICAL' ||
      event.severity === 'ERROR' ||
      event.eventType.startsWith('alert.') ||
      event.eventType.includes('oomkilled') ||
      event.eventType.includes('crashloop');

    if (isTriggeringEvent) {
      const newIncident = this.incidentRepo.createIncident({
        title: `Service Degradation: ${event.title}`,
        service: event.service,
        severity: event.severity === 'CRITICAL' ? 'SEV-1' : 'SEV-2',
        environment: event.environment,
        cluster: event.cluster,
        namespace: event.namespace,
        initialEvent: event
      });

      return {
        matchedIncidentId: newIncident.id,
        isNewIncident: true,
        incident: newIncident,
        confidence: 100,
        reason: `Created new ${newIncident.severity} incident from triggering event '${event.eventType}'.`
      };
    }

    // 3. For benign events (e.g. deployment or info) when no incident is active, create an informational tracked incident if requested
    const trackedIncident = this.incidentRepo.createIncident({
      title: `Tracked Operation: ${event.title}`,
      service: event.service,
      severity: 'SEV-3',
      environment: event.environment,
      cluster: event.cluster,
      namespace: event.namespace,
      initialEvent: event
    });

    return {
      matchedIncidentId: trackedIncident.id,
      isNewIncident: true,
      incident: trackedIncident,
      confidence: 80,
      reason: `Tracked operational event '${event.eventType}'.`
    };
  }
}
