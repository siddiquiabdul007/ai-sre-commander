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
  private webhookUrl = process.env.SLACK_WEBHOOK_URL;

  private async dispatch(payload: NotificationPayload): Promise<void> {
    if (this.webhookUrl) {
      try {
        const res = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `${payload.subject}\n${payload.body}`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*${payload.subject}*\n${payload.body}`
                }
              }
            ]
          }),
          signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) {
          console.warn(`[NotificationService] Slack webhook returned status ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[NotificationService] Slack webhook dispatch failed: ${err.message}`);
      }
    }
  }

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
    await this.dispatch(payload);
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
    await this.dispatch(payload);
    return payload;
  }

  public getHistory(): NotificationPayload[] {
    return [...this.dispatchHistory];
  }
}
