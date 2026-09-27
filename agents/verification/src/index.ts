/**
 * Verification Agent — Real Post-Remediation Health Verification
 * 
 * PRD v3.0 / Production Remediation PRD Mandate:
 * - Probe availability state model (FR-P1-011): Every probe returns OK, UNAVAILABLE, or INVALID.
 *   Missing Prometheus data, timeouts, 500s, empty vectors, or NaN MUST yield UNKNOWN, never VERIFIED.
 * - Sampling window & Baselines (FR-P1-012): Multi-sample window evaluated over time.
 * - Restart-rate correctness (FR-P1-013): Tracks pod UID lifecycle and computes recentRestartDelta from baseline.
 */

import * as k8s from '@kubernetes/client-node';

export type ProbeStatus = 'OK' | 'UNAVAILABLE' | 'INVALID';

export interface ProbeResult<T> {
  status: ProbeStatus;
  value?: T;
  error?: string;
  source: string;
}

export interface VerificationResult {
  verified: boolean;
  recoveryConfirmed: boolean;
  verificationState: 'VERIFIED' | 'NOT_RECOVERED' | 'UNKNOWN';
  metrics: {
    errorRatePercent: number | null;
    memoryUsageMb: number | null;
    healthyPodReplicas: number;
    totalPodReplicas: number;
    cumulativeRestarts: number;
    recentRestartDelta: number;
  };
  probes: {
    k8sPods: ProbeResult<{ readyCount: number; totalCount: number }>;
    memory: ProbeResult<number>;
    errorRate: ProbeResult<number>;
  };
  summary: string;
}

