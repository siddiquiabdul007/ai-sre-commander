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
      namespace: process.env.K8S_NAMESPACE || 'sre-demo'
    });

    const orchestrator = new AIOrchestrator(repo);
    const result = await orchestrator.runInvestigation(incident.id);

    // 1. Evidence Verification
    assert.ok(result.evidence.length >= 1, 'Must gather live evidence');

    // 2. State Machine Transitions
    assert.equal(result.incident.state, 'REMEDIATION_PROPOSED');

    // 3. Leading Hypothesis & Confidence
    assert.ok(result.incident.leadingHypothesis, 'Must formulate leading hypothesis');
    assert.ok(result.confidence > 0, 'Must calculate positive confidence');
    assert.ok(result.leadingHypothesisTitle.length > 0);

    // 4. Structured Remediation Proposal
    assert.ok(result.incident.remediationProposals.length >= 1);
    const proposal = result.incident.remediationProposals[0];
    assert.ok(proposal.action);

    // 5. Timeline tracking
    const timeline = repo.getTimeline(incident.id);
    const aiEntries = timeline.filter((t) => t.type === 'AI_HYPOTHESIS' || t.type === 'REMEDIATION_PROPOSED');
    assert.ok(aiEntries.length >= 1);
  });

  it('routes models via LLM Gateway and records golden signals', async () => {
    const gateway = new LLMGateway();
    const res = await gateway.invoke({
      task: 'rca',
      prompt: 'Synthesize root cause for high error rates on checkout-api service.',
      context: 'Live Prometheus metrics show error rate spike.'
    });

    assert.match(res.provider, /Google|Gemini/);
    assert.match(res.model, /gemini-3/);
    assert.ok(res.tokensUsed > 0);
    assert.ok(res.latencyMs >= 0);
  });
});
