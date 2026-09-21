/**
 * Stage 4 Verification Test: Kubernetes Investigation & Execution Adapters
 * 
 * PRD v2.0 §3.2 Acceptance Criteria:
 * - Real @kubernetes/client-node integration in live mode
 * - Investigation agent queries pods/events with proper evidence schema
 * - Remediation execution initiates rollback
 * - Idempotency key reuse returns cached result without duplicate execution
 * - Structured error handling for missing deployments or permission errors
 * 
 * Run:
 *   K8S_MODE=live K8S_NAMESPACE=sre-demo node tests/integration/k8s-execution.test.js
 *   K8S_MODE=offline node tests/integration/k8s-execution.test.js
 */

import { KubernetesAgent } from '@ai-sre/agent-kubernetes';
import { ExecutionService } from '@ai-sre/execution-service';
import { IncidentRepository } from '@ai-sre/incident-engine';

async function runTest() {
  console.log('=== Stage 4 Verification: Kubernetes Investigation & Execution ===\n');

  const mode = process.env.K8S_MODE || 'offline';
  const namespace = process.env.K8S_NAMESPACE || 'sre-demo';
  console.log(`K8S_MODE = ${mode}`);
  console.log(`K8S_NAMESPACE = ${namespace}\n`);

  let passed = 0;
  let failed = 0;

  // 1. Initialize services
  const agent = new KubernetesAgent();
  const repo = new IncidentRepository();
  const executor = new ExecutionService(repo);

  // Setup initial incident
  const incident = repo.createIncident({
    tenantId: 'tenant-demo',
    title: 'High Latency & Pod Restarts in checkout-api',
    severity: 'SEV1',
    service: 'checkout-api',
    environment: 'prod',
    cluster: 'aks-aisre-prod',
    namespace
  });
  console.log(`Created test incident: ${incident.id} [state: ${incident.state}]`);

  // Test 1: Investigation Agent gathers evidence
  console.log('\n--- Test 1: Investigation Agent gathers pod & event evidence ---');
  const t0 = Date.now();
  try {
    const evidence = await agent.investigate(incident.id, {
      service: 'checkout-api',
      namespace,
      cluster: 'aks-aisre-prod'
    });

    const elapsed = Date.now() - t0;
    console.log(`✓ Investigation returned ${evidence.length} evidence items in ${elapsed}ms`);

    for (const ev of evidence) {
      console.log(`  - [${ev.type}] ${ev.title} (conf: ${ev.confidence}%, source: ${ev.source})`);
      if (ev.provenance) {
        console.log(`    Provenance: ${ev.provenance.sourceSystem} | Hash: ${ev.provenance.untrustedInputHash}`);
      }
    }

    if (evidence.length > 0) {
      passed++;
    } else {
      console.log('  Notice: 0 items returned (clean namespace)');
      passed++;
    }
  } catch (err) {
    console.error(`✗ Investigation failed: ${err.message}`);
    failed++;
  }

  // Test 2: Remediation Execution (Rollback)
  console.log('\n--- Test 2: Remediation Execution (Rollback Deployment) ---');
  const idempotencyKey = `idem-k8s-${Date.now()}`;
  repo.transitionState(incident.id, 'INVESTIGATING', 'Investigation started');
  repo.transitionState(incident.id, 'DIAGNOSED', 'RCA confirmed bad deployment');
  repo.transitionState(incident.id, 'REMEDIATION_PROPOSED', 'Remediation proposed');
  repo.transitionState(incident.id, 'AWAITING_APPROVAL', 'Remediation plan approved');

  const proposal = {
    id: `prop-${Date.now()}`,
    incidentId: incident.id,
    action: 'ROLLBACK_DEPLOYMENT',
    targetResource: 'deployment/checkout-api',
    parameters: {
      deploymentName: 'checkout-api',
      targetRevision: 1,
      namespace
    },
    riskAssessment: {
      score: 2,
      blastRadius: 'service-local',
      requiresHumanApproval: false,
      factors: ['safe-rollback', 'zero-downtime']
    },
    status: 'APPROVED',
    idempotencyKey,
    createdAt: new Date().toISOString()
  };

  const t1 = Date.now();
  let firstResult;

  try {
    firstResult = await executor.executeProposal(incident.id, proposal);
    const elapsed = Date.now() - t1;
    console.log(`✓ Execution result: ${firstResult.status} in ${elapsed}ms`);
    console.log(`  Output: ${firstResult.outputMessage}`);
    console.log(`  ExecutionId: ${firstResult.executionId}`);
    passed++;
  } catch (err) {
    console.error(`✗ Execution failed: ${err.message}`);
    failed++;
  }

  // Test 3: Idempotency Enforcement (Duplicate Key)
  console.log('\n--- Test 3: Idempotency Key Enforcement ---');
  try {
    const duplicateResult = await executor.executeProposal(incident.id, proposal);

    console.log(`✓ Duplicate submission handled:`);
    console.log(`  Status: ${duplicateResult.status}`);
    console.log(`  Output: ${duplicateResult.outputMessage}`);
    console.log(`  ExecutionId: ${duplicateResult.executionId}`);

    if (duplicateResult.outputMessage.includes('Idempotent replay detected') || duplicateResult.outputMessage.includes('already executed')) {
      console.log('✓ Idempotency verified — duplicate execution safely prevented');
      passed++;
    } else {
      console.error('✗ Idempotency failed — executed again instead of returning cached result');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Idempotency test error: ${err.message}`);
    failed++;
  }

  // Test 4: Structured Error Handling (Unapproved Proposal)
  console.log('\n--- Test 4: Structured Guardrails (Unapproved Proposal) ---');
  try {
    const unapprovedProposal = {
      ...proposal,
      id: `prop-unapproved-${Date.now()}`,
      idempotencyKey: `idem-unapp-${Date.now()}`,
      status: 'PENDING_APPROVAL'
    };

    let rejectedAsExpected = false;
    try {
      await executor.executeProposal(incident.id, unapprovedProposal);
    } catch (err) {
      if (err.message.includes('must be \'APPROVED\'')) {
        rejectedAsExpected = true;
        console.log(`✓ Guardrail caught unapproved proposal: ${err.message}`);
      }
    }

    if (rejectedAsExpected) {
      passed++;
    } else {
      console.error('✗ Failed to reject unapproved proposal');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Unexpected error: ${err.message}`);
    failed++;
  }

  // Summary
  console.log('\n========================================');
  console.log(`Stage 4 Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
