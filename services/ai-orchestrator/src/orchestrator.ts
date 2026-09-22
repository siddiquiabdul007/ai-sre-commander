/**
 * AI Orchestrator — Multi-Agent Investigation System
 * 
 * PRD v3.0 §3.1: Routes investigation through real LLM Gateway.
 * - Every investigation invokes real Gemini API calls for RCA and remediation planning.
 * - No offline mode, no silent swap to rule-based agents on failure.
 * - If LLM fails, marks incident FAILED, records error on timeline, and throws error loudly.
 */

import { KubernetesAgent } from '@ai-sre/agent-kubernetes';
import { ObservabilityAgent } from '@ai-sre/agent-observability';
import { ChangeIntelligenceAgent } from '@ai-sre/agent-change-intelligence';
import type { Incident, EvidenceObject, Hypothesis } from '@ai-sre/event-schema';
import { LLMGateway } from './llm-gateway.js';
import { RcaResultSchema, RemediationPlanSchema } from './llm-schemas.js';

export interface InvestigationResult {
  incident: Incident;
  evidence: EvidenceObject[];
  leadingHypothesisTitle: string;
  confidence: number;
  proposedAction: string;
  llmModel: string;
  llmLatencyMs?: number;
}

export class AIOrchestrator {
  private k8sAgent = new KubernetesAgent();
  private obsAgent = new ObservabilityAgent();
  private changeAgent = new ChangeIntelligenceAgent();
  private llmGateway: LLMGateway;

  constructor(private incidentRepo: any) {
    this.llmGateway = new LLMGateway();
  }

  public async runInvestigation(incidentId: string): Promise<InvestigationResult> {
    const incident = await this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    // 1. Transition state machine to INVESTIGATING
    if (incident.state === 'DETECTED' || incident.state === 'TRIAGED') {
      await this.incidentRepo.transitionState(incidentId, 'INVESTIGATING', 'AI multi-agent investigation commenced.');
    }

    // 2. Parallel agent evidence gathering against live infrastructure
    const [k8sEvidence, obsEvidence, changeEvidence] = await Promise.all([
      this.k8sAgent.investigate(incidentId, {
        service: incident.service,
        namespace: incident.namespace,
        cluster: incident.cluster
      }),
      this.obsAgent.investigate(incidentId, {
        service: incident.service,
        namespace: incident.namespace
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

    // 3. RCA + Remediation: Route through real LLM Gateway (PRD §11.2)
    let leadingHypothesis: Hypothesis;
    let hypotheses: Hypothesis[];
    let llmLatencyMs: number | undefined;
    let remediationProposal: any;
    let usedModel = 'gemini-3.8-flash';

    try {
      // LIVE: Real LLM-driven RCA
      const rcaResult = await this.invokeLLMRca(incidentId, incident, allEvidence);
      leadingHypothesis = rcaResult.hypotheses[0];
      hypotheses = rcaResult.hypotheses;
      llmLatencyMs = rcaResult.latencyMs;
      usedModel = rcaResult.model;

      // LIVE: Real LLM-driven remediation planning
      remediationProposal = await this.invokeLLMRemediation(
        incidentId, incident, leadingHypothesis
      );
    } catch (llmError: any) {
      // PRD v3.0 §3.1: Surface failure on timeline — NEVER silently downgrade to rule-based logic
      await this.incidentRepo.addTimelineEntry(incidentId, {
        type: 'AI_HYPOTHESIS',
        title: 'AI Investigation Failed',
        description: `LLM reasoning failed: ${llmError.message}. Real error surfaced per PRD v3.0 mandate.`,
        data: { error: llmError.message }
      });

      if (this.incidentRepo.transitionState) {
        try {
          await this.incidentRepo.transitionState(incidentId, 'FAILED', `AI investigation failed: ${llmError.message}`);
        } catch {
          // Keep current state if transition not permitted
        }
      }

      throw new Error(`[AIOrchestrator] Multi-agent investigation failed: ${llmError.message}`);
    }

    // 4. Update incident state machine and attach findings
    incident.leadingHypothesis = leadingHypothesis;
    incident.hypotheses = hypotheses;
    incident.remediationProposals = [remediationProposal];

    await this.incidentRepo.transitionState(
      incidentId,
      'DIAGNOSED',
      `Leading root cause identified with ${leadingHypothesis.confidence}% confidence.`
    );
    await this.incidentRepo.transitionState(
      incidentId,
      'REMEDIATION_PROPOSED',
      `Proposed action '${remediationProposal.action}' targeting ${remediationProposal.targetResource}.`
    );

    await this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'AI_HYPOTHESIS',
      title: `AI Finding: ${leadingHypothesis.title}`,
      description: `Confidence: ${leadingHypothesis.confidence}%. Evidence: ${leadingHypothesis.supportingEvidenceCount} supporting / ${leadingHypothesis.contradictoryEvidenceCount} contradictory.`,
      data: {
        hypothesisId: leadingHypothesis.id,
        confidence: leadingHypothesis.confidence,
        llmModel: usedModel,
        llmLatencyMs
      }
    });

    await this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'REMEDIATION_PROPOSED',
      title: `Remediation Proposed: ${remediationProposal.action}`,
      description: `Risk: ${remediationProposal.risk}. Expected Impact: ${remediationProposal.expectedImpact}`,
      data: remediationProposal
    });

    await this.incidentRepo.updateIncident(incident);

    return {
      incident,
      evidence: allEvidence,
      leadingHypothesisTitle: leadingHypothesis.title,
      confidence: leadingHypothesis.confidence,
      proposedAction: remediationProposal.action,
      llmModel: usedModel,
      llmLatencyMs
    };
  }

