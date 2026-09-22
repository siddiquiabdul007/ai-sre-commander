/**
 * Kubernetes Investigation Agent — Real Pod/Event Queries
 * 
 * PRD v3.0 Mandate:
 * - Strictly live: No mock or offline simulation paths.
 * - Authenticates with scoped 'sre-reader' service account credentials.
 * - Gathers real pod status, restarts, OOMKills, events, and deployment specs.
 */

import { randomUUID, createHash } from 'node:crypto';
import * as k8s from '@kubernetes/client-node';
import type { EvidenceObject } from '@ai-sre/event-schema';

export interface PodConditionSummary {
  podName: string;
  phase: string;
  restartCount: number;
  lastTerminationReason?: string;
  exitCode?: number;
  isOOMKilled: boolean;
}

export class KubernetesAgent {
  private kc: k8s.KubeConfig;
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;

  constructor() {
    this.kc = new k8s.KubeConfig();
    const isCluster = Boolean(process.env.KUBERNETES_SERVICE_HOST);
    const readerToken = process.env.K8S_READER_TOKEN;

    if (isCluster) {
      this.kc.loadFromCluster();
      console.log('[KubernetesAgent] LIVE mode — loaded in-cluster config.');
    } else {
      if (!readerToken) {
        throw new Error(
          '[KubernetesAgent] FATAL: K8S_READER_TOKEN is not set and not running in-cluster. ' +
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
        console.log(`[KubernetesAgent] LIVE mode — loaded scoped sre-reader credentials for ${cluster.server}.`);
      } else {
        throw new Error('[KubernetesAgent] FATAL: No cluster found in kubeconfig.');
      }
    }

    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
  }

  public async investigate(incidentId: string, context: {
    service: string;
    namespace: string;
    cluster: string;
    k8sEvents?: any[];
  }): Promise<EvidenceObject[]> {
    const evidenceList: EvidenceObject[] = [];
    const namespace = context.namespace || process.env.K8S_NAMESPACE || 'sre-demo';

    // 1. Query pods with label selector
    try {
      const podResponse = await this.coreApi.listNamespacedPod({
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

          // Emit evidence for notable conditions
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

        // If all containers are healthy, emit baseline evidence
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
      throw new Error(`[KubernetesAgent] Pod query failed: ${error.message}`);
    }

    // 2. Query namespace events
    try {
      const eventResponse = await this.coreApi.listNamespacedEvent({
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
      const deployment = await this.appsApi.readNamespacedDeployment({
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
      if (error.statusCode !== 404) {
        console.warn(`[KubernetesAgent] Deployment query failed: ${error.message}`);
      }
    }

    console.log(`[KubernetesAgent] LIVE investigation: gathered ${evidenceList.length} evidence items for ${context.service}`);
    return evidenceList;
  }
}
