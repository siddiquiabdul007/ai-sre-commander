/**
 * RCA Calibration Test Runner
 * 
 * PRD v2.0 §3.1: Run each corpus scenario through real LLM RCA,
 * measure confidence-vs-correctness correlation.
 * 
 * Output: calibration CSV + summary statistics
 * 
 * Run: LLM_MODE=live GEMINI_API_KEY=... node tests/calibration/rca-calibration.test.js
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { LLMGateway } from '@ai-sre/ai-orchestrator';
import { RcaResultSchema } from '@ai-sre/ai-orchestrator';
import { incidentCorpus } from '../corpus/incident-corpus.js';

// Root cause keyword matching — loose correlation check
function isCorrectRootCause(predicted, expected) {
  const p = (predicted || '').toLowerCase();
  const e = (expected || '').toLowerCase();

  // Map expected to keyword sets
  const keywordMap = {
    memory_leak_deployment: ['memory', 'leak', 'oom', 'deployment', 'rollback'],
    cpu_saturation_code_regression: ['cpu', 'throttl', 'saturat', 'regression', 'code'],
    dns_resolution_failure: ['dns', 'resolution', 'coredns', 'servfail'],
    config_drift_env_var: ['config', 'environment', 'variable', 'configmap', 'misconfigur'],
    dependency_timeout: ['dependency', 'downstream', 'timeout', 'connection pool', 'inventory'],
    disk_pressure_pvc: ['disk', 'pressure', 'pvc', 'storage', 'evict'],
    bad_image_tag: ['image', 'tag', 'crashloop', 'module', 'build', 'branch'],
    slow_query_missing_index: ['query', 'index', 'slow', 'database', 'like'],
    certificate_expired: ['certificate', 'cert', 'expir', 'tls', 'ssl'],
    rate_limiting_third_party: ['rate limit', '429', 'throttl', 'third.party', 'stripe'],
    memory_leak_longrunning: ['memory', 'leak', 'cache', 'ttl', 'long.running', 'gradual'],
    node_failure: ['node', 'notready', 'hardware', 'kubelet', 'vm']
  };

  const keywords = keywordMap[e] || [e];
  const matchCount = keywords.filter(kw => p.includes(kw)).length;
  return matchCount >= 2; // At least 2 keyword matches
}

async function runCalibration() {
  console.log('=== RCA Calibration Test ===\n');

  const mode = process.env.LLM_MODE || 'offline';
  if (mode !== 'live') {
    console.error('ERROR: Calibration requires LLM_MODE=live.');
    process.exit(1);
  }

  const gateway = new LLMGateway();
  const results = [];
  let passCount = 0;
  let totalConfidence = 0;
  let correctConfidenceSum = 0;
  let incorrectConfidenceSum = 0;
  let correctCount = 0;

  for (const scenario of incidentCorpus) {
    console.log(`\n--- ${scenario.id}: ${scenario.title} ---`);
    const startTime = Date.now();

    try {
      const response = await gateway.invoke({
        task: 'rca',
        prompt: [
          `Analyze this incident and generate ranked root cause hypotheses.`,
          ``,
          `Incident: ${scenario.title}`,
          `Service: ${scenario.service}`,
          `Severity: ${scenario.severity}`,
          ``,
          `Evidence:`,
          JSON.stringify(scenario.evidence, null, 2),
          ``,
          `Generate 2-4 hypotheses ranked by confidence. Reference evidence IDs.`
        ].join('\n'),
        context: JSON.stringify(scenario.evidence),
        schema: RcaResultSchema,
        maxTokens: 4096
      });

      const latencyMs = Date.now() - startTime;
      const leading = response.data.hypotheses[0];
      const predicted = `${leading?.title || ''} ${leading?.rootCause || ''}`;
      const confidence = leading?.confidence || 0;
      // Normalize confidence to 0-100 scale (LLM may return 0-1 or 0-100)
      const normalizedConfidence = confidence <= 1 ? confidence * 100 : confidence;
      const correct = isCorrectRootCause(predicted, scenario.expectedRootCause);

      if (correct) {
        correctCount++;
        correctConfidenceSum += normalizedConfidence;
      } else {
        incorrectConfidenceSum += normalizedConfidence;
      }
      totalConfidence += normalizedConfidence;

      console.log(`  Leading: ${leading?.title}`);
      console.log(`  Confidence: ${normalizedConfidence.toFixed(1)}%`);
      console.log(`  Expected: ${scenario.expectedRootCause}`);
      console.log(`  Match: ${correct ? '✅' : '❌'}`);
      console.log(`  Latency: ${latencyMs}ms`);

      results.push({
        scenario_id: scenario.id,
        title: scenario.title,
        expected_cause: scenario.expectedRootCause,
        predicted_cause: leading?.title || 'NONE',
        confidence: normalizedConfidence.toFixed(1),
        correct: correct ? 'YES' : 'NO',
        latency_ms: latencyMs,
        hypotheses_count: response.data.hypotheses.length
      });

      if (correct) passCount++;

      // Rate limit protection — wait between calls
      await new Promise(r => setTimeout(r, 2000));

    } catch (error) {
      console.error(`  ❌ FAILED: ${error.message}`);
      results.push({
        scenario_id: scenario.id,
        title: scenario.title,
        expected_cause: scenario.expectedRootCause,
        predicted_cause: 'ERROR',
        confidence: 0,
        correct: 'ERROR',
        latency_ms: Date.now() - startTime,
        hypotheses_count: 0
      });
      // Wait longer after error
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Write CSV
  const csvHeader = 'scenario_id,title,expected_cause,predicted_cause,confidence,correct,latency_ms,hypotheses_count\n';
  const csvRows = results.map(r =>
    `${r.scenario_id},"${r.title}",${r.expected_cause},"${r.predicted_cause}",${r.confidence},${r.correct},${r.latency_ms},${r.hypotheses_count}`
  ).join('\n');
  const csvPath = 'tests/calibration/rca-calibration-results.csv';
  writeFileSync(csvPath, csvHeader + csvRows + '\n');

  // Summary statistics
  const total = incidentCorpus.length;
  const errorCount = results.filter(r => r.correct === 'ERROR').length;
  const accuracy = ((passCount / (total - errorCount)) * 100).toFixed(1);
  const avgConfidence = (totalConfidence / total).toFixed(1);
  const avgCorrectConfidence = correctCount > 0 ? (correctConfidenceSum / correctCount).toFixed(1) : 'N/A';
  const avgIncorrectConfidence = (total - correctCount - errorCount) > 0
    ? (incorrectConfidenceSum / (total - correctCount - errorCount)).toFixed(1) : 'N/A';

  console.log('\n\n=== CALIBRATION SUMMARY ===');
  console.log(`Total scenarios: ${total}`);
  console.log(`Correct: ${passCount}`);
  console.log(`Incorrect: ${total - passCount - errorCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Accuracy: ${accuracy}%`);
  console.log(`Avg confidence (all): ${avgConfidence}%`);
  console.log(`Avg confidence (correct): ${avgCorrectConfidence}%`);
  console.log(`Avg confidence (incorrect): ${avgIncorrectConfidence}%`);
  console.log(`Confidence gap (correct - incorrect): ${avgCorrectConfidence !== 'N/A' && avgIncorrectConfidence !== 'N/A' ? (parseFloat(avgCorrectConfidence) - parseFloat(avgIncorrectConfidence)).toFixed(1) : 'N/A'}%`);
  console.log(`\nResults written to: ${csvPath}`);

  // Write summary to file
  const summaryPath = 'tests/calibration/rca-calibration-summary.txt';
  const summary = [
    `RCA Calibration Summary — ${new Date().toISOString()}`,
    `Model: gemini-3.6-flash (LLM_MODE=live)`,
    `Total scenarios: ${total}`,
    `Correct: ${passCount}`,
    `Incorrect: ${total - passCount - errorCount}`,
    `Errors: ${errorCount}`,
    `Accuracy: ${accuracy}%`,
    `Avg confidence (all): ${avgConfidence}%`,
    `Avg confidence (correct): ${avgCorrectConfidence}%`,
    `Avg confidence (incorrect): ${avgIncorrectConfidence}%`,
    `Confidence gap: ${avgCorrectConfidence !== 'N/A' && avgIncorrectConfidence !== 'N/A' ? (parseFloat(avgCorrectConfidence) - parseFloat(avgIncorrectConfidence)).toFixed(1) : 'N/A'}%`,
  ].join('\n');
  writeFileSync(summaryPath, summary + '\n');
}

runCalibration();
