import { VerificationAgent, type VerificationResult } from '@ai-sre/agent-verification';
import { IncidentRepository } from '@ai-sre/incident-engine';
import type { Incident } from '@ai-sre/event-schema';

export class VerificationService {
  private verificationAgent = new VerificationAgent();

  constructor(private incidentRepo: any) {}

  public async verifyIncidentRecovery(incidentId: string): Promise<{
    incident: Incident;
    verification: VerificationResult;
  }> {
    const incident = await this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const verification = await this.verificationAgent.verifyRecovery(
      incident.service,
      incident.namespace
    );

    await this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'VERIFICATION',
      title: verification.verified ? 'Verification Passed: Health Restored' : 'Verification Inconclusive',
      description: verification.summary,
      data: verification.metrics
    });

    if (verification.verified) {
      await this.incidentRepo.transitionState(incidentId, 'RESOLVED', 'All golden signals returned to baseline post-remediation.');
    } else {
      await this.incidentRepo.transitionState(incidentId, 'ESCALATED', 'Post-remediation metrics did not normalize in expected window.');
    }

    await this.incidentRepo.updateIncident(incident);

    return {
      incident,
      verification
    };
  }
}
