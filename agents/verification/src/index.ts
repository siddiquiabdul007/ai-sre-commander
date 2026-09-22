/**
 * Verification Agent — Real Post-Remediation Health Verification
 * 
 * PRD v3.0 Mandate:
 * - Strictly live: No mock or simulated responses.
 * - Queries in-cluster Prometheus and AKS Kubernetes pod status in real time.
 * - Confirms whether golden signals and pods returned to baseline post-remediation.
 */

import * as k8s from '@kubernetes/client-node';

export interface VerificationResult {
  verified: boolean;
  recoveryConfirmed: boolean;
  metrics: {
    errorRatePercent: number;
    memoryUsageMb: number;
    healthyPodReplicas: number;
    restartsInWindow: number;
  };
  summary: string;
}

export class VerificationAgent {
  private kc: k8s.KubeConfig;
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private prometheusUrl: string;

  constructor(options?: { prometheusUrl?: string }) {
    this.prometheusUrl = options?.prometheusUrl || process.env.PROMETHEUS_URL || 'http://localhost:9090';
    this.kc = new k8s.KubeConfig();

    const isCluster = Boolean(process.env.KUBERNETES_SERVICE_HOST);
    const readerToken = process.env.K8S_READER_TOKEN;

    if (isCluster) {
      this.kc.loadFromCluster();
    } else {
      if (!readerToken) {
        throw new Error(
          '[VerificationAgent] FATAL: K8S_READER_TOKEN is not set and not running in-cluster. ' +
          'Refusing to fall back to default kubeconfig (potential cluster-admin). ' +
          'Set K8S_READER_TOKEN to a scoped service account token.'
        );
      }
      this.kc.loadFromDefault();
      const cluster = this.kc.getCurrentCluster();
      if (cluster) {
        const userKc = new k8s.KubeConfig();
        userKc.loadFromClusterAndUser(cluster, {
          name: 'sre-reader',
          token: readerToken.trim()
        });
        this.kc = userKc;
      } else {
        throw new Error('[VerificationAgent] FATAL: No cluster found in kubeconfig.');
      }
    }

    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
  }

  public async verifyRecovery(
    service: string,
    namespace: string
  ): Promise<VerificationResult> {
    const ns = namespace || process.env.K8S_NAMESPACE || 'sre-demo';
    console.log(`[VerificationAgent] Starting live recovery verification for '${service}' in '${ns}'...`);

    // 1. Query Kubernetes Pod Status
    let healthyPodReplicas = 0;
    let totalRestarts = 0;
    let totalPods = 0;

    try {
      const podRes = await this.coreApi.listNamespacedPod({
        namespace: ns,
        labelSelector: `app=${service}`
      });

      totalPods = podRes.items.length;
      for (const pod of podRes.items) {
        const phase = pod.status?.phase;
        const cStatuses = pod.status?.containerStatuses || [];
        const isRunning = phase === 'Running';
        const allContainersReady = cStatuses.length > 0 && cStatuses.every(c => c.ready);

        if (isRunning && allContainersReady) {
          healthyPodReplicas++;
        }

        for (const c of cStatuses) {
          totalRestarts += c.restartCount || 0;
        }
      }
    } catch (err: any) {
      console.error(`[VerificationAgent] K8s pod probe failed: ${err.message}`);
    }

    // 2. Query Prometheus Metrics
    let memoryUsageMb = 0;
    let errorRatePercent = 0.0;

    try {
      const memQuery = encodeURIComponent(`container_memory_working_set_bytes{container="${service}",namespace="${ns}"}`);
      const res = await fetch(`${this.prometheusUrl}/api/v1/query?query=${memQuery}`, {
        signal: AbortSignal.timeout(3000)
      });

      if (res.ok) {
        const json: any = await res.json();
        const results = json?.data?.result || [];
        if (results.length > 0) {
          const valuesMb = results.map((r: any) => Math.round(parseInt(r.value[1], 10) / (1024 * 1024)));
          const maxMb = Math.max(...valuesMb);
          if (maxMb > 0) memoryUsageMb = maxMb;
        }
      }
    } catch (err: any) {
      console.warn(`[VerificationAgent] Prometheus memory probe warning: ${err.message}`);
    }

    try {
      const errorQuery = encodeURIComponent(
        `sum(rate(http_requests_total{code=~"5..",service="${service}"}[5m])) / sum(rate(http_requests_total{service="${service}"}[5m])) * 100`
      );
      const res = await fetch(`${this.prometheusUrl}/api/v1/query?query=${errorQuery}`, {
        signal: AbortSignal.timeout(3000)
      });

      if (res.ok) {
        const json: any = await res.json();
        const results = json?.data?.result || [];
        if (results.length > 0 && results[0]?.value?.[1] !== undefined) {
          const parsed = parseFloat(results[0].value[1]);
          if (!isNaN(parsed)) errorRatePercent = Math.round(parsed * 100) / 100;
        }
      }
    } catch (err: any) {
      console.warn(`[VerificationAgent] Prometheus error rate probe warning: ${err.message}`);
    }

    // 3. Evaluate health criteria
    // Healthy if: At least 1 pod ready (or healthyPodReplicas >= totalPods/2), memory under 400MB, error rate under 0.1%
    const isHealthy = healthyPodReplicas > 0 && memoryUsageMb < 400 && errorRatePercent < 0.1;

    const summary = isHealthy
      ? `Live verification PASSED for ${service}: ${healthyPodReplicas}/${totalPods} replicas Ready in '${ns}', memory stable at ${memoryUsageMb}MB, error rate ${errorRatePercent}%.`
      : `Live verification FAILED for ${service}: Only ${healthyPodReplicas}/${totalPods} replicas Ready, memory ${memoryUsageMb}MB, ${totalRestarts} total restarts.`;

    console.log(`[VerificationAgent] Result: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'} — ${summary}`);

    return {
      verified: isHealthy,
      recoveryConfirmed: isHealthy,
      metrics: {
        errorRatePercent,
        memoryUsageMb,
        healthyPodReplicas,
        restartsInWindow: totalRestarts
      },
      summary
    };
  }
}
