import { VerificationAgent, type VerificationResult } from '@ai-sre/agent-verification';
import { IncidentRepository } from '@ai-sre/incident-engine';
import type { Incident } from '@ai-sre/event-schema';

export class VerificationService {
  private verificationAgent = new VerificationAgent();

  constructor(private incidentRepo: IncidentRepository) {}

  public async verifyIncidentRecovery(incidentId: string): Promise<{
    incident: Incident;
    verification: VerificationResult;
  }> {
    const incident = this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const verification = await this.verificationAgent.verifyRecovery(
      incident.service,
      incident.namespace
    );

    this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'VERIFICATION',
      title: verification.verified ? 'Verification Passed: Health Restored' : 'Verification Inconclusive',
      description: verification.summary,
      data: verification.metrics
    });

    if (verification.verified) {
      this.incidentRepo.transitionState(incidentId, 'RESOLVED', 'All golden signals returned to baseline post-remediation.');
    } else {
      this.incidentRepo.transitionState(incidentId, 'ESCALATED', 'Post-remediation metrics did not normalize in expected window.');
    }

    this.incidentRepo.updateIncident(incident);

    return {
      incident,
      verification
    };
  }
}
