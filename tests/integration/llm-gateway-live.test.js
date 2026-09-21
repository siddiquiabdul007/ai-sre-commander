/**
 * Stage 1 Verification Test: Real Gemini API Call
 * 
 * PRD v2.0 §3.1 Acceptance Criteria:
 * - Real API call reaches Gemini with real latency (hundreds of ms, not single-digit)
 * - Schema-valid structured output returned
 * - LLM_MODE=live enforced
 * 
 * Run: LLM_MODE=live GEMINI_API_KEY=... node tests/integration/llm-gateway-live.test.js
 */

import 'dotenv/config';
import { LLMGateway } from '@ai-sre/ai-orchestrator';
import { RcaResultSchema } from '@ai-sre/ai-orchestrator';

async function runTest() {
  console.log('=== Stage 1 Verification: Real Gemini API Call ===\n');

  // 1. Verify LLM_MODE
  const mode = process.env.LLM_MODE || 'offline';
  console.log(`LLM_MODE = ${mode}`);
  if (mode !== 'live') {
    console.error('ERROR: This test requires LLM_MODE=live. Set environment variable and retry.');
    process.exit(1);
  }

  // 2. Initialize gateway
  const gateway = new LLMGateway();
  console.log(`Gateway mode: ${gateway.getMode()}\n`);

  // 3. Test: RCA structured output with real evidence
  console.log('--- Test 1: RCA with structured output ---');
  const startTime = Date.now();

  const evidence = [
    {
      id: 'ev-001',
      type: 'K8S_EVENT',
      source: 'kubernetes',
      title: 'Pod OOMKilled',
      summary: 'Container checkout-api exceeded 512Mi memory limit, exit code 137. 4 restarts in 10 min.',
      confidence: 96,
      isContradictory: false
    },
    {
      id: 'ev-002',
      type: 'METRIC_ANOMALY',
      source: 'prometheus',
      title: 'HTTP 5xx Error Rate Spike',
      summary: 'HTTP 500 error rate spiked to 6.8% (baseline < 0.05%).',
      confidence: 98,
      isContradictory: false
    },
    {
      id: 'ev-003',
      type: 'DEPLOYMENT_CHANGE',
      source: 'github',
      title: 'Deployment v1.1.0 rollout',
      summary: 'checkout-api deployed v1.1.0 (sha: e7a4b12) 8 minutes before first OOM event.',
      confidence: 99,
      isContradictory: false
    },
    {
      id: 'ev-004',
      type: 'BASELINE_DEVIATION',
      source: 'prometheus',
      title: 'Memory monotonic growth',
      summary: 'Pod memory grew linearly from 180Mi to 512Mi in 7 minutes.',
      confidence: 94,
      isContradictory: false
    },
    {
      id: 'ev-005',
      type: 'DATABASE_METRICS',
      source: 'azure',
      title: 'Database healthy',
      summary: 'PostgreSQL shows steady 12ms query latency and ample connections.',
      confidence: 85,
      isContradictory: true
    }
  ];

  try {
    const response = await gateway.invoke({
      task: 'rca',
      prompt: [
        'Analyze this incident and generate ranked root cause hypotheses.',
        '',
        'Incident: checkout-api SEV-1 — Elevated 5xx errors and OOMKilled pods',
        'Service: checkout-api',
        'Environment: production',
        'Namespace: payments',
        '',
        'Evidence items (reference by ID):',
        JSON.stringify(evidence, null, 2),
        '',
        'Generate 2-4 hypotheses ranked by confidence. Reference specific evidence IDs.'
      ].join('\n'),
      context: JSON.stringify(evidence),
      schema: RcaResultSchema,
      maxTokens: 4096
    });

    const totalLatency = Date.now() - startTime;

    console.log(`✅ API call succeeded`);
    console.log(`   Provider: ${response.provider}`);
    console.log(`   Model: ${response.model}`);
    console.log(`   Mode: ${response.mode}`);
    console.log(`   Latency: ${response.latencyMs}ms`);
    console.log(`   Tokens used: ${response.tokensUsed}`);
    console.log(`   Cost: $${response.costUsd.toFixed(6)}`);
    console.log(`   Total test latency: ${totalLatency}ms`);
    console.log('');

    // Validate response structure
    const data = response.data;
    console.log(`   Hypotheses returned: ${data.hypotheses.length}`);
    console.log(`   Overall confidence: ${data.overallConfidence}%`);
    console.log('');

    for (const h of data.hypotheses) {
      console.log(`   [Rank ${h.rank}] ${h.title}`);
      console.log(`     Confidence: ${h.confidence}%`);
      console.log(`     Supporting evidence: ${h.supportingEvidenceIds.join(', ')}`);
      console.log(`     Contradictory evidence: ${h.contradictoryEvidenceIds.join(', ')}`);
      console.log(`     Proposed action: ${h.proposedAction || 'none'}`);
      console.log('');
    }

    // Acceptance checks
    console.log('--- Acceptance Criteria Checks ---');
    
    const latencyOk = response.latencyMs > 100;
    console.log(`${latencyOk ? '✅' : '❌'} Real latency > 100ms: ${response.latencyMs}ms`);

    const modeOk = response.mode === 'live';
    console.log(`${modeOk ? '✅' : '❌'} Mode is live: ${response.mode}`);

    const schemaOk = data.hypotheses.length >= 1 && typeof data.overallConfidence === 'number';
    console.log(`${schemaOk ? '✅' : '❌'} Schema-valid structured output: ${data.hypotheses.length} hypotheses`);

    const hasEvidenceRefs = data.hypotheses.some(h => h.supportingEvidenceIds.length > 0);
    console.log(`${hasEvidenceRefs ? '✅' : '❌'} Hypotheses reference evidence IDs`);

    const allPassed = latencyOk && modeOk && schemaOk && hasEvidenceRefs;
    console.log(`\n${allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);

    if (!allPassed) process.exit(1);
  } catch (error) {
    console.error(`❌ FAILED: ${error.message}`);
    process.exit(1);
  }
}

runTest();
