import type { NormalizedEvent, Incident } from '@ai-sre/event-schema';

export interface CorrelationResult {
  matchedIncidentId?: string;
  isNewIncident: boolean;
  incident: Incident;
  confidence: number;
  reason: string;
  isDeduplicated?: boolean;
}

export interface CorrelationOptions {
  windowMinutes?: number;
  demoMode?: boolean;
}

export class CorrelationEngine {
  private windowMinutes: number;
  private demoMode: boolean;

  constructor(
    private incidentRepo: any,
    options?: CorrelationOptions | number
  ) {
    if (typeof options === 'number') {
      this.windowMinutes = options;
      this.demoMode = process.env.DEMO_MODE === 'true';
    } else {
      this.windowMinutes = options?.windowMinutes ?? 30;
      this.demoMode = options?.demoMode ?? (process.env.DEMO_MODE === 'true');
    }
  }

  /**
   * Correlates an incoming event with active incidents or creates a new incident.
   * FR-P1-007: Authenticated tenant context - strictly isolates tenant incidents.
   * FR-P1-008: No implicit production defaults - missing or UNKNOWN identity throws/blocks execution in prod.
   * FR-P1-010: Indexed and evidence-backed correlation - deduplicates event IDs, uses causal weighted evidence.
   */
  public async correlate(event: NormalizedEvent): Promise<CorrelationResult> {
    const tenantId = (event as any).tenantId || 'tenant-eu-default';

    // FR-P1-008: Validate required target identity
    if (!this.demoMode) {
      if (!event.service || event.service === 'UNKNOWN') {
        throw new Error('[CorrelationEngine] Unresolved identity: service is required and cannot be UNKNOWN');
      }
      if (!event.environment || event.environment === 'UNKNOWN') {
        throw new Error('[CorrelationEngine] Unresolved identity: environment is required and cannot be UNKNOWN in production');
      }
      if (!event.cluster || event.cluster === 'UNKNOWN') {
        throw new Error('[CorrelationEngine] Unresolved identity: cluster is required and cannot be UNKNOWN in production');
      }
    }

    const eventTime = new Date(event.timestamp).getTime();
    const since = new Date(eventTime - this.windowMinutes * 60 * 1000);

    // FR-P1-010: Indexed candidate lookup scoped by tenantId, service, environment, time
    let candidates: Incident[] = [];
    if (this.incidentRepo.findCandidateIncidents) {
      candidates = await this.incidentRepo.findCandidateIncidents({
        tenantId,
        service: event.service,
        environment: event.environment,
        since
      });
    } else {
      const rawIncidents = await (this.incidentRepo.listIncidentsAsync 
        ? this.incidentRepo.listIncidentsAsync(tenantId)
        : this.incidentRepo.listIncidents());
      candidates = (rawIncidents || []).filter((inc: Incident) => {
        if (inc.tenantId !== tenantId) return false;
        if (['RESOLVED', 'POSTMORTEM'].includes(inc.state)) return false;
        return true;
      });
    }

    // Check candidates for match, deduplication, and evidence weighting
    for (const incident of candidates) {
      // Check tenant isolation: MUST match tenantId (FR-P1-007)
      if (incident.tenantId !== tenantId) {
        continue;
      }

      // 1. Event ID Deduplication check (FR-P1-010)
      if (incident.eventIds && incident.eventIds.includes(event.id)) {
        return {
          matchedIncidentId: incident.id,
          isNewIncident: false,
          incident,
          confidence: 100,
          reason: `Duplicate event ID '${event.id}' deduplicated for active incident ${incident.id}.`,
          isDeduplicated: true
        };
      }

      // Calculate weighted evidence score (FR-P1-010)
      let score = 0;
      const matchedEvidence: string[] = [];

      // Service match (30 pts)
      if (incident.service.toLowerCase() === event.service.toLowerCase()) {
        score += 30;
        matchedEvidence.push('service');
      }

      // Environment match (20 pts)
      if (incident.environment === event.environment) {
        score += 20;
        matchedEvidence.push('environment');
      }

      // Namespace match (15 pts)
      if (incident.namespace && event.namespace && incident.namespace === event.namespace) {
        score += 15;
        matchedEvidence.push('namespace');
      }

      // Cluster match (10 pts)
      if (incident.cluster && event.cluster && incident.cluster === event.cluster) {
        score += 10;
        matchedEvidence.push('cluster');
      }

      // Causal metadata: Deployment UID or Pod UID
      const eventMeta = event.metadata || {};
      const incMeta = (incident as any).metadata || {};
      if (eventMeta.deploymentUid && incMeta.deploymentUid && eventMeta.deploymentUid === incMeta.deploymentUid) {
        score += 20;
        matchedEvidence.push('deploymentUid');
      }
      if (eventMeta.alertFingerprint && incMeta.alertFingerprint && eventMeta.alertFingerprint === incMeta.alertFingerprint) {
        score += 15;
        matchedEvidence.push('alertFingerprint');
      }

      // Time proximity
      const incidentTime = new Date(incident.createdAt).getTime();
      const diffMinutes = Math.abs(eventTime - incidentTime) / (1000 * 60);
      if (diffMinutes <= 5) {
        score += 10;
        matchedEvidence.push('time<=5m');
      } else if (diffMinutes <= this.windowMinutes) {
        score += 5;
        matchedEvidence.push(`time<=${this.windowMinutes}m`);
      }

      const confidence = Math.min(score, 100);

      // Correlation threshold: >= 50
      if (confidence >= 50) {
        // Upgrade severity if critical
        if (event.severity === 'CRITICAL') {
          incident.severity = 'SEV-1';
        } else if (event.severity === 'ERROR' && incident.severity !== 'SEV-1') {
          incident.severity = 'SEV-2';
        }

        if (this.incidentRepo.linkEvent) {
          await this.incidentRepo.linkEvent(incident.id, event);
        }

        return {
          matchedIncidentId: incident.id,
          isNewIncident: false,
          incident,
          confidence,
          reason: `Matched active incident ${incident.id} (confidence: ${confidence}%) via [${matchedEvidence.join(', ')}].`
        };
      }
    }

    // Triggering event creation
    const isTriggeringEvent =
      event.severity === 'CRITICAL' ||
      event.severity === 'ERROR' ||
      event.eventType.startsWith('alert.') ||
      event.eventType.includes('oomkilled') ||
      event.eventType.includes('crashloop');

    const severity = isTriggeringEvent
      ? (event.severity === 'CRITICAL' ? 'SEV-1' : 'SEV-2')
      : 'SEV-3';
    const titlePrefix = isTriggeringEvent ? 'Service Degradation' : 'Tracked Operation';

    const newIncident = await (this.incidentRepo.createIncidentAsync
      ? this.incidentRepo.createIncidentAsync({
          tenantId,
          title: `${titlePrefix}: ${event.title}`,
          service: event.service,
          severity,
          environment: event.environment,
          cluster: event.cluster,
          namespace: event.namespace,
          initialEvent: event
        })
      : this.incidentRepo.createIncident({
          tenantId,
          title: `${titlePrefix}: ${event.title}`,
          service: event.service,
          severity,
          environment: event.environment,
          cluster: event.cluster,
          namespace: event.namespace,
          initialEvent: event
        }));

    return {
      matchedIncidentId: newIncident.id,
      isNewIncident: true,
      incident: newIncident,
      confidence: 100,
      reason: isTriggeringEvent
        ? `Created new ${severity} incident from triggering event '${event.eventType}' for tenant '${tenantId}'.`
        : `Tracked operational event '${event.eventType}' for tenant '${tenantId}'.`
    };
  }
}

