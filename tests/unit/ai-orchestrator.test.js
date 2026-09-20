import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IncidentRepository } from '@ai-sre/incident-engine';
import { AIOrchestrator, LLMGateway } from '@ai-sre/ai-orchestrator';

describe('AI Orchestration & Multi-Agent Investigation Tests', () => {
  it('runs multi-agent investigation and produces grounded hypotheses with confidence', async () => {
    const repo = new IncidentRepository();
    const incident = repo.createIncident({
      title: 'High Error Rate 5xx Spike on Checkout API',
      service: 'checkout-api',
      severity: 'SEV-1',
      environment: 'production',
      namespace: 'payments'
    });

    const orchestrator = new AIOrchestrator(repo);
    const result = await orchestrator.runInvestigation(incident.id);

    // 1. Evidence Verification
    assert.ok(result.evidence.length >= 4);
    const supporting = result.evidence.filter((e) => !e.isContradictory);
    const contradictory = result.evidence.filter((e) => e.isContradictory);
    assert.ok(supporting.length >= 3, 'Must have supporting evidence');
    assert.ok(contradictory.length >= 1, 'Must have inspectable contradictory evidence (PRD §7)');

    // 2. State Machine Transitions
    assert.equal(result.incident.state, 'REMEDIATION_PROPOSED');

    // 3. Leading Hypothesis & Confidence
    assert.ok(result.incident.leadingHypothesis, 'Must formulate leading hypothesis');
    assert.equal(result.confidence, 94);
    assert.match(result.leadingHypothesisTitle, /Deployment v1.1.0/);

    // 4. Structured Remediation Proposal
    assert.equal(result.incident.remediationProposals.length, 1);
    const proposal = result.incident.remediationProposals[0];
    assert.equal(proposal.action, 'rollback_deployment');
    assert.equal(proposal.risk, 'HIGH');
    assert.equal(proposal.namespace, 'payments');
    assert.equal(proposal.parameters.targetRevision, 26);
    assert.ok(proposal.expectedImpact.includes('stable previous release'));

    // 5. Timeline tracking
    const timeline = repo.getTimeline(incident.id);
    const aiEntries = timeline.filter((t) => t.type === 'AI_HYPOTHESIS' || t.type === 'REMEDIATION_PROPOSED');
    assert.equal(aiEntries.length, 2);
  });

  it('routes models via LLM Gateway and records golden signals', async () => {
    const gateway = new LLMGateway();
    const res = await gateway.invoke({
      task: 'rca',
      prompt: 'Synthesize memory leak',
      context: 'Pod logs: normal operation'
    });

    assert.equal(res.provider, 'Gemini');
    assert.equal(res.model, 'gemini-2.5-pro');
    assert.ok(res.tokensUsed > 0);
    assert.ok(res.latencyMs >= 0);
  });
});
