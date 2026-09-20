import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IncidentRepository } from '@ai-sre/incident-engine';
import { CorrelationEngine } from '@ai-sre/correlation-engine';
import { EventNormalizer } from '@ai-sre/event-ingestion';
import { ExecutionService } from '@ai-sre/execution-service';

describe('PRD §26 Chaos & Fault-Injection Tests: Duplicate Events & Retry Storms', () => {
  it('collapses an alert storm of 50 duplicate Prometheus alerts into a single incident', () => {
    const repo = new IncidentRepository();
    const correlation = new CorrelationEngine(repo, 30);

    const initialProm = EventNormalizer.normalizePrometheus({
      labels: { alertname: 'HighMemoryUsage', service: 'checkout-api', severity: 'critical' },
      annotations: { summary: 'Memory limit exceeded' }
    });

    const firstResult = correlation.correlate(initialProm);
    const incidentId = firstResult.incident.id;

    // Simulate storm of 50 rapid duplicate alerts
    for (let i = 0; i < 50; i++) {
      const duplicateAlert = EventNormalizer.normalizePrometheus({
        labels: { alertname: 'HighMemoryUsage', service: 'checkout-api', severity: 'critical' },
        annotations: { summary: `Memory limit exceeded retry #${i}` }
      });
      const res = correlation.correlate(duplicateAlert);
      assert.equal(res.isNewIncident, false);
      assert.equal(res.matchedIncidentId, incidentId);
    }

    // Only 1 incident must exist
    const allIncidents = repo.listIncidents();
    assert.equal(allIncidents.length, 1);
  });

  it('safely handles concurrent execution retry attempts with the same idempotency key', async () => {
    const repo = new IncidentRepository();
    const inc = repo.createIncident({
      title: 'CrashLoop Incident',
      service: 'checkout-api',
      severity: 'SEV-1'
    });

    repo.transitionState(inc.id, 'TRIAGED');
    repo.transitionState(inc.id, 'INVESTIGATING');
    repo.transitionState(inc.id, 'DIAGNOSED');
    repo.transitionState(inc.id, 'REMEDIATION_PROPOSED');

    const proposal = {
      id: 'rem_proposal_concurrent',
      incidentId: inc.id,
      action: 'rollback_deployment',
      risk: 'HIGH',
      environment: 'production',
      namespace: 'payments',
      targetResource: 'deployment/checkout-api',
      parameters: { deployment: 'checkout-api', targetRevision: 26 },
      expectedImpact: 'Rollback',
      blastRadius: 'Single pod',
      status: 'APPROVED',
      proposedBy: 'ai',
      reason: 'Memory leak',
      idempotencyKey: 'idemp_key_unique_concurrent_555',
      createdAt: new Date().toISOString()
    };

    inc.remediationProposals = [proposal];
    repo.updateIncident(inc);

    const executionService = new ExecutionService(repo);

    // Concurrently fire 5 identical execution calls
    const results = await Promise.all([
      executionService.executeProposal(inc.id, proposal),
      executionService.executeProposal(inc.id, proposal),
      executionService.executeProposal(inc.id, proposal),
      executionService.executeProposal(inc.id, proposal),
      executionService.executeProposal(inc.id, proposal)
    ]);

    // All return success, but only the first actually ran
    for (const res of results) {
      assert.equal(res.status, 'SUCCESS');
    }

    const replayCount = results.filter((r) => r.outputMessage.includes('Idempotent replay detected')).length;
    assert.equal(replayCount, 4, '4 of 5 calls must be detected as idempotent replays');
  });
});
