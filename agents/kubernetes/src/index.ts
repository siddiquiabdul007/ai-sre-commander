/**
 * Kubernetes Investigation Agent — Real Pod/Event Queries
 * 
 * PRD v2.0 §3.2: Real K8s API calls for evidence gathering.
 * - K8S_MODE=live: Real pod status, events, container termination via @kubernetes/client-node
 * - K8S_MODE=offline: Deterministic simulated evidence (existing behavior)
 */

import { randomUUID } from 'node:crypto';
import * as k8s from '@kubernetes/client-node';
import type { EvidenceObject } from '@ai-sre/event-schema';
import { createHash } from 'node:crypto';

export interface PodConditionSummary {
  podName: string;
  phase: string;
  restartCount: number;
  lastTerminationReason?: string;
  exitCode?: number;
  isOOMKilled: boolean;
}

type K8sMode = 'live' | 'offline';

export class KubernetesAgent {
  private mode: K8sMode;
  private kc: k8s.KubeConfig | null = null;
  private coreApi: k8s.CoreV1Api | null = null;
  private appsApi: k8s.AppsV1Api | null = null;

  constructor() {
    this.mode = (process.env.K8S_MODE as K8sMode) || 'offline';

    if (this.mode === 'live') {
      try {
        this.kc = new k8s.KubeConfig();
        if (process.env.KUBERNETES_SERVICE_HOST) {
          this.kc.loadFromCluster();
        } else {
          this.kc.loadFromDefault();
        }
        this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
        this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
        console.log('[KubernetesAgent] LIVE mode — real K8s API calls enabled.');
      } catch (error: any) {
        console.warn(`[KubernetesAgent] Failed to init K8s client: ${error.message}. Falling back to offline.`);
        this.mode = 'offline';
      }
    } else {
      console.log('[KubernetesAgent] OFFLINE mode — deterministic evidence.');
    }
  }

  public async investigate(incidentId: string, context: {
    service: string;
    namespace: string;
    cluster: string;
    k8sEvents?: any[];
  }): Promise<EvidenceObject[]> {
    if (this.mode === 'live' && this.coreApi && this.appsApi) {
      return this.investigateLive(incidentId, context);
    }
    return this.investigateOffline(incidentId, context);
  }

