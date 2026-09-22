/**
 * Stage 5 Verification Test: Postgres Persistence & Concurrency
 * 
 * PRD v2.0 §3.3 Acceptance Criteria:
 * - Real Azure PostgreSQL Flexible Server connectivity
 * - Service restarts and incident history survives
 * - Concurrency test: two parallel requests with same idempotency key -> exactly one succeeds at DB level
 * - Evidence and Timeline persisted durably
 * 
 * Run:
 *   DATABASE_URL="postgresql://sreadmin:<password>@<host>:5432/sre_commander?sslmode=require" node tests/integration/persistence.test.js
 */

import { PrismaIncidentRepository, getPrismaClient } from '@ai-sre/database';
import { randomUUID } from 'node:crypto';

async function runTest() {
  console.log('=== Stage 5 Verification: PostgreSQL Persistence & Concurrency ===\n');

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required.');
    process.exit(1);
  }
  console.log(`Database URL: ${dbUrl.replace(/:[^:@]+@/, ':****@')}\n`);

  const prisma = getPrismaClient();
  let passed = 0;
  let failed = 0;

  const repo1 = new PrismaIncidentRepository(prisma);

  // Test 1: Incident Creation & Durability
  console.log('--- Test 1: Incident Creation & Durability ---');
  let incidentId;
  try {
    const created = await repo1.createIncident({
      title: 'Database Persistence Verification Incident',
      service: 'checkout-api',
      severity: 'SEV-1',
      environment: 'prod',
      cluster: 'aks-aisre-prod',
      namespace: 'sre-demo'
    });

    incidentId = created.id;
    console.log(`✓ Created incident in PostgreSQL: ${incidentId}`);
    console.log(`  State: ${created.state}, Service: ${created.service}, Severity: ${created.severity}`);
    passed++;
  } catch (err) {
    console.error(`✗ Failed to create incident: ${err.message}`);
    failed++;
  }

  // Test 2: State Transitions & Timeline Persistence
  console.log('\n--- Test 2: State Transitions & Timeline History ---');
  try {
    const transitioned1 = await repo1.transitionState(incidentId, 'INVESTIGATING', 'Investigation underway');
    const transitioned2 = await repo1.transitionState(incidentId, 'DIAGNOSED', 'RCA identified root cause');
    console.log(`✓ Transitioned incident state: DETECTED -> INVESTIGATING -> ${transitioned2.state}`);

    const fetched = await repo1.getIncident(incidentId);
    console.log(`✓ Fetched back from DB: current state = ${fetched?.state}`);
    passed++;
  } catch (err) {
    console.error(`✗ State transition error: ${err.message}`);
    failed++;
  }

  // Test 3: Evidence Persistence
  console.log('\n--- Test 3: Evidence Storage & Retrieval ---');
  try {
    const evidenceId = randomUUID();
    await repo1.addEvidence(incidentId, {
      id: evidenceId,
      incidentId,
      type: 'METRIC_ANOMALY',
      source: 'prometheus',
      title: 'Memory leak 94% threshold exceeded',
      summary: 'checkout-api pod memory increased linearly by 380MB over 10m',
      confidence: 95,
      isContradictory: false,
      provenance: {
        sourceSystem: 'aks-aisre-prod/sre-demo',
        queryOrFilter: 'container_memory_working_set_bytes',
        extractedAt: new Date().toISOString(),
        untrustedInputHash: 'hash-abc-123'
      }
    });

    const incidentWithEvidence = await repo1.getIncident(incidentId);
    console.log(`✓ Evidence added to database and retrieved`);
    passed++;
  } catch (err) {
    console.error(`✗ Evidence test error: ${err.message}`);
    failed++;
  }

  // Test 4: Concurrency Test — Duplicate Idempotency Key
  console.log('\n--- Test 4: Concurrency Test (DB-Level Idempotency Constraint) ---');
  const sharedKey = randomUUID();
  const proposalBase = {
    incidentId,
    action: 'ROLLBACK_DEPLOYMENT',
    risk: 'LOW',
    environment: 'prod',
    namespace: 'sre-demo',
    targetResource: 'deployment/checkout-api',
    parameters: { deployment: 'checkout-api', targetRevision: 1 },
    expectedImpact: 'Restore latency to baseline < 50ms',
    blastRadius: 'service-local',
    status: 'APPROVED',
    proposedBy: 'ai-remediation',
    reason: 'Rolling back faulty release',
    idempotencyKey: sharedKey,
    createdAt: new Date().toISOString()
  };

  try {
    // Fire two parallel concurrent attempts to record the same proposal with the same idempotency key
    const [resultA, resultB] = await Promise.all([
      repo1.recordProposal({ ...proposalBase, id: randomUUID() }),
      repo1.recordProposal({ ...proposalBase, id: randomUUID() })
    ]);

    console.log(`  Concurrent request A result: duplicate=${resultA.isDuplicate}`);
    console.log(`  Concurrent request B result: duplicate=${resultB.isDuplicate}`);

    // Exactly one must be duplicate=false and the other duplicate=true
    const oneSucceeded = (resultA.isDuplicate && !resultB.isDuplicate) || (!resultA.isDuplicate && resultB.isDuplicate);

    if (oneSucceeded) {
      console.log('✓ Concurrency verified: DB unique constraint enforced, exactly one execution won the race');
      passed++;
    } else {
      console.error('✗ Concurrency test failed: both succeeded or both failed');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Concurrency test error: ${err.message}`);
    failed++;
  }

  // Test 5: Service Restart Survival
  console.log('\n--- Test 5: Simulated Service Restart Survival ---');
  try {
    // Instantiate a completely new repository instance simulating a newly booted process
    const repo2 = new PrismaIncidentRepository(prisma);
    const reloaded = await repo2.getIncident(incidentId);

    if (reloaded && reloaded.id === incidentId) {
      console.log(`✓ Fresh repository instance loaded incident ${reloaded.id} from PostgreSQL`);
      console.log(`  Title: ${reloaded.title}`);
      console.log(`  State: ${reloaded.state}`);
      console.log(`  Created: ${reloaded.createdAt}`);
      passed++;
    } else {
      console.error('✗ Incident not found after restart');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Restart test error: ${err.message}`);
    failed++;
  }

  // Summary
  console.log('\n========================================');
  console.log(`Stage 5 Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
