import { randomUUID } from 'node:crypto';
import type { EvidenceObject } from '@ai-sre/event-schema';

export class ObservabilityAgent {
  public async investigate(incidentId: string, context: {
    service: string;
    metricsBaseline?: any;
  }): Promise<EvidenceObject[]> {
    const evidenceList: EvidenceObject[] = [];

    // 1. Error rate anomaly
    evidenceList.push({
      id: randomUUID(),
      incidentId,
      type: 'METRIC_ANOMALY',
      source: 'prometheus',
      title: 'HTTP 5xx Error Rate Spike (6.8%)',
      summary: `HTTP 5xx responses for ${context.service} spiked to 6.8% (normal baseline < 0.05%). Alert HighErrorRate5xx firing.`,
      confidence: 98,
      isContradictory: false,
      provenance: {
        sourceSystem: 'prometheus-k8s',
        queryOrFilter: `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100`,
        extractedAt: new Date().toISOString(),
        untrustedInputHash: 'prom_err_hash_456'
      },
      data: {
        currentValue: 6.8,
        baselineValue: 0.04,
        threshold: 1.0,
        unit: 'percent'
      }
    });

    // 2. Memory usage curve
    evidenceList.push({
      id: randomUUID(),
      incidentId,
      type: 'BASELINE_DEVIATION',
      source: 'prometheus',
      title: 'Monotonic Memory Growth Anomaly (Leak Signature)',
      summary: `Pod memory usage showed steep linear growth from 180Mi to 512Mi limit within 7 minutes of deployment rollout.`,
      confidence: 94,
      isContradictory: false,
      provenance: {
        sourceSystem: 'prometheus-k8s',
        queryOrFilter: `container_memory_working_set_bytes{container="${context.service}"}`,
        extractedAt: new Date().toISOString(),
        untrustedInputHash: 'prom_mem_hash_789'
      },
      data: {
        slope: 'positive_linear_steep',
        startingMb: 180,
        peakMb: 512,
        leakSignatureDetected: true
      }
    });

    return evidenceList;
  }
}
