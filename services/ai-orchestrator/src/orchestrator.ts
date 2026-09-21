/**
 * AI Orchestrator — Multi-Agent Investigation System
 * 
 * PRD v2.0: Routes investigation through real LLM Gateway.
 * In live mode, RCA hypothesis generation uses real Gemini API calls.
 * In offline mode, uses deterministic rule-based agents (existing behavior).
 */

import { KubernetesAgent } from '@ai-sre/agent-kubernetes';
import { ObservabilityAgent } from '@ai-sre/agent-observability';
import { ChangeIntelligenceAgent } from '@ai-sre/agent-change-intelligence';
import { RcaAgent } from '@ai-sre/agent-rca';
import { RemediationAgent } from '@ai-sre/agent-remediation';
import { IncidentRepository } from '@ai-sre/incident-engine';
import type { Incident, EvidenceObject, Hypothesis } from '@ai-sre/event-schema';
import { LLMGateway } from './llm-gateway.js';
import { RcaResultSchema, RemediationPlanSchema } from './llm-schemas.js';

export interface InvestigationResult {
  incident: Incident;
  evidence: EvidenceObject[];
  leadingHypothesisTitle: string;
  confidence: number;
  proposedAction: string;
  llmMode: string;
  llmLatencyMs?: number;
}

export class AIOrchestrator {
  private k8sAgent = new KubernetesAgent();
  private obsAgent = new ObservabilityAgent();
  private changeAgent = new ChangeIntelligenceAgent();
  private rcaAgent = new RcaAgent();
  private remediationAgent = new RemediationAgent();
  private llmGateway: LLMGateway;

  constructor(private incidentRepo: IncidentRepository) {
    this.llmGateway = new LLMGateway();
  }