  /**
   * Invokes real LLM for root cause analysis.
   */
  private async invokeLLMRca(
    incidentId: string,
    incident: Incident,
    evidence: EvidenceObject[]
  ): Promise<{ hypotheses: Hypothesis[]; latencyMs: number; model: string }> {
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

    const response = await this.llmGateway.invoke({
      task: 'rca',
      prompt: [
        `Incident: ${incident.title}`,
        `Service: ${incident.service}`,
        `Severity: ${incident.severity}`,
        `Environment: ${incident.environment}`,
        ``,
        `Evidence items: ${evidence.length} collected from Kubernetes, Prometheus, and change intelligence.`,
        ``,
        `Generate ranked hypotheses. The top hypothesis must identify the most probable root cause based on the evidence.`,
        `Every hypothesis must cite specific evidence IDs in supportingEvidenceIds or contradictoryEvidenceIds.`,
        `Confidence must be between 0 and 100.`
      ].join('\n'),
      context: JSON.stringify(evidenceContext),
      schema: RcaResultSchema,
      maxTokens: 4096
    });

    const parsed = response.data;

    const hypotheses: Hypothesis[] = parsed.hypotheses.map((h, index) => ({
      id: `hyp-${index + 1}-${Date.now()}`,
      rank: h.rank,
      title: h.title,
      rootCause: h.rootCause,
      confidence: h.confidence <= 1 ? Math.round(h.confidence * 100) : h.confidence,
      supportingEvidenceCount: h.supportingEvidenceIds.length,
      contradictoryEvidenceCount: h.contradictoryEvidenceIds.length,
      supportingEvidenceIds: h.supportingEvidenceIds,
      contradictoryEvidenceIds: h.contradictoryEvidenceIds,
      explanation: h.explanation,
      proposedAction: (h.proposedAction || 'rollback_deployment') as any,
      targetRevision: h.targetRevision
    }));

    return {
      hypotheses,
      latencyMs: response.latencyMs,
      model: response.model
    };
  }

  /**
   * Invokes real LLM for remediation planning.
   */
  private async invokeLLMRemediation(
    incidentId: string,
    incident: Incident,
    leadingHypothesis: Hypothesis
  ): Promise<any> {
    const response = await this.llmGateway.invoke({
      task: 'remediation_planning',
      prompt: [
        `Incident: ${incident.title}`,
        `Service: ${incident.service}`,
        `Namespace: ${incident.namespace}`,
        `Environment: ${incident.environment}`,
        `Root Cause: ${leadingHypothesis.rootCause}`,
        `Recommended Action: ${leadingHypothesis.proposedAction}`,
        `Target Revision: ${leadingHypothesis.targetRevision || 1}`,
        ``,
        `Plan a safe remediation action to mitigate the incident.`
      ].join('\n'),
      context: JSON.stringify(leadingHypothesis),
      schema: RemediationPlanSchema,
      maxTokens: 2048
    });

    const plan = response.data;

    return {
      id: `rem-${Date.now()}`,
      incidentId,
      action: plan.action || 'rollback_deployment',
      risk: plan.risk || 'HIGH',
      environment: incident.environment,
      namespace: incident.namespace,
      targetResource: plan.targetResource || `deployment/${incident.service}`,
      parameters: {
        deployment: incident.service,
        deploymentName: incident.service,
        targetRevision: leadingHypothesis.targetRevision || (plan.parameters as any)?.targetRevision || 1,
        ...(plan.parameters as any)
      },
      expectedImpact: plan.expectedImpact,
      blastRadius: plan.blastRadius,
      status: 'PENDING_APPROVAL',
      proposedBy: `ai-orchestrator (${response.model})`,
      reason: `Automated remediation plan formulated from leading hypothesis: ${leadingHypothesis.title}`,
      idempotencyKey: `idem-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
  }
}
