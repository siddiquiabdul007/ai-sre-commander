/**
 * Stage 6 Verification Test: Live Prometheus Queries & Observability Evidence
 * 
 * PRD v2.0 §3.4 Acceptance Criteria:
 * - Real PromQL queries against in-cluster Prometheus
 * - Live container memory & scrape targets captured as structured evidence
 * - Provenance tracking with SHA-256 hashes of raw query responses
 * - Graceful tolerance of scrape delays / missing metric series
 * 
 * Run:
 *   PROMETHEUS_URL=http://localhost:9090 node tests/integration/prometheus-live.test.js
 */

import { ObservabilityAgent, PrometheusClient } from '@ai-sre/agent-observability';

async function runTest() {
  console.log('=== Stage 6 Verification: Prometheus Live Queries & Evidence ===\n');

  const promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
  console.log(`Prometheus URL: ${promUrl}\n`);

  let passed = 0;
  let failed = 0;

  const client = new PrometheusClient({ baseUrl: promUrl });
  const agent = new ObservabilityAgent({ mode: 'live', prometheusUrl: promUrl });

  // Test 1: Health check
  console.log('--- Test 1: Prometheus Endpoint Health ---');
  try {
    const healthy = await client.isHealthy();
    if (healthy) {
      console.log('✓ Prometheus server is UP and healthy');
      passed++;
    } else {
      console.error('✗ Prometheus health check returned non-200');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Failed to reach Prometheus: ${err.message}`);
    failed++;
  }

  // Test 2: Live PromQL Queries
  console.log('\n--- Test 2: Live PromQL Queries ---');
  try {
    const t0 = Date.now();
    const upResults = await client.query('up');
    const elapsed = Date.now() - t0;

    console.log(`✓ 'up' query returned ${upResults.length} metric series in ${elapsed}ms`);
    for (const r of upResults.slice(0, 3)) {
      console.log(`  - job=${r.metric.job}, instance=${r.metric.instance}, value=${r.value[1]}`);
    }

    // Query container memory for checkout-api
    const memResults = await client.query('container_memory_working_set_bytes{container="checkout-api"}');
    console.log(`✓ 'container_memory_working_set_bytes' returned ${memResults.length} pod series`);
    for (const r of memResults) {
      const mb = (parseInt(r.value[1], 10) / (1024 * 1024)).toFixed(1);
      console.log(`  - pod=${r.metric.pod}: ${mb} MB`);
    }

    if (upResults.length > 0 && memResults.length > 0) {
      passed++;
    } else {
      console.warn('  ⚠ No metrics returned');
      failed++;
    }
  } catch (err) {
    console.error(`✗ PromQL query failed: ${err.message}`);
    failed++;
  }

  // Test 3: Observability Agent Live Investigation
  console.log('\n--- Test 3: Observability Agent Evidence Gathering ---');
  try {
    const evidence = await agent.investigate('inc-prom-001', {
      service: 'checkout-api',
      namespace: 'sre-demo'
    });

    console.log(`✓ Agent gathered ${evidence.length} evidence object(s) from live telemetry`);
    for (const ev of evidence) {
      console.log(`  - [${ev.type}] ${ev.title} (conf: ${ev.confidence}%)`);
      console.log(`    Summary: ${ev.summary}`);
      console.log(`    Provenance: ${ev.provenance?.sourceSystem} | Query: ${ev.provenance?.queryOrFilter}`);
      console.log(`    UntrustedInputHash: ${ev.provenance?.untrustedInputHash}`);
    }

    if (evidence.length > 0) {
      passed++;
    } else {
      console.error('✗ No evidence produced by agent');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Investigation failed: ${err.message}`);
    failed++;
  }

  // Test 4: Missing Metric & Scrape Gap Resilience
  console.log('\n--- Test 4: Resilience to Non-existent Metrics & Gaps ---');
  try {
    const missingResults = await client.query('non_existent_metric_xyz_abc{foo="bar"}');
    console.log(`✓ Non-existent metric query returned empty array gracefully: count=${missingResults.length}`);

    // Agent investigation against a service with no metric traffic
    const gapEvidence = await agent.investigate('inc-prom-gap', {
      service: 'service-with-no-metrics',
      namespace: 'sre-demo'
    });
    console.log(`✓ Agent gracefully handled missing metric series without throwing: count=${gapEvidence.length}`);
    passed++;
  } catch (err) {
    console.error(`✗ Resilience test failed: ${err.message}`);
    failed++;
  }

  // Summary
  console.log('\n========================================');
  console.log(`Stage 6 Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