  public async runInvestigation(incidentId: string): Promise<InvestigationResult> {
    const incident = this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    // 1. Transition state machine to INVESTIGATING
    if (incident.state === 'DETECTED' || incident.state === 'TRIAGED') {
      this.incidentRepo.transitionState(incidentId, 'INVESTIGATING', 'AI multi-agent investigation commenced.');
    }

    // 2. Parallel agent evidence gathering (these remain deterministic — they gather data, not reason)
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

    // 3. RCA + Remediation: route through LLM in live mode, deterministic in offline
    let leadingHypothesis: Hypothesis;
    let hypotheses: Hypothesis[];
    let llmLatencyMs: number | undefined;
    let remediationProposal: any;

    if (this.llmGateway.getMode() === 'live') {
      // LIVE: Real LLM-driven RCA
      const rcaResult = await this.invokeLLMRca(incidentId, incident, allEvidence);
      leadingHypothesis = rcaResult.hypotheses[0];
      hypotheses = rcaResult.hypotheses;
      llmLatencyMs = rcaResult.latencyMs;

      // LIVE: Real LLM-driven remediation planning
      remediationProposal = await this.invokeLLMRemediation(
        incidentId, incident, leadingHypothesis
      );
    } else {
      // OFFLINE: Deterministic agents (existing behavior)
      const rcaOutput = await this.rcaAgent.analyze(incidentId, incident.service, allEvidence);
      leadingHypothesis = rcaOutput.leadingHypothesis;
      hypotheses = rcaOutput.hypotheses;

      remediationProposal = await this.remediationAgent.planRemediation(
        incidentId,
        incident.service,
        incident.namespace,
        incident.environment,
        leadingHypothesis
      );
    }

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
        confidence: leadingHypothesis.confidence,
        llmMode: this.llmGateway.getMode(),
        llmLatencyMs
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
      proposedAction: remediationProposal.action,
      llmMode: this.llmGateway.getMode(),
      llmLatencyMs
    };
  }

  /**
   * Invokes real LLM for root cause analysis.
   * Formats evidence as structured context and requests ranked hypotheses.
   */
  private async invokeLLMRca(
    incidentId: string,
    incident: Incident,
    evidence: EvidenceObject[]
  ): Promise<{ hypotheses: Hypothesis[]; latencyMs: number }> {
    // Format evidence as structured context for the LLM
    const evidenceContext = evidence.map(e => ({
      id: e.id,
      type: e.type,
      source: e.source,
      title: e.title,
      summary: e.summary,
      confidence: e.confidence,
      isContradictory: e.isContradictory,
      data: e.data
    }));

    const prompt = [
      `Analyze this incident and generate ranked root cause hypotheses.`,
      ``,
      `Incident: ${incident.title}`,
      `Service: ${incident.service}`,
      `Severity: ${incident.severity}`,
      `Environment: ${incident.environment}`,
      `Namespace: ${incident.namespace}`,
      ``,
      `Evidence items (reference by ID):`,
      JSON.stringify(evidenceContext, null, 2),
      ``,
      `Generate 2-4 hypotheses ranked by confidence. The leading hypothesis should`,
      `reference specific evidence IDs. Include at least one alternative hypothesis`,
      `with lower confidence.`
    ].join('\n');

    const response = await this.llmGateway.invoke({
      task: 'rca',
      prompt,
      context: JSON.stringify(evidenceContext),
      schema: RcaResultSchema,
      maxTokens: 4096
    });

    // Map LLM response to domain Hypothesis objects
    const hypotheses: Hypothesis[] = response.data.hypotheses.map((h, idx) => ({
      id: `hyp_llm_${idx + 1}`,
      rank: h.rank,
      title: h.title,
      rootCause: h.rootCause,
      confidence: h.confidence,
      supportingEvidenceCount: h.supportingEvidenceIds.length,
      contradictoryEvidenceCount: h.contradictoryEvidenceIds.length,
      supportingEvidenceIds: h.supportingEvidenceIds,
      contradictoryEvidenceIds: h.contradictoryEvidenceIds,
      explanation: h.explanation,
      proposedAction: h.proposedAction as Hypothesis['proposedAction'],
      targetRevision: h.targetRevision
    }));

    // Sort by confidence descending
    hypotheses.sort((a, b) => b.confidence - a.confidence);

    console.log(
      `[AIOrchestrator] LLM RCA complete | hypotheses=${hypotheses.length} | ` +
      `leading="${hypotheses[0]?.title}" | confidence=${hypotheses[0]?.confidence}% | ` +
      `latency=${response.latencyMs}ms`
    );

    return { hypotheses, latencyMs: response.latencyMs };
  }

  /**
   * Invokes real LLM for remediation planning.
   */
  private async invokeLLMRemediation(
    incidentId: string,
    incident: Incident,
    hypothesis: Hypothesis
  ): Promise<any> {
    const prompt = [
      `Plan a remediation for this incident based on the root cause analysis.`,
      ``,
      `Incident: ${incident.title}`,
      `Service: ${incident.service}`,
      `Environment: ${incident.environment}`,
      `Namespace: ${incident.namespace}`,
      ``,
      `Root Cause Hypothesis:`,
      `Title: ${hypothesis.title}`,
      `Root Cause: ${hypothesis.rootCause}`,
      `Confidence: ${hypothesis.confidence}%`,
      `Proposed Action: ${hypothesis.proposedAction || 'none specified'}`,
      ``,
      `Generate a safe, specific remediation plan. Consider blast radius and rollback.`
    ].join('\n');

    const response = await this.llmGateway.invoke({
      task: 'remediation_planning',
      prompt,
      context: JSON.stringify(hypothesis),
      schema: RemediationPlanSchema,
      maxTokens: 2048
    });

    const plan = response.data;

    // Map to domain RemediationProposal format
    const { randomUUID } = await import('node:crypto');
    return {
      id: randomUUID(),
      incidentId,
      action: plan.action,
      risk: plan.risk,
      environment: incident.environment,
      namespace: incident.namespace,
      targetResource: plan.targetResource,
      parameters: plan.parameters,
      expectedImpact: plan.expectedImpact,
      blastRadius: plan.blastRadius,
      status: 'PROPOSED' as const,
      proposedBy: 'ai-orchestrator',
      reason: `LLM-generated remediation plan (confidence: ${hypothesis.confidence}%)`,
      idempotencyKey: randomUUID(),
      createdAt: new Date().toISOString()
    };
  }
}
