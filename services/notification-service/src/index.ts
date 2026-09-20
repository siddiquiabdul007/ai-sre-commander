import type { Incident, RemediationProposal } from '@ai-sre/event-schema';

export interface NotificationPayload {
  channel: 'slack' | 'teams' | 'webhook';
  recipient: string;
  subject: string;
  body: string;
  metadata?: Record<string, any>;
  dispatchedAt: string;
}

export class NotificationService {
  private dispatchHistory: NotificationPayload[] = [];

  public async notifyIncidentCreated(incident: Incident): Promise<NotificationPayload> {
    const payload: NotificationPayload = {
      channel: 'slack',
      recipient: '#sre-alerts-eu',
      subject: `🚨 [${incident.severity}] ${incident.title}`,
      body: `Incident detected on ${incident.service} (${incident.cluster}/${incident.namespace}). State: ${incident.state}. Investigation underway.`,
      metadata: { incidentId: incident.id, severity: incident.severity },
      dispatchedAt: new Date().toISOString()
    };

    this.dispatchHistory.push(payload);
    return payload;
  }

  public async notifyApprovalRequired(incident: Incident, proposal: RemediationProposal): Promise<NotificationPayload> {
    const payload: NotificationPayload = {
      channel: 'slack',
      recipient: '#sre-incident-commander',
      subject: `⚠️ [APPROVAL REQUIRED] ${proposal.risk} Action Proposed for ${incident.service}`,
      body: `AI Remediation proposes: ${proposal.action} targeting ${proposal.targetResource}. Expected impact: ${proposal.expectedImpact}. Please review and approve in SRE Console.`,
      metadata: { incidentId: incident.id, proposalId: proposal.id, risk: proposal.risk },
      dispatchedAt: new Date().toISOString()
    };

    this.dispatchHistory.push(payload);
    return payload;
  }

  public getHistory(): NotificationPayload[] {
    return [...this.dispatchHistory];
  }
}
