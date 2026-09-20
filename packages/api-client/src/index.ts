import type {
  Incident,
  RemediationProposal,
  EvidenceObject,
  AuditEvent,
  NormalizedEvent
} from '@ai-sre/event-schema';

export interface PostmortemReport {
  incidentId: string;
  title: string;
  severity: string;
  impactDurationMinutes: number;
  executiveSummary: string;
  rootCauseAnalysis: string;
  triggerEvent: string;
  timeline: Array<{ timestamp: string; description: string; phase: string }>;
  contributingFactors: string[];
  correctiveActions: Array<{ action: string; owner: string; status: string; priority: string }>;
  evidenceCitations: Array<{ evidenceId: string; citation: string }>;
  generatedAt: string;
}

export interface ApiClientConfig {
  baseUrl: string;
  token?: string;
}

export class SreCommanderClient {
  private baseUrl: string;
  private token?: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error [${response.status}]: ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  // Incidents
  public async getIncidents(): Promise<Incident[]> {
    return this.fetch<Incident[]>('/api/incidents');
  }

  public async getIncident(id: string): Promise<Incident> {
    return this.fetch<Incident>(`/api/incidents/${id}`);
  }

  public async createIncident(data: Partial<Incident>): Promise<Incident> {
    return this.fetch<Incident>('/api/incidents', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  public async startInvestigation(incidentId: string): Promise<Incident> {
    return this.fetch<Incident>(`/api/incidents/${incidentId}/investigate`, {
      method: 'POST'
    });
  }

  // Evidence & Timeline
  public async getEvidence(incidentId: string): Promise<EvidenceObject[]> {
    return this.fetch<EvidenceObject[]>(`/api/incidents/${incidentId}/evidence`);
  }

  public async getTimeline(incidentId: string): Promise<Array<{ timestamp: string; title: string; type: string; details: any }>> {
    return this.fetch<any[]>(`/api/incidents/${incidentId}/timeline`);
  }

  // Remediations & Approvals
  public async createRemediationProposal(incidentId: string, proposal: Partial<RemediationProposal>): Promise<RemediationProposal> {
    return this.fetch<RemediationProposal>(`/api/incidents/${incidentId}/remediations`, {
      method: 'POST',
      body: JSON.stringify(proposal)
    });
  }

  public async approveRemediation(remediationId: string, justification?: string): Promise<{ success: boolean; remediation: RemediationProposal }> {
    return this.fetch<any>(`/api/remediations/${remediationId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ justification })
    });
  }

  public async rejectRemediation(remediationId: string, reason: string): Promise<{ success: boolean; remediation: RemediationProposal }> {
    return this.fetch<any>(`/api/remediations/${remediationId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  }

  public async executeRemediation(remediationId: string): Promise<{ success: boolean; executionId: string; status: string }> {
    return this.fetch<any>(`/api/remediations/${remediationId}/execute`, {
      method: 'POST'
    });
  }

  // Postmortem
  public async getPostmortem(incidentId: string): Promise<PostmortemReport> {
    return this.fetch<PostmortemReport>(`/api/incidents/${incidentId}/postmortem`);
  }

  // Audit
  public async getAuditEvents(limit = 100): Promise<AuditEvent[]> {
    return this.fetch<AuditEvent[]>(`/api/audit?limit=${limit}`);
  }

  // Ingest external signal
  public async ingestEvent(event: NormalizedEvent): Promise<{ accepted: boolean; eventId: string; incidentId?: string }> {
    return this.fetch<any>('/api/events', {
      method: 'POST',
      body: JSON.stringify(event)
    });
  }
}
