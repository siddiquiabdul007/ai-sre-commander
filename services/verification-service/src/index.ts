import { VerificationAgent, type VerificationResult } from '@ai-sre/agent-verification';
import type { Incident } from '@ai-sre/event-schema';

export class VerificationService {
  private verificationAgent: VerificationAgent;

  constructor(private incidentRepo: any, options?: { prometheusUrl?: string }) {
    this.verificationAgent = new VerificationAgent(options);
  }

  public async verifyIncidentRecovery(
    incidentId: string,
    executionId?: string,
    options?: { samplingWindowSeconds?: number }
  ): Promise<{
    incident: Incident;
    verification: VerificationResult;
    verificationRun?: any;
  }> {
    const incident = await (this.incidentRepo.getIncidentAsync
      ? this.incidentRepo.getIncidentAsync(incidentId)
      : this.incidentRepo.getIncident(incidentId));

    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const startTime = new Date();
    const verification = await this.verificationAgent.verifyRecovery(
      incident.service,
      incident.namespace,
      { samplingWindowSeconds: options?.samplingWindowSeconds ?? 20 }
    );
    const endTime = new Date();

    // Durably record the verification run
    let verificationRun;
    if (this.incidentRepo.recordVerificationRun) {
      verificationRun = await this.incidentRepo.recordVerificationRun({
        incidentId,
        executionId,
        tenantId: incident.tenantId,
        status: verification.verificationState,
        summary: verification.summary,
        evidenceJson: {
          metrics: verification.metrics,
          probes: verification.probes
        },
        startTime,
        endTime
      }).catch((err: any) => {
        console.warn(`[VerificationService] DB recordVerificationRun error:`, err.message);
      });
    }

    await this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'VERIFICATION',
      title: verification.verificationState === 'VERIFIED'
        ? 'Verification Passed: Health Restored'
        : verification.verificationState === 'UNKNOWN'
        ? 'Verification Inconclusive: Telemetry Unavailable or Invalid'
        : 'Verification Failed: Unhealthy Metrics Detected',
      description: verification.summary,
      data: {
        status: verification.verificationState,
        metrics: verification.metrics,
        probes: verification.probes
      }
    });

    // PRD §7.1 & §10 state machine:
    // From VERIFYING:
    // - VERIFIED -> RESOLVED
    // - NOT_RECOVERED -> NOT_RECOVERED (or ESCALATED)
    // - UNKNOWN -> UNKNOWN
    if (verification.verificationState === 'VERIFIED') {
      await this.incidentRepo.transitionState(incidentId, 'RESOLVED', 'All golden signals and pod health verified post-remediation.');
    } else if (verification.verificationState === 'UNKNOWN') {
      await this.incidentRepo.transitionState(incidentId, 'UNKNOWN', `Verification inconclusive: ${verification.summary}`);
    } else {
      await this.incidentRepo.transitionState(incidentId, 'NOT_RECOVERED', `Verification failed: ${verification.summary}`);
    }

    if (this.incidentRepo.updateIncident) {
      await this.incidentRepo.updateIncident(incident);
    }

    return {
      incident,
      verification,
      verificationRun
    };
  }
}

