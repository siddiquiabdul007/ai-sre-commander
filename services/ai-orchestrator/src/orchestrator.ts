import { KubernetesAgent } from '@ai-sre/agent-kubernetes';
import { ObservabilityAgent } from '@ai-sre/agent-observability';
import { ChangeIntelligenceAgent } from '@ai-sre/agent-change-intelligence';
import { RcaAgent } from '@ai-sre/agent-rca';
import { RemediationAgent } from '@ai-sre/agent-remediation';
import { IncidentRepository } from '@ai-sre/incident-engine';
import type { Incident, EvidenceObject } from '@ai-sre/event-schema';

export interface InvestigationResult {
  incident: Incident;
  evidence: EvidenceObject[];
  leadingHypothesisTitle: string;
  confidence: number;
  proposedAction: string;
}

export class AIOrchestrator {
  private k8sAgent = new KubernetesAgent();
  private obsAgent = new ObservabilityAgent();
  private changeAgent = new ChangeIntelligenceAgent();
  private rcaAgent = new RcaAgent();
  private remediationAgent = new RemediationAgent();

  constructor(private incidentRepo: IncidentRepository) {}

  public async runInvestigation(incidentId: string): Promise<InvestigationResult> {
    const incident = this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    // 1. Transition state machine to INVESTIGATING
    if (incident.state === 'DETECTED' || incident.state === 'TRIAGED') {
      this.incidentRepo.transitionState(incidentId, 'INVESTIGATING', 'AI multi-agent investigation commenced.');
    }

    // 2. Parallel agent evidence gathering
    const [k8sEvidence, obsEvidence, changeEvidence] = await Promise.all([
      this.k8sAgent.investigate(incidentId, {
        service: incident.service,
        namespace: incident.namespace,
        cluster: incident.cluster
      }),
      this.obsAgent.investigate(incidentId, {
        service: incident.service
      }),
      this.changeAgent.investigate(incidentId, {
        service: incident.service,
        targetVersion: 'v1.1.0'
      })
    ]);

    const allEvidence: EvidenceObject[] = [
      ...k8sEvidence,
      ...obsEvidence,
      ...changeEvidence
    ];

    // 3. RCA Agent: synthesize competing hypotheses & confidence scoring
    const { leadingHypothesis, hypotheses } = await this.rcaAgent.analyze(
      incidentId,
      incident.service,
      allEvidence
    );

    // 4. Remediation Agent: generate typed structured action proposal
    const remediationProposal = await this.remediationAgent.planRemediation(
      incidentId,
      incident.service,
      incident.namespace,
      incident.environment,
      leadingHypothesis
    );

    // 5. Update incident state machine and attach findings
    incident.leadingHypothesis = leadingHypothesis;
    incident.hypotheses = hypotheses;
    incident.remediationProposals = [remediationProposal];

    this.incidentRepo.transitionState(incidentId, 'DIAGNOSED', `Leading root cause identified with ${leadingHypothesis.confidence}% confidence.`);
    this.incidentRepo.transitionState(incidentId, 'REMEDIATION_PROPOSED', `Proposed action '${remediationProposal.action}' targeting ${remediationProposal.targetResource}.`);

    this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'AI_HYPOTHESIS',
      title: `AI Finding: ${leadingHypothesis.title}`,
      description: `Confidence: ${leadingHypothesis.confidence}%. Evidence: ${leadingHypothesis.supportingEvidenceCount} supporting / ${leadingHypothesis.contradictoryEvidenceCount} contradictory.`,
      data: {
        hypothesisId: leadingHypothesis.id,
        confidence: leadingHypothesis.confidence
      }
    });

    this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'REMEDIATION_PROPOSED',
      title: `Remediation Proposed: ${remediationProposal.action}`,
      description: `Risk: ${remediationProposal.risk}. Expected Impact: ${remediationProposal.expectedImpact}`,
      data: remediationProposal
    });

    this.incidentRepo.updateIncident(incident);

    return {
      incident,
      evidence: allEvidence,
      leadingHypothesisTitle: leadingHypothesis.title,
      confidence: leadingHypothesis.confidence,
      proposedAction: remediationProposal.action
    };
  }
}