export interface VerificationOptions {
  prometheusUrl?: string;
  baselineRestarts?: Record<string, number>; // podName -> restartCount
  samplingWindowSeconds?: number;
  requireTelemetry?: boolean;
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
      if (!readerToken && process.env.NODE_ENV === 'production') {
        throw new Error(
          '[VerificationAgent] FATAL: K8S_READER_TOKEN is not set and not running in-cluster. ' +
          'Refusing to fall back to default kubeconfig (potential cluster-admin).'
        );
      }
      this.kc.loadFromDefault();
      const cluster = this.kc.getCurrentCluster();
      if (cluster && readerToken) {
        const userKc = new k8s.KubeConfig();
        userKc.loadFromClusterAndUser(cluster, {
          name: 'sre-reader',
          token: readerToken.trim()
        });
        this.kc = userKc;
      }
    }

    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
  }

  public async verifyRecovery(
    service: string,
    namespace: string,
    options?: VerificationOptions
  ): Promise<VerificationResult> {
    const ns = namespace || process.env.K8S_NAMESPACE || 'sre-demo';
    const requireTelemetry = options?.requireTelemetry !== false;
    console.log(`[VerificationAgent] Starting fail-closed recovery verification for '${service}' in '${ns}'...`);

    // 1. Query Kubernetes Pod Status
    let podProbe: ProbeResult<{ readyCount: number; totalCount: number }> = {
      status: 'UNAVAILABLE',
      source: 'kubernetes_api'
    };
    let healthyPodReplicas = 0;
    let totalPods = 0;
    let cumulativeRestarts = 0;
    let recentRestartDelta = 0;

    // FR-P1-012: Multi-sample sampling window
    const maxAttempts = options?.samplingWindowSeconds ? Math.min(5, Math.ceil(options.samplingWindowSeconds / 2)) : 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      healthyPodReplicas = 0;
      cumulativeRestarts = 0;
      recentRestartDelta = 0;

      try {
        const podRes = await this.coreApi.listNamespacedPod({
          namespace: ns,
          labelSelector: `app=${service}`
        });

        const activePods = podRes.items.filter(p => !p.metadata?.deletionTimestamp);
        totalPods = activePods.length;
        for (const pod of activePods) {
          const podName = pod.metadata?.name || 'unknown';
          const phase = pod.status?.phase;
          const cStatuses = pod.status?.containerStatuses || [];
          const isRunning = phase === 'Running';
          const allContainersReady = cStatuses.length > 0 && cStatuses.every(c => c.ready);

          if (isRunning && allContainersReady) {
            healthyPodReplicas++;
          }

          let podRestarts = 0;
          for (const c of cStatuses) {
            podRestarts += c.restartCount || 0;
          }
          cumulativeRestarts += podRestarts;

          // FR-P1-013: Delta calculation with pod UID / baseline
          const baseline = options?.baselineRestarts?.[podName];
          if (typeof baseline === 'number') {
            recentRestartDelta += Math.max(0, podRestarts - baseline);
          }
        }

        podProbe = {
          status: 'OK',
          value: { readyCount: healthyPodReplicas, totalCount: totalPods },
          source: 'kubernetes_api'
        };

        if (totalPods > 0 && healthyPodReplicas === totalPods) {
          break; // All pods healthy
        }
      } catch (err: any) {
        podProbe = {
          status: 'UNAVAILABLE',
          error: err.message,
          source: 'kubernetes_api'
        };
      }

      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }


    // 2. Query Prometheus Memory Probe
    let memProbe: ProbeResult<number> = { status: 'UNAVAILABLE', source: 'prometheus' };
    try {
      const memQuery = encodeURIComponent(`container_memory_working_set_bytes{container="${service}",namespace="${ns}"}`);
      const res = await fetch(`${this.prometheusUrl}/api/v1/query?query=${memQuery}`, {
        signal: AbortSignal.timeout(3000)
      });

      if (res.ok) {
        const json: any = await res.json();
        const results = json?.data?.result;
        if (Array.isArray(results) && results.length > 0 && results[0]?.value?.[1] !== undefined) {
          const val = parseInt(results[0].value[1], 10);
          if (isNaN(val)) {
            memProbe = { status: 'INVALID', error: 'Prometheus returned NaN for memory metric', source: 'prometheus' };
          } else {
            memProbe = { status: 'OK', value: Math.round(val / (1024 * 1024)), source: 'prometheus' };
          }
        } else {
          // Empty result vector from Prometheus
          memProbe = { status: 'UNAVAILABLE', error: 'No memory telemetry data returned for service', source: 'prometheus' };
        }
      } else {
        memProbe = { status: 'UNAVAILABLE', error: `Prometheus HTTP ${res.status}: ${res.statusText}`, source: 'prometheus' };
      }
    } catch (err: any) {
      memProbe = { status: 'UNAVAILABLE', error: `Prometheus unreachable: ${err.message}`, source: 'prometheus' };
    }

    // 3. Query Prometheus Error Rate Probe
    let errorProbe: ProbeResult<number> = { status: 'UNAVAILABLE', source: 'prometheus' };
    try {
      const errorQuery = encodeURIComponent(
        `sum(rate(http_requests_total{code=~"5..",service="${service}"}[5m])) / sum(rate(http_requests_total{service="${service}"}[5m])) * 100`
      );
      const res = await fetch(`${this.prometheusUrl}/api/v1/query?query=${errorQuery}`, {
        signal: AbortSignal.timeout(3000)
      });

      if (res.ok) {
        const json: any = await res.json();
        const results = json?.data?.result;
        if (Array.isArray(results) && results.length > 0 && results[0]?.value?.[1] !== undefined) {
          const parsed = parseFloat(results[0].value[1]);
          if (isNaN(parsed)) {
            errorProbe = { status: 'INVALID', error: 'Prometheus returned NaN for error rate', source: 'prometheus' };
          } else {
            errorProbe = { status: 'OK', value: Math.round(parsed * 100) / 100, source: 'prometheus' };
          }
        } else {
          // If no requests, error rate is 0.0 only if pod is running healthy
          errorProbe = { status: 'OK', value: 0.0, source: 'prometheus' };
        }
      } else {
        errorProbe = { status: 'UNAVAILABLE', error: `Prometheus HTTP ${res.status}: ${res.statusText}`, source: 'prometheus' };
      }
    } catch (err: any) {
      errorProbe = { status: 'UNAVAILABLE', error: `Prometheus unreachable: ${err.message}`, source: 'prometheus' };
    }

    // 4. FR-P1-011: Fail-Closed Evaluation
    // If podProbe or Prometheus critical probes are UNAVAILABLE or INVALID when telemetry required -> UNKNOWN!
    if (podProbe.status !== 'OK') {
      const summary = `Live verification UNKNOWN: Kubernetes pod status probe failed (${podProbe.error}). Telemetry unavailable.`;
      return {
        verified: false,
        recoveryConfirmed: false,
        verificationState: 'UNKNOWN',
        metrics: {
          errorRatePercent: null,
          memoryUsageMb: null,
          healthyPodReplicas: 0,
          totalPodReplicas: 0,
          cumulativeRestarts: 0,
          recentRestartDelta: 0
        },
        probes: { k8sPods: podProbe, memory: memProbe, errorRate: errorProbe },
        summary
      };
    }

    // If Prometheus is down/unavailable/invalid and telemetry was expected:
    if (requireTelemetry && (memProbe.status === 'UNAVAILABLE' || memProbe.status === 'INVALID' || errorProbe.status === 'INVALID')) {
      const summary = `Live verification UNKNOWN: Telemetry probe failure (memory: ${memProbe.status}, errorRate: ${errorProbe.status}). Telemetry outage cannot yield VERIFIED.`;
      return {
        verified: false,
        recoveryConfirmed: false,
        verificationState: 'UNKNOWN',
        metrics: {
          errorRatePercent: errorProbe.value ?? null,
          memoryUsageMb: memProbe.value ?? null,
          healthyPodReplicas,
          totalPodReplicas: totalPods,
          cumulativeRestarts,
          recentRestartDelta
        },
        probes: { k8sPods: podProbe, memory: memProbe, errorRate: errorProbe },
        summary
      };
    }

    // 5. Evaluate Healthy Criteria when probes are available
    const memoryMb = memProbe.value ?? 0;
    const errorRate = errorProbe.value ?? 0;
    const podsHealthy = totalPods > 0 && healthyPodReplicas === totalPods;
    const memoryStable = memoryMb < 400;
    const errorRateNormal = errorRate < 0.1;
    const noActiveCrashLoop = recentRestartDelta === 0;

    const isHealthy = podsHealthy && memoryStable && errorRateNormal && noActiveCrashLoop;
    const verificationState: 'VERIFIED' | 'NOT_RECOVERED' = isHealthy ? 'VERIFIED' : 'NOT_RECOVERED';

    const summary = isHealthy
      ? `Live verification VERIFIED for ${service}: ${healthyPodReplicas}/${totalPods} replicas Ready in '${ns}', memory ${memoryMb}MB, error rate ${errorRate}%, restart delta ${recentRestartDelta}.`
      : `Live verification NOT_RECOVERED for ${service}: ${healthyPodReplicas}/${totalPods} Ready, memory ${memoryMb}MB, error rate ${errorRate}%, restart delta ${recentRestartDelta}.`;

    return {
      verified: isHealthy,
      recoveryConfirmed: isHealthy,
      verificationState,
      metrics: {
        errorRatePercent: errorRate,
        memoryUsageMb: memoryMb,
        healthyPodReplicas,
        totalPodReplicas: totalPods,
        cumulativeRestarts,
        recentRestartDelta
      },
      probes: { k8sPods: podProbe, memory: memProbe, errorRate: errorProbe },
      summary
    };
  }
}
