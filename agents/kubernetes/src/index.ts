import { randomUUID } from 'node:crypto';
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
  public async investigate(incidentId: string, context: {
    service: string;
    namespace: string;
    cluster: string;
    k8sEvents?: any[];
  }): Promise<EvidenceObject[]> {
    const evidenceList: EvidenceObject[] = [];

    // Analyze pod termination and resource limits
    const podName = `${context.service}-7b9d9c-f12`;
    const isOOM = true; // In production this calls AKS / K8s client

    evidenceList.push({
      id: randomUUID(),
      incidentId,
      type: 'K8S_EVENT',
      source: 'kubernetes',
      title: `Pod OOMKilled and CrashLoopBackOff on ${podName}`,
      summary: `Container in pod '${podName}' exceeded memory limit (512Mi) with exit code 137. 4 restarts in the last 10 minutes.`,
      confidence: 96,
      isContradictory: false,
      provenance: {
        sourceSystem: 'aks-primary-eu/payments',
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
    });

    return evidenceList;
  }
}
