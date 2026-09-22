/**
 * Observability Agent — Real PromQL Metrics & Anomaly Investigation
 * 
 * PRD v3.0 Mandate:
 * - Strictly live: No mock or offline simulation paths.
 * - Queries in-cluster Prometheus directly for real container metrics.
 * - Gathers evidence with cryptographic provenance hashes from live API.
 */

import { randomUUID, createHash } from 'node:crypto';
import type { EvidenceObject } from '@ai-sre/event-schema';
import { PrometheusClient } from './prometheus-client.js';

export class ObservabilityAgent {
  private client: PrometheusClient;

  constructor(options?: { prometheusUrl?: string }) {
    this.client = new PrometheusClient({ baseUrl: options?.prometheusUrl });
    console.log(`[ObservabilityAgent] LIVE mode — connected to Prometheus at ${this.client.getBaseUrl()}`);
  }

  public async investigate(incidentId: string, context: {
    service: string;
    namespace?: string;
    metricsBaseline?: any;
  }): Promise<EvidenceObject[]> {
    return this.investigateLive(incidentId, context);
  }

  /**
   * LIVE: Query Prometheus directly for real container metrics
   */
  private async investigateLive(incidentId: string, context: {
    service: string;
    namespace?: string;
  }): Promise<EvidenceObject[]> {
    const evidenceList: EvidenceObject[] = [];
    const namespace = context.namespace || process.env.K8S_NAMESPACE || 'sre-demo';
    const service = context.service;

    // 1. Query container memory working set bytes
    const memQuery = `container_memory_working_set_bytes{container="${service}",namespace="${namespace}"}`;
    try {
      const memResults = await this.client.query(memQuery);

      if (memResults.length > 0) {
        const podValues = memResults.map(r => ({
          pod: r.metric.pod || 'unknown',
          bytes: parseInt(r.value[1], 10),
          mb: Math.round(parseInt(r.value[1], 10) / (1024 * 1024))
        }));

        const totalMb = podValues.reduce((acc, v) => acc + v.mb, 0);
        const avgMb = Math.round(totalMb / podValues.length);
        const maxMb = Math.max(...podValues.map(v => v.mb));

        const isElevated = maxMb > 350;
        const summary = `Memory working set across ${podValues.length} pod(s) of '${service}' in '${namespace}': avg ${avgMb}MB, peak ${maxMb}MB.`;

        evidenceList.push({
          id: randomUUID(),
          incidentId,
          type: isElevated ? 'METRIC_ANOMALY' : 'BASELINE_DEVIATION',
          source: 'prometheus',
          title: `Container Memory Working Set: ${avgMb}MB avg`,
          summary,
          confidence: isElevated ? 94 : 85,
          isContradictory: maxMb < 100,
          provenance: {
            sourceSystem: this.client.getBaseUrl(),
            queryOrFilter: memQuery,
            extractedAt: new Date().toISOString(),
            untrustedInputHash: createHash('sha256').update(JSON.stringify(memResults)).digest('hex').substring(0, 16)
          },
          data: {
            service,
            namespace,
            podCount: podValues.length,
            averageMb: avgMb,
            peakMb: maxMb,
            pods: podValues
          }
        });
      }
    } catch (err: any) {
      console.warn(`[ObservabilityAgent] Memory query error: ${err.message}`);
    }

    // 2. Query container restarts
    const restartQuery = `kube_pod_container_status_restarts_total{container="${service}",namespace="${namespace}"}`;
    try {
      const restartResults = await this.client.query(restartQuery);

      if (restartResults.length > 0) {
        const restarts = restartResults.reduce((acc, r) => acc + parseInt(r.value[1], 10), 0);
        if (restarts > 0) {
          evidenceList.push({
            id: randomUUID(),
            incidentId,
            type: 'METRIC_ANOMALY',
            source: 'prometheus',
            title: `Container Restarts Detected (${restarts} total)`,
            summary: `Pods of '${service}' accumulated ${restarts} container restart(s) in namespace '${namespace}'.`,
            confidence: 96,
            isContradictory: false,
            provenance: {
              sourceSystem: this.client.getBaseUrl(),
              queryOrFilter: restartQuery,
              extractedAt: new Date().toISOString(),
              untrustedInputHash: createHash('sha256').update(JSON.stringify(restartResults)).digest('hex').substring(0, 16)
            },
            data: {
              totalRestarts: restarts
            }
          });
        }
      }
    } catch (err: any) {
      console.warn(`[ObservabilityAgent] Restarts query error: ${err.message}`);
    }

    // 3. Query general cluster scrape health for baseline
    const upQuery = `up{namespace="${namespace}"}`;
    try {
      const upResults = await this.client.query(upQuery);
      if (upResults.length > 0) {
        evidenceList.push({
          id: randomUUID(),
          incidentId,
          type: 'BASELINE_DEVIATION',
          source: 'prometheus',
          title: `Prometheus Scrape Status: ${upResults.length} target(s) monitored`,
          summary: `Active scrape targets reporting in namespace '${namespace}': ${upResults.length} target(s).`,
          confidence: 90,
          isContradictory: false,
          provenance: {
            sourceSystem: this.client.getBaseUrl(),
            queryOrFilter: upQuery,
            extractedAt: new Date().toISOString(),
            untrustedInputHash: createHash('sha256').update(JSON.stringify(upResults)).digest('hex').substring(0, 16)
          },
          data: {
            targetCount: upResults.length
          }
        });
      }
    } catch (err: any) {
      console.warn(`[ObservabilityAgent] Scrape health query error: ${err.message}`);
    }

    console.log(`[ObservabilityAgent] LIVE investigation: gathered ${evidenceList.length} evidence items for ${service}`);
    return evidenceList;
  }
}

export * from './prometheus-client.js';