  /**
   * LIVE: Query real K8s API for pod status, events, and container state
   */
  private async investigateLive(incidentId: string, context: {
    service: string;
    namespace: string;
    cluster: string;
  }): Promise<EvidenceObject[]> {
    const evidenceList: EvidenceObject[] = [];
    const namespace = context.namespace || process.env.K8S_NAMESPACE || 'sre-demo';

    // 1. Query pods with label selector
    try {
      const podResponse = await this.coreApi!.listNamespacedPod({
        namespace,
        labelSelector: `app=${context.service}`,
      });
      const pods = podResponse.items;

      for (const pod of pods) {
        const podName = pod.metadata?.name || 'unknown';
        const phase = pod.status?.phase || 'Unknown';
        const containerStatuses = pod.status?.containerStatuses || [];

        for (const cs of containerStatuses) {
          const restartCount = cs.restartCount || 0;
          const terminated = cs.lastState?.terminated;
          const isOOM = terminated?.reason === 'OOMKilled';
          const exitCode = terminated?.exitCode;

          // Only emit evidence for notable conditions
          if (restartCount > 0 || isOOM || phase !== 'Running') {
            const summary = isOOM
              ? `Container '${cs.name}' in pod '${podName}' was OOMKilled (exit code ${exitCode}). ${restartCount} restarts.`
              : restartCount > 2
              ? `Container '${cs.name}' in pod '${podName}' has ${restartCount} restarts. Phase: ${phase}.`
              : `Pod '${podName}' in phase '${phase}', container '${cs.name}' has ${restartCount} restart(s).`;

            evidenceList.push({
              id: randomUUID(),
              incidentId,
              type: 'K8S_EVENT',
              source: 'kubernetes',
              title: isOOM ? `Pod OOMKilled: ${podName}` : `Pod Unhealthy: ${podName}`,
              summary,
              confidence: isOOM ? 96 : 80,
              isContradictory: false,
              provenance: {
                sourceSystem: `${context.cluster}/${namespace}`,
                queryOrFilter: `kubectl get pods -n ${namespace} -l app=${context.service}`,
                extractedAt: new Date().toISOString(),
                untrustedInputHash: createHash('sha256').update(summary).digest('hex').substring(0, 16)
              },
              data: {
                podName,
                namespace,
                phase,
                containerName: cs.name,
                restartCount,
                exitCode,
                reason: terminated?.reason || 'N/A',
                isOOMKilled: isOOM,
                memoryLimit: pod.spec?.containers?.[0]?.resources?.limits?.memory || 'unknown',
                ready: cs.ready
              }
            });
          }
        }

        // If all containers are healthy, emit a contradictory evidence
        if (phase === 'Running' && containerStatuses.every(cs => cs.ready && cs.restartCount === 0)) {
          evidenceList.push({
            id: randomUUID(),
            incidentId,
            type: 'K8S_EVENT',
            source: 'kubernetes',
            title: `Pod Healthy: ${podName}`,
            summary: `Pod '${podName}' is Running with all containers ready, 0 restarts.`,
            confidence: 70,
            isContradictory: true,
            provenance: {
              sourceSystem: `${context.cluster}/${namespace}`,
              queryOrFilter: `kubectl get pods -n ${namespace} -l app=${context.service}`,
              extractedAt: new Date().toISOString(),
              untrustedInputHash: createHash('sha256').update(podName).digest('hex').substring(0, 16)
            },
            data: { podName, namespace, phase, ready: true, restartCount: 0 }
          });
        }
      }

      if (pods.length === 0) {
        evidenceList.push({
          id: randomUUID(),
          incidentId,
          type: 'K8S_EVENT',
          source: 'kubernetes',
          title: `No pods found for ${context.service}`,
          summary: `No pods matching label app=${context.service} found in namespace ${namespace}.`,
          confidence: 90,
          isContradictory: false,
          provenance: {
            sourceSystem: `${context.cluster}/${namespace}`,
            queryOrFilter: `kubectl get pods -n ${namespace} -l app=${context.service}`,
            extractedAt: new Date().toISOString(),
            untrustedInputHash: createHash('sha256').update('no-pods').digest('hex').substring(0, 16)
          },
          data: { namespace, labelSelector: `app=${context.service}`, podCount: 0 }
        });
      }
    } catch (error: any) {
      console.error(`[KubernetesAgent] Pod query failed: ${error.message}`);
      evidenceList.push({
        id: randomUUID(),
        incidentId,
        type: 'K8S_EVENT',
        source: 'kubernetes',
        title: 'K8s API query failed',
        summary: `Failed to query pods: ${error.message}`,
        confidence: 50,
        isContradictory: false,
        provenance: {
          sourceSystem: `${context.cluster}/${namespace}`,
          extractedAt: new Date().toISOString(),
          untrustedInputHash: createHash('sha256').update(error.message).digest('hex').substring(0, 16)
        },
        data: { error: error.message }
      });
    }

    // 2. Query namespace events
    try {
      const eventResponse = await this.coreApi!.listNamespacedEvent({
        namespace,
      });
      const events = eventResponse.items;

      // Filter for warning/error events in the last 30 minutes
      const cutoff = new Date(Date.now() - 30 * 60 * 1000);
      const recentWarnings = events.filter(e => {
        const eventTime = e.lastTimestamp ? new Date(e.lastTimestamp) : new Date(0);
        return e.type === 'Warning' && eventTime > cutoff;
      });

      if (recentWarnings.length > 0) {
        const warningsSummary = recentWarnings
          .slice(0, 5)
          .map(e => `[${e.reason}] ${e.involvedObject?.name}: ${e.message}`)
          .join(' | ');

        evidenceList.push({
          id: randomUUID(),
          incidentId,
          type: 'K8S_EVENT',
          source: 'kubernetes',
          title: `${recentWarnings.length} Warning Events in ${namespace}`,
          summary: `Recent warning events: ${warningsSummary}`,
          confidence: 75,
          isContradictory: false,
          provenance: {
            sourceSystem: `${context.cluster}/${namespace}`,
            queryOrFilter: `kubectl get events -n ${namespace} --field-selector type=Warning`,
            extractedAt: new Date().toISOString(),
            untrustedInputHash: createHash('sha256').update(warningsSummary).digest('hex').substring(0, 16)
          },
          data: {
            eventCount: recentWarnings.length,
            events: recentWarnings.slice(0, 5).map(e => ({
              reason: e.reason,
              message: e.message,
              object: e.involvedObject?.name,
              count: e.count,
              lastTimestamp: e.lastTimestamp
            }))
          }
        });
      }
    } catch (error: any) {
      console.warn(`[KubernetesAgent] Event query failed: ${error.message}`);
    }

    // 3. Query deployment rollout status
    try {
      const deployment = await this.appsApi!.readNamespacedDeployment({
        name: context.service,
        namespace,
      });

      const revision = deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'] || 'unknown';
      const replicas = deployment.status?.replicas || 0;
      const readyReplicas = deployment.status?.readyReplicas || 0;
      const unavailable = deployment.status?.unavailableReplicas || 0;
      const image = deployment.spec?.template?.spec?.containers?.[0]?.image || 'unknown';

      if (unavailable > 0 || readyReplicas < replicas) {
        evidenceList.push({
          id: randomUUID(),
          incidentId,
          type: 'DEPLOYMENT_DIFF',
          source: 'kubernetes',
          title: `Deployment ${context.service} degraded`,
          summary: `Deployment '${context.service}' rev ${revision}: ${readyReplicas}/${replicas} ready, ${unavailable} unavailable. Image: ${image}.`,
          confidence: 88,
          isContradictory: false,
          provenance: {
            sourceSystem: `${context.cluster}/${namespace}`,
            queryOrFilter: `kubectl get deployment ${context.service} -n ${namespace}`,
            extractedAt: new Date().toISOString(),
            untrustedInputHash: createHash('sha256').update(`${context.service}-${revision}`).digest('hex').substring(0, 16)
          },
          data: { deployment: context.service, revision, replicas, readyReplicas, unavailable, image }
        });
      }
    } catch (error: any) {
      // Deployment may not exist — that's okay for some services
      if (error.statusCode !== 404) {
        console.warn(`[KubernetesAgent] Deployment query failed: ${error.message}`);
      }
    }

    console.log(`[KubernetesAgent] LIVE investigation: ${evidenceList.length} evidence items for ${context.service}`);
    return evidenceList;
  }

  /**
   * OFFLINE: Deterministic simulated evidence (original behavior)
   */
  private investigateOffline(incidentId: string, context: {
    service: string;
    namespace: string;
    cluster: string;
  }): EvidenceObject[] {
    const podName = `${context.service}-7b9d9c-f12`;

    return [{
      id: randomUUID(),
      incidentId,
      type: 'K8S_EVENT',
      source: 'kubernetes',
      title: `Pod OOMKilled and CrashLoopBackOff on ${podName}`,
      summary: `Container in pod '${podName}' exceeded memory limit (512Mi) with exit code 137. 4 restarts in the last 10 minutes.`,
      confidence: 96,
      isContradictory: false,
      provenance: {
        sourceSystem: `${context.cluster}/${context.namespace}`,
        queryOrFilter: `kubectl get pods -n ${context.namespace} -l app=${context.service}`,
        extractedAt: new Date().toISOString(),
        untrustedInputHash: 'k8s_ev_hash_123'
      },
      data: {
        podName,
        namespace: context.namespace,
        restartCount: 4,
        exitCode: 137,
        reason: 'OOMKilled',
        memoryLimit: '512Mi',
        currentMemoryUsage: '524Mi'
      }
    }];
  }
}
