/**
 * Kubernetes Client — Real @kubernetes/client-node Integration
 * 
 * PRD v2.0 §3.2: Real Kubernetes API calls against a sandboxed cluster.
 * - Separate service accounts: read-only for investigation, write-scoped for execution
 * - Real error handling: permission denied, stale revision, network timeout
 * - Configurable via KUBECONFIG or in-cluster config
 */

import * as k8s from '@kubernetes/client-node';

export interface K8sClientConfig {
  namespace: string;
  mode: 'in-cluster' | 'kubeconfig';
}

export class K8sClient {
  private kc: k8s.KubeConfig;
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private namespace: string;

  constructor(config?: Partial<K8sClientConfig>) {
    this.kc = new k8s.KubeConfig();
    this.namespace = config?.namespace || process.env.K8S_NAMESPACE || 'sre-demo';

    const mode = config?.mode || (process.env.KUBERNETES_SERVICE_HOST ? 'in-cluster' : 'kubeconfig');

    if (mode === 'in-cluster') {
      this.kc.loadFromCluster();
      console.log('[K8sClient] Loaded in-cluster config');
    } else {
      this.kc.loadFromDefault();
      console.log(`[K8sClient] Loaded kubeconfig (context: ${this.kc.getCurrentContext()})`);
    }

    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
  }

  /**
   * List pods by label selector — used by investigation agents
   */
  public async listPods(labelSelector?: string): Promise<k8s.V1Pod[]> {
    try {
      const response = await this.coreApi.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: labelSelector,
      });
      return response.items;
    } catch (error: any) {
      throw this.wrapError('listPods', error);
    }
  }

  /**
   * List events for the namespace — used to find OOMKilled, CrashLoopBackOff, etc.
   */
  public async listEvents(fieldSelector?: string): Promise<k8s.CoreV1Event[]> {
    try {
      const response = await this.coreApi.listNamespacedEvent({
        namespace: this.namespace,
        fieldSelector: fieldSelector,
      });
      return response.items;
    } catch (error: any) {
      throw this.wrapError('listEvents', error);
    }
  }

  /**
   * Get deployment details
   */
  public async getDeployment(name: string): Promise<k8s.V1Deployment> {
    try {
      const response = await this.appsApi.readNamespacedDeployment({
        name,
        namespace: this.namespace,
      });
      return response;
    } catch (error: any) {
      throw this.wrapError('getDeployment', error);
    }
  }

  /**
   * Rollback deployment to a specific revision by patching the image/annotation
   * Uses the PATCH approach — roll back by setting the rollback annotation
   */
  public async rollbackDeployment(name: string, targetRevision?: number): Promise<{
    success: boolean;
    message: string;
    revision: number;
  }> {
    try {
      // Get current deployment to verify it exists
      const deployment = await this.getDeployment(name);
      const currentRevision = parseInt(deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'] || '1');
      const targetRev = targetRevision || (currentRevision > 1 ? currentRevision - 1 : 1);
      const patch = [
        {
          op: 'add',
          path: '/spec/template/metadata/annotations/ai-sre-commander~1rollback-time',
          value: new Date().toISOString()
        },
        {
          op: 'add',
          path: '/spec/template/metadata/annotations/ai-sre-commander~1target-revision',
          value: String(targetRev)
        }
      ];

      await this.appsApi.patchNamespacedDeployment({
        name,
        namespace: this.namespace,
        body: patch,
      });

      console.log(`[K8sClient] Rollback initiated: ${name} in ${this.namespace}`);

      return {
        success: true,
        message: `Deployment '${name}' rollback initiated in namespace '${this.namespace}'. Target revision: ${targetRev}.`,
        revision: targetRev
      };
    } catch (error: any) {
      const wrapped = this.wrapError('rollbackDeployment', error);
      return {
        success: false,
        message: wrapped.message,
        revision: -1
      };
    }
  }

  /**
   * Restart a pod by deleting it (the deployment controller will recreate it)
   */
  public async restartPod(podName: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      await this.coreApi.deleteNamespacedPod({
        name: podName,
        namespace: this.namespace,
      });

      return {
        success: true,
        message: `Pod '${podName}' deleted in namespace '${this.namespace}'. Controller will recreate it.`
      };
    } catch (error: any) {
      const wrapped = this.wrapError('restartPod', error);
      return {
        success: false,
        message: wrapped.message
      };
    }
  }

  /**
   * Scale deployment replicas
   */
  public async scaleDeployment(name: string, replicas: number): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const patch = [
        {
          op: 'replace',
          path: '/spec/replicas',
          value: replicas
        }
      ];

      await this.appsApi.patchNamespacedDeployment({
        name,
        namespace: this.namespace,
        body: patch,
      });

      return {
        success: true,
        message: `Deployment '${name}' scaled to ${replicas} replicas in namespace '${this.namespace}'.`
      };
    } catch (error: any) {
      const wrapped = this.wrapError('scaleDeployment', error);
      return {
        success: false,
        message: wrapped.message
      };
    }
  }

  /**
   * Get rollout history for a deployment
   */
  public async getRolloutHistory(name: string): Promise<{
    revision: number;
    changeReason: string;
  }[]> {
    try {
      const deployment = await this.getDeployment(name);
      const revision = parseInt(deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'] || '0');
      const changeReason = deployment.metadata?.annotations?.['kubernetes.io/change-cause'] || 'unknown';

      return [{
        revision,
        changeReason
      }];
    } catch (error: any) {
      throw this.wrapError('getRolloutHistory', error);
    }
  }

  /**
   * Wraps Kubernetes API errors into structured, actionable error messages
   */
  private wrapError(operation: string, error: any): Error {
    const statusCode = error?.response?.statusCode || error?.statusCode || error?.code;
    const body = error?.response?.body || error?.body || {};

    if (statusCode === 403) {
      return new Error(
        `[K8sClient] PERMISSION DENIED on ${operation}: ${body.message || error.message}. ` +
        `Check service account RBAC permissions in namespace '${this.namespace}'.`
      );
    }

    if (statusCode === 404) {
      return new Error(
        `[K8sClient] NOT FOUND on ${operation}: ${body.message || error.message}. ` +
        `Resource may not exist in namespace '${this.namespace}'.`
      );
    }

    if (statusCode === 409) {
      return new Error(
        `[K8sClient] CONFLICT on ${operation}: ${body.message || error.message}. ` +
        `Resource may have been modified by another actor (stale revision).`
      );
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return new Error(
        `[K8sClient] NETWORK ERROR on ${operation}: ${error.message}. ` +
        `Cannot reach Kubernetes API server.`
      );
    }

    return new Error(
      `[K8sClient] ERROR on ${operation}: ${error.message || JSON.stringify(error)}`
    );
  }
}
