import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventNormalizer } from '@ai-sre/event-ingestion';
import { IncidentRepository, IncidentStateMachine, IllegalStateTransitionError } from '@ai-sre/incident-engine';
import { CorrelationEngine } from '@ai-sre/correlation-engine';

describe('Incident Engine & Event Ingestion Tests', () => {
  it('normalizes heterogeneous raw events correctly', () => {
    // 1. Prometheus Alert
    const promAlert = {
      labels: { alertname: 'HighErrorRate5xx', service: 'checkout-api', severity: 'critical' },
      annotations: { summary: '5xx error rate exceeded 5% threshold' },
      startsAt: '2026-09-21T10:00:00Z'
    };
    const normProm = EventNormalizer.normalizePrometheus(promAlert);
    assert.equal(normProm.source, 'prometheus');
    assert.equal(normProm.severity, 'CRITICAL');
    assert.equal(normProm.service, 'checkout-api');

    // 2. K8s OOMKilled Event
    const k8sEvt = {
      reason: 'OOMKilled',
      involvedObject: { kind: 'Pod', name: 'checkout-api-7b9d9c-f12', labels: { app: 'checkout-api' } },
      message: 'Container limit exceeded 512Mi'
    };
    const normK8s = EventNormalizer.normalizeKubernetes(k8sEvt);
    assert.equal(normK8s.source, 'kubernetes');
    assert.equal(normK8s.severity, 'ERROR');
    assert.match(normK8s.title, /OOMKilled/);

    // 3. GitHub Deployment Event
    const ghDeploy = {
      deployment: { ref: 'v1.1.0', sha: 'a1b2c3d4e5f6', environment: 'production' },
      repository: { name: 'checkout-api' }
    };
    const normGh = EventNormalizer.normalizeGitHub(ghDeploy);
    assert.equal(normGh.source, 'github');
    assert.equal(normGh.service, 'checkout-api');
    assert.equal(normGh.entityId, 'a1b2c3d4e5f6');
  });

  it('enforces PRD §19 10-state incident lifecycle and rejects illegal transitions', () => {
    const repo = new IncidentRepository();
    const inc = repo.createIncident({
      title: 'Checkout API Latency Spike',
      service: 'checkout-api',
      severity: 'SEV-1'
    });

    assert.equal(inc.state, 'DETECTED');

    // Valid progression: DETECTED -> TRIAGED -> INVESTIGATING -> DIAGNOSED
    repo.transitionState(inc.id, 'TRIAGED');
    assert.equal(repo.getIncident(inc.id)?.state, 'TRIAGED');

    repo.transitionState(inc.id, 'INVESTIGATING');
    assert.equal(repo.getIncident(inc.id)?.state, 'INVESTIGATING');

    repo.transitionState(inc.id, 'DIAGNOSED');
    assert.equal(repo.getIncident(inc.id)?.state, 'DIAGNOSED');

    repo.transitionState(inc.id, 'REMEDIATION_PROPOSED');
    repo.transitionState(inc.id, 'AWAITING_APPROVAL');
    repo.transitionState(inc.id, 'EXECUTING');
    repo.transitionState(inc.id, 'VERIFYING');
    repo.transitionState(inc.id, 'RESOLVED');
    repo.transitionState(inc.id, 'POSTMORTEM');

    assert.equal(repo.getIncident(inc.id)?.state, 'POSTMORTEM');

    // Illegal transition: POSTMORTEM cannot transition back directly to EXECUTING
    assert.throws(() => {
      repo.transitionState(inc.id, 'EXECUTING');
    }, IllegalStateTransitionError);
  });

  it('correlates temporal signals from deployment to alert into single incident', async () => {
    const repo = new IncidentRepository();
    const correlationEngine = new CorrelationEngine(repo, 30);

    // 14:20 Deployment
    const ghEvent = EventNormalizer.normalizeGitHub({
      deployment: { ref: 'v2.7.4', sha: 'c0ffee123456', environment: 'production' },
      repository: { name: 'checkout-api' }
    });
    const res1 = await correlationEngine.correlate(ghEvent);
    assert.equal(res1.isNewIncident, true);
    const incidentId = res1.incident.id;

    // 14:25 Memory Anomaly / K8s OOMKilled
    const k8sEvent = EventNormalizer.normalizeKubernetes({
      reason: 'OOMKilled',
      involvedObject: { kind: 'Pod', name: 'checkout-api-5c74787bd9-xyz', labels: { app: 'checkout-api' } },
      message: 'Memory threshold exceeded'
    });
    const res2 = await correlationEngine.correlate(k8sEvent);
    assert.equal(res2.isNewIncident, false);
    assert.equal(res2.matchedIncidentId, incidentId);

    // 14:32 Prometheus alert
    const promAlert = EventNormalizer.normalizePrometheus({
      labels: { alertname: 'HighErrorRate5xx', service: 'checkout-api', severity: 'critical' },
      annotations: { summary: '5xx spike' }
    });
    const res3 = await correlationEngine.correlate(promAlert);
    assert.equal(res3.isNewIncident, false);
    assert.equal(res3.matchedIncidentId, incidentId);

    // Verify timeline has captured all signals
    const timeline = repo.getTimeline(incidentId);
    assert.ok(timeline.length >= 3);
  });
});
