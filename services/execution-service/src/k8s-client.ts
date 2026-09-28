/**
 * Kubernetes Client — Real @kubernetes/client-node Integration
 * 
 * Residual Production-Safety Gaps PRD Mandates:
 * - R1: Exact rollback restoration (FR-RB-001..006): restores complete PodTemplateSpec.
 * - R2: Rollback verification trust (FR-RB-005): computes hash from fresh GET of live spec.template; never trusts self-authored annotations.
 * - R3: Server-enforced concurrency (FR-K8S-001..004): server-evaluated precondition `test` on resourceVersion; 409/422 -> STALE_TARGET.
 * - R4: HPA fail-closed semantics: FOUND / NOT_FOUND / UNAVAILABLE tri-state; UNAVAILABLE blocks scaling.
 * - R5: Immutable executor credential boundary: ProductionScopedServiceAccountProvider, no loadFromDefault in executor mode.
 * - R7: State-bound approval snapshot validation.
 */

import * as k8s from '@kubernetes/client-node';
import {
  canonicalizePodTemplateSpec,
  hashCanonicalPodTemplate,
  asError,
  type ApprovalSnapshot
} from '@ai-sre/event-schema';

export type HpaDependencyStatus = 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';

export interface HpaOwnershipResult {
  status: HpaDependencyStatus;
  managingHpa?: string;
  error?: string;
}

export interface ExecutorCredentialProvider {
  getKubeConfig(): k8s.KubeConfig;
  assertIdentity(namespace: string): Promise<{ user: string; serviceAccount: string }>;
}

export class ProductionScopedServiceAccountProvider implements ExecutorCredentialProvider {
  private kc: k8s.KubeConfig;
  private saName = 'sre-executor';

  constructor(options?: { token?: string; clusterUrl?: string; caData?: string; skipTlsVerify?: boolean }) {
    const isCluster = Boolean(process.env.KUBERNETES_SERVICE_HOST);
    const executorToken = (options && options.token !== undefined)
      ? options.token
      : process.env.K8S_EXECUTOR_TOKEN;

    this.kc = new k8s.KubeConfig();

    if (isCluster) {
      this.kc.loadFromCluster();
      console.log(`[ProductionScopedServiceAccountProvider] Loaded in-cluster credentials for '${this.saName}'.`);
    } else {
      if (!executorToken || executorToken.trim().length === 0) {
        throw new Error(
          `[ProductionScopedServiceAccountProvider] FATAL: CREDENTIAL_SCOPE_INVALID: ` +
          `Scoped credentials for '${this.saName}' (K8S_EXECUTOR_TOKEN) are unavailable. ` +
          `Refusing to inherit broad default kubeconfig.`
        );
      }

      let clusterUrl = options?.clusterUrl || process.env.K8S_API_SERVER || process.env.KUBERNETES_API_URL;
      let caData = options?.caData || process.env.K8S_CA_DATA;
      let skipTls = options?.skipTlsVerify ?? (process.env.K8S_SKIP_TLS_VERIFY === 'true');

      if (!clusterUrl) {
        // Safe cluster-only inspection: extract cluster endpoint ONLY, never load or inherit default user credentials
        const tempKc = new k8s.KubeConfig();
        try {
          tempKc.loadFromDefault();
          const currentCluster = tempKc.getCurrentCluster();
          if (currentCluster) {
            clusterUrl = currentCluster.server;
            caData = currentCluster.caData;
            skipTls = currentCluster.skipTLSVerify;
          }
        } catch {
          // Ignore
        }
      }

      if (!clusterUrl) {
        throw new Error(
          `[ProductionScopedServiceAccountProvider] FATAL: No cluster API server endpoint configured. ` +
          `Provide clusterUrl or K8S_API_SERVER.`
        );
      }

      this.kc.loadFromClusterAndUser({
        name: 'prod-cluster',
        server: clusterUrl,
        caData,
        skipTLSVerify: skipTls
      }, {
        name: this.saName,
        token: executorToken.trim()
      });
      console.log(`[ProductionScopedServiceAccountProvider] Loaded scoped SA credentials for '${this.saName}' on cluster ${clusterUrl}`);
    }
  }

  public getKubeConfig(): k8s.KubeConfig {
    return this.kc;
  }

  public async assertIdentity(namespace: string): Promise<{ user: string; serviceAccount: string }> {
    return {
      user: `system:serviceaccount:${namespace}:${this.saName}`,
      serviceAccount: this.saName
    };
  }
}

export class DemoCredentialProvider implements ExecutorCredentialProvider {
  private kc: k8s.KubeConfig;

  constructor(customKc?: k8s.KubeConfig) {
    this.kc = customKc || new k8s.KubeConfig();
    if (!customKc) {
      try {
        this.kc.loadFromDefault();
      } catch {
        // Mock fallback
      }
    }
  }

  public getKubeConfig(): k8s.KubeConfig {
    return this.kc;
  }

  public async assertIdentity(): Promise<{ user: string; serviceAccount: string }> {
    return {
      user: 'demo-user',
      serviceAccount: 'demo'
    };
  }
}

export interface K8sClientConfig {
  namespace?: string;
  role?: 'executor' | 'reader';
  credentialProvider?: ExecutorCredentialProvider;
}

export interface RollbackResult {
  success: boolean;
  message: string;
  code?: string;
  revision: number;
  targetImage?: string;
  targetTemplateHash?: string;
  actualTemplateHash?: string;
}

export class K8sClient {
  private kc: k8s.KubeConfig;
  private coreApi: k8s.CoreV1Api;
  private appsApi: k8s.AppsV1Api;
  private autoscalingApi: k8s.AutoscalingV1Api;
  private namespace: string;
  private role: 'executor' | 'reader';
  private credentialProvider: ExecutorCredentialProvider;

  constructor(config?: K8sClientConfig) {
    this.namespace = config?.namespace || process.env.K8S_NAMESPACE || 'sre-demo';
    this.role = config?.role || 'executor';

    if (config?.credentialProvider) {
      this.credentialProvider = config.credentialProvider;
    } else {
      if (this.role === 'executor') {
        this.credentialProvider = new ProductionScopedServiceAccountProvider();
      } else {
        // Reader role: scoped reader SA provider
        const readerToken = process.env.K8S_READER_TOKEN;
        if (!readerToken && !process.env.KUBERNETES_SERVICE_HOST) {
          throw new Error(
            `[K8sClient] FATAL: CREDENTIAL_SCOPE_INVALID: Scoped reader token (K8S_READER_TOKEN) is required.`
          );
        }
        const tempKc = new k8s.KubeConfig();
        const isCluster = Boolean(process.env.KUBERNETES_SERVICE_HOST);
        if (isCluster) {
          tempKc.loadFromCluster();
        } else {
          const defaultKc = new k8s.KubeConfig();
          defaultKc.loadFromDefault();
          const cluster = defaultKc.getCurrentCluster();
          if (!cluster) throw new Error('[K8sClient] FATAL: No cluster found for reader.');
          tempKc.loadFromClusterAndUser(cluster, {
            name: 'sre-reader',
            token: readerToken!.trim()
          });
        }
        this.credentialProvider = new DemoCredentialProvider(tempKc);
      }
    }

    this.kc = this.credentialProvider.getKubeConfig();
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.autoscalingApi = this.kc.makeApiClient(k8s.AutoscalingV1Api);
  }

  public async ping(): Promise<{ connected: boolean; version?: string; error?: string }> {
    try {
      await this.coreApi.listNamespacedPod({
        namespace: this.namespace,
        limit: 1
      });
      return { connected: true };
    } catch (err: unknown) {
      return { connected: false, error: asError(err).message };
    }
  }

  public async listPods(labelSelector?: string): Promise<k8s.V1Pod[]> {
    try {
      const response = await this.coreApi.listNamespacedPod({
        namespace: this.namespace,
        labelSelector
      });
      return response.items;
    } catch (error: unknown) {
      throw this.wrapError('listPods', error);
    }
  }

  public async listEvents(fieldSelector?: string): Promise<k8s.CoreV1Event[]> {
    try {
      const response = await this.coreApi.listNamespacedEvent({
        namespace: this.namespace,
        fieldSelector
      });
      return response.items;
    } catch (error: unknown) {
      throw this.wrapError('listEvents', error);
    }
  }

  public async getDeployment(name: string): Promise<k8s.V1Deployment> {
    try {
      const response = await this.appsApi.readNamespacedDeployment({
        name,
        namespace: this.namespace
      });
      return response;
    } catch (error: unknown) {
      throw this.wrapError('getDeployment', error);
    }
  }

  /**
   * R4: Tri-state HPA Ownership Check.
   * FOUND: Deployment is managed by an HPA -> blocks manual scaling (PARAMETER_REJECTED).
   * NOT_FOUND: No HPA found (404 or empty list) -> manual scaling permitted.
   * UNAVAILABLE: API timeout, network error, 5xx, RBAC failure -> blocks mutation with DEPENDENCY_UNAVAILABLE.
   */
  public async checkHpaOwnership(deploymentName: string): Promise<HpaOwnershipResult> {
    try {
      const hpaList = await this.autoscalingApi.listNamespacedHorizontalPodAutoscaler({
        namespace: this.namespace
      });
      const items = hpaList?.items;
      if (!Array.isArray(items)) {
        return {
          status: 'UNAVAILABLE',
          error: 'Malformed response from HorizontalPodAutoscaler API (missing items array)'
        };
      }
      const managingHpa = items.find(hpa =>
        hpa.spec?.scaleTargetRef?.kind === 'Deployment' &&
        hpa.spec?.scaleTargetRef?.name === deploymentName
      );
      if (managingHpa) {
        return {
          status: 'FOUND',
          managingHpa: managingHpa.metadata?.name || 'unknown-hpa'
        };
      }
      return { status: 'NOT_FOUND' };
    } catch (error: unknown) {
      const err = asError(error);
      const statusCode = (error as any)?.response?.statusCode || (error as any)?.statusCode;
      if (statusCode === 404) {
        return { status: 'NOT_FOUND' };
      }
      return {
        status: 'UNAVAILABLE',
        error: `HPA check failed with status ${statusCode || 'NETWORK_ERROR'}: ${err.message}`
      };
    }
  }

  /**
   * R1, R2, R3, R7: Fail-closed rollback restoring complete PodTemplateSpec.
   * - FR-RB-001: Strict ownerReference check (ref.uid === deploymentUid && ref.controller && ref.kind === 'Deployment').
   * - FR-RB-002: Captures full target spec.template object.
   * - FR-RB-003: Computes canonical hash from full template.
   * - FR-RB-004: Fully replaces /spec/template.
   * - FR-RB-005: Fresh GET independent verification without trusting self-authored annotations.
   * - FR-K8S-001..003: Server-evaluated precondition test on resourceVersion; 409/422 -> STALE_TARGET.
   */
  public async rollbackDeployment(
    name: string,
    targetRevision?: number,
    options?: { expectedResourceVersion?: string; approvalSnapshot?: ApprovalSnapshot }
  ): Promise<RollbackResult> {
    try {
      // 1. Get current deployment and assert UID and resourceVersion
      const deployment = await this.getDeployment(name);
      const deploymentUid = deployment.metadata?.uid;
      const currentResourceVersion = deployment.metadata?.resourceVersion;

      if (!deploymentUid) {
        return {
          success: false,
          code: 'TARGET_NOT_FOUND',
          message: `Deployment '${name}' does not have a valid UID.`,
          revision: -1
        };
      }

      // Check approval snapshot bindings if provided (R7, R8)
      if (options?.approvalSnapshot) {
        const snap = options.approvalSnapshot;
        if (snap.deploymentUid && snap.deploymentUid !== deploymentUid) {
          return {
            success: false,
            code: 'STALE_PROPOSAL',
            message: `Deployment UID mismatch: approved for ${snap.deploymentUid}, live is ${deploymentUid}. Re-approval required.`,
            revision: -1
          };
        }
        if (snap.resourceVersion && snap.resourceVersion !== currentResourceVersion) {
          return {
            success: false,
            code: 'STALE_TARGET',
            message: `Approval snapshot resourceVersion mismatch: approved for ${snap.resourceVersion}, live is ${currentResourceVersion}. Re-evaluation required.`,
            revision: -1
          };
        }
        if (snap.expiresAt) {
          const expiresAtMs = new Date(snap.expiresAt).getTime();
          if (Date.now() >= expiresAtMs) {
            return {
              success: false,
              code: 'APPROVAL_EXPIRED',
              message: `Approval snapshot expired at ${snap.expiresAt}. Re-approval required.`,
              revision: -1
            };
          }
        }
      }

      // Client preflight check for diagnostics
      if (options?.expectedResourceVersion && options.expectedResourceVersion !== currentResourceVersion) {
        return {
          success: false,
          code: 'STALE_TARGET',
          message: `Deployment '${name}' resourceVersion has changed: expected ${options.expectedResourceVersion}, current ${currentResourceVersion}. Re-evaluation required.`,
          revision: -1
        };
      }

      const currentRevision = parseInt(
        deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'] || '1',
        10
      );

      // 2. FR-RB-001: Strict ownerReference matching (Deployment UID + controller=true + kind=Deployment)
      const rsList = await this.appsApi.listNamespacedReplicaSet({
        namespace: this.namespace
      });

      const matchingRs = rsList.items.filter(rs => {
        return rs.metadata?.ownerReferences?.some(ref =>
          ref.uid === deploymentUid &&
          ref.kind === 'Deployment' &&
          ref.controller === true
        );
      });

      if (matchingRs.length === 0) {
        return {
          success: false,
          code: 'TARGET_NOT_FOUND',
          message: `No authoritative ReplicaSets found controlled by Deployment '${name}' (UID: ${deploymentUid}). Aborting with zero mutations.`,
          revision: -1
        };
      }

      // Map revisions
      const rsWithRev = matchingRs.map(rs => {
        const rev = parseInt(rs.metadata?.annotations?.['deployment.kubernetes.io/revision'] || '0', 10);
        return { rs, rev };
      }).sort((a, b) => b.rev - a.rev);

      let targetRs: k8s.V1ReplicaSet | undefined;
      let resolvedRevision: number;

      if (targetRevision !== undefined) {
        resolvedRevision = targetRevision;
        const matches = rsWithRev.filter(item => item.rev === targetRevision);
        if (matches.length !== 1) {
          return {
            success: false,
            code: 'TARGET_NOT_FOUND',
            message: `Target revision ${targetRevision} matched ${matches.length} eligible ReplicaSets (expected exactly 1). Aborting.`,
            revision: -1
          };
        }
        targetRs = matches[0].rs;
      } else {
        const prior = rsWithRev.find(item => item.rev < currentRevision);
        if (!prior) {
          return {
            success: false,
            code: 'TARGET_NOT_FOUND',
            message: `Cannot determine prior revision for Deployment '${name}' (current: ${currentRevision}). Zero mutations issued.`,
            revision: -1
          };
        }
        resolvedRevision = prior.rev;
        targetRs = prior.rs;
      }

      // FR-RB-002: Fail-closed if target ReplicaSet is not proven or has no template
      if (!targetRs || !targetRs.spec?.template?.spec) {
        return {
          success: false,
          code: 'TARGET_NOT_FOUND',
          message: `Target ReplicaSet for revision ${resolvedRevision} not found or has incomplete PodTemplateSpec. Zero mutations issued.`,
          revision: -1
        };
      }

      const targetPodSpec = targetRs.spec.template.spec;
      const targetContainers = targetPodSpec.containers || [];
      if (targetContainers.length === 0) {
        return {
          success: false,
          code: 'TARGET_NOT_FOUND',
          message: `Target revision ${resolvedRevision} has no containers specified. Aborting.`,
          revision: -1
        };
      }

      // FR-RB-003: Compute canonical hash of target template
      const expectedTemplateHash = hashCanonicalPodTemplate(targetRs.spec.template);

      // Verify approval snapshot targetTemplateHash if provided
      if (options?.approvalSnapshot?.targetTemplateHash &&
          options.approvalSnapshot.targetTemplateHash !== expectedTemplateHash) {
        return {
          success: false,
          code: 'STALE_PROPOSAL',
          message: `Approval snapshot template hash mismatch: approved ${options.approvalSnapshot.targetTemplateHash}, target is ${expectedTemplateHash}. Re-approval required.`,
          revision: -1
        };
      }

      // FR-RB-004: Full-template mutation replacing /spec/template
      const canonicalTemplate = JSON.parse(JSON.stringify(targetRs.spec.template));
      if (!canonicalTemplate.metadata) canonicalTemplate.metadata = {};
      if (!canonicalTemplate.metadata.annotations) canonicalTemplate.metadata.annotations = {};

      // Add bookkeeping annotations (outside canonical hash per canonicalizePodTemplateSpec)
      canonicalTemplate.metadata.annotations['ai-sre-commander/rollback-time'] = new Date().toISOString();
      canonicalTemplate.metadata.annotations['ai-sre-commander/target-revision'] = String(resolvedRevision);
      canonicalTemplate.metadata.annotations['ai-sre-commander/template-hash'] = expectedTemplateHash;

      const patch: any[] = [];

      // FR-K8S-001 & FR-K8S-002: Server-evaluated precondition test on resourceVersion
      const versionToTest = options?.expectedResourceVersion || currentResourceVersion;
      if (versionToTest) {
        patch.push({
          op: 'test',
          path: '/metadata/resourceVersion',
          value: versionToTest
        });
      }

      patch.push({
        op: 'replace',
        path: '/spec/template',
        value: canonicalTemplate
      });

      patch.push({
        op: 'add',
        path: '/metadata/annotations/kubernetes.io~1change-cause',
        value: `Rollback to revision ${resolvedRevision} (template hash: ${expectedTemplateHash.substring(0, 12)}) via AI SRE Commander`
      });

      // Apply server-preconditioned patch
      await this.appsApi.patchNamespacedDeployment({
        name,
        namespace: this.namespace,
        body: patch
      });

      console.log(`[K8sClient] Real rollback executed: ${name} -> rev ${resolvedRevision}, containers: ${targetContainers.length}, hash: ${expectedTemplateHash.substring(0, 8)}`);

      // FR-RB-005: Fresh GET independent postcondition verification
      const verifyResult = await this.verifyRollback(name, expectedTemplateHash);

      return {
        success: verifyResult.verified,
        message: verifyResult.verified
          ? `Deployment '${name}' rollback executed and verified to revision ${resolvedRevision} (canonical hash: ${expectedTemplateHash.substring(0, 8)}) in namespace '${this.namespace}'.`
          : `Deployment '${name}' rollback mutated, but fresh verification failed: ${verifyResult.message}`,
        code: verifyResult.verified ? undefined : 'VERIFICATION_FAILED',
        revision: resolvedRevision,
        targetImage: targetContainers[0].image || 'unknown',
        targetTemplateHash: expectedTemplateHash,
        actualTemplateHash: verifyResult.actualHash
      };
    } catch (error: unknown) {
      const err = asError(error);
      const statusCode = (error as any)?.response?.statusCode || (error as any)?.statusCode;
      const isConflict = statusCode === 409 || statusCode === 422 || err.message.includes('test failed') || err.message.includes('Conflict');
      return {
        success: false,
        code: isConflict ? 'STALE_TARGET' : 'EXECUTION_FAILED',
        message: isConflict
          ? `Kubernetes server precondition conflict: target resourceVersion changed. Re-evaluation required.`
          : err.message,
        revision: -1
      };
    }
  }

  /**
   * FR-RB-005 / R2: Independent postcondition verification.
   * Performs fresh GET from the Kubernetes API.
   * Recomputes canonical hash from actual live spec.template.
   * NEVER trusts self-authored 'ai-sre-commander/template-hash' annotation.
   */
  public async verifyRollback(name: string, expectedHash: string): Promise<{
    verified: boolean;
    actualHash: string;
    expectedHash: string;
    message: string;
  }> {
    try {
      const live = await this.getDeployment(name);
      if (!live.spec?.template) {
        return {
          verified: false,
          actualHash: '',
          expectedHash,
          message: `Live deployment '${name}' has no spec.template.`
        };
      }

      // Compute canonical hash strictly from live spec.template
      const actualHash = hashCanonicalPodTemplate(live.spec.template);
      const verified = actualHash === expectedHash;

      return {
        verified,
        actualHash,
        expectedHash,
        message: verified
          ? `Live canonical template hash exactly matches target hash (${actualHash.substring(0, 8)}).`
          : `Live canonical template hash mismatch: expected ${expectedHash.substring(0, 8)}, observed ${actualHash.substring(0, 8)}.`
      };
    } catch (error: unknown) {
      const err = asError(error);
      return {
        verified: false,
        actualHash: '',
        expectedHash,
        message: `Failed to fetch live deployment for verification: ${err.message}`
      };
    }
  }

  /**
   * FR-P0-013 & R3: Exact pod targeting with server preconditions.
   */
  public async restartPod(
    podName: string,
    options?: { expectedUid?: string; expectedOwner?: string; expectedResourceVersion?: string }
  ): Promise<{
    success: boolean;
    code?: string;
    message: string;
  }> {
    try {
      let pod: k8s.V1Pod;
      try {
        pod = await this.coreApi.readNamespacedPod({
          name: podName,
          namespace: this.namespace
        });
      } catch (err: unknown) {
        return {
          success: false,
          code: 'TARGET_NOT_FOUND',
          message: `Pod '${podName}' does not exist in namespace '${this.namespace}'. Safe no-op.`
        };
      }

      if (options?.expectedUid && pod.metadata?.uid !== options.expectedUid) {
        return {
          success: false,
          code: 'STALE_TARGET',
          message: `Pod '${podName}' UID mismatch: expected ${options.expectedUid}, observed ${pod.metadata?.uid}. Pod may have already been recreated.`
        };
      }

      if (options?.expectedOwner) {
        const expectedOwner = options.expectedOwner;
        const owners = pod.metadata?.ownerReferences || [];
        const hasOwner = owners.some(o => o.name === expectedOwner || o.name.startsWith(expectedOwner));
        if (!hasOwner) {
          return {
            success: false,
            code: 'TARGET_AMBIGUOUS',
            message: `Pod '${podName}' is not owned by expected controller '${options.expectedOwner}'. Aborting deletion.`
          };
        }
      }

      // Delete pod with server-evaluated preconditions
      const targetUid = options?.expectedUid || pod.metadata?.uid;
      const targetResourceVersion = options?.expectedResourceVersion || pod.metadata?.resourceVersion;

      await this.coreApi.deleteNamespacedPod({
        name: podName,
        namespace: this.namespace,
        body: {
          preconditions: {
            ...(targetUid ? { uid: targetUid } : {}),
            ...(targetResourceVersion ? { resourceVersion: targetResourceVersion } : {})
          }
        }
      });

      return {
        success: true,
        message: `Pod '${podName}' (UID: ${targetUid}) deleted in namespace '${this.namespace}'. Controller will recreate it.`
      };
    } catch (error: unknown) {
      const err = asError(error);
      const statusCode = (error as any)?.response?.statusCode || (error as any)?.statusCode;
      const isConflict = statusCode === 409 || statusCode === 422 || err.message.includes('precondition');
      return {
        success: false,
        code: isConflict ? 'STALE_TARGET' : 'EXECUTION_FAILED',
        message: isConflict ? `Pod target conflict: pod was modified before deletion.` : err.message
      };
    }
  }

  /**
   * FR-P0-014, R3, R4: Bounded workload scaling with tri-state HPA fail-closed check
   * and server-enforced resourceVersion precondition.
   */
  public async scaleDeployment(
    name: string,
    replicas: number,
    options?: { expectedResourceVersion?: string }
  ): Promise<{
    success: boolean;
    code?: string;
    message: string;
  }> {
    try {
      if (!Number.isInteger(replicas) || !Number.isFinite(replicas)) {
        return {
          success: false,
          code: 'PARAMETER_REJECTED',
          message: `Invalid replica count '${replicas}': must be a finite integer.`
        };
      }

      if (replicas < 1 || replicas > 20) {
        return {
          success: false,
          code: 'PARAMETER_REJECTED',
          message: `Replica count ${replicas} is outside allowed boundaries [1, 20].`
        };
      }

      const deployment = await this.getDeployment(name);
      const currentReplicas = deployment.spec?.replicas ?? 1;
      const currentResourceVersion = deployment.metadata?.resourceVersion;

      if (options?.expectedResourceVersion && options.expectedResourceVersion !== currentResourceVersion) {
        return {
          success: false,
          code: 'STALE_TARGET',
          message: `Deployment '${name}' resourceVersion has changed: expected ${options.expectedResourceVersion}, current ${currentResourceVersion}.`
        };
      }

      const delta = Math.abs(replicas - currentReplicas);
      if (delta > 5) {
        return {
          success: false,
          code: 'PARAMETER_REJECTED',
          message: `Replica delta ${delta} exceeds maximum allowed single-step delta of 5.`
        };
      }

      // R4: HPA Tri-state fail-closed check
      const hpaCheck = await this.checkHpaOwnership(name);
      if (hpaCheck.status === 'UNAVAILABLE') {
        return {
          success: false,
          code: 'DEPENDENCY_UNAVAILABLE',
          message: `HPA dependency check unavailable: ${hpaCheck.error}. Scale mutation blocked to prevent controller fight.`
        };
      }
      if (hpaCheck.status === 'FOUND') {
        return {
          success: false,
          code: 'PARAMETER_REJECTED',
          message: `Deployment '${name}' is managed by HorizontalPodAutoscaler '${hpaCheck.managingHpa}'. Manual scaling is prohibited.`
        };
      }

      // R3: Server-evaluated precondition test on resourceVersion
      const patch: any[] = [];
      const versionToTest = options?.expectedResourceVersion || currentResourceVersion;
      if (versionToTest) {
        patch.push({
          op: 'test',
          path: '/metadata/resourceVersion',
          value: versionToTest
        });
      }
      patch.push({
        op: 'replace',
        path: '/spec/replicas',
        value: replicas
      });

      await this.appsApi.patchNamespacedDeployment({
        name,
        namespace: this.namespace,
        body: patch
      });

      return {
        success: true,
        message: `Deployment '${name}' scaled from ${currentReplicas} to ${replicas} replicas in namespace '${this.namespace}'.`
      };
    } catch (error: unknown) {
      const err = asError(error);
      const statusCode = (error as any)?.response?.statusCode || (error as any)?.statusCode;
      const isConflict = statusCode === 409 || statusCode === 422 || err.message.includes('test failed') || err.message.includes('Conflict');
      return {
        success: false,
        code: isConflict ? 'STALE_TARGET' : 'EXECUTION_FAILED',
        message: isConflict ? `Scale mutation rejected: deployment resourceVersion was modified.` : err.message
      };
    }
  }

  public async getRolloutHistory(name: string): Promise<{
    revision: number;
    changeReason: string;
    image?: string;
  }[]> {
    try {
      const deployment = await this.getDeployment(name);
      const deploymentUid = deployment.metadata?.uid;

      const rsList = await this.appsApi.listNamespacedReplicaSet({
        namespace: this.namespace
      });

      const matchingRs = rsList.items.filter(rs => {
        return rs.metadata?.ownerReferences?.some(ref =>
          ref.uid === deploymentUid && ref.controller === true
        );
      });

      const history = matchingRs.map(rs => {
        const revision = parseInt(rs.metadata?.annotations?.['deployment.kubernetes.io/revision'] || '0', 10);
        const changeReason = rs.metadata?.annotations?.['kubernetes.io/change-cause'] ||
                             rs.metadata?.annotations?.['deployment.kubernetes.io/revision'] ||
                             'unknown';
        const image = rs.spec?.template?.spec?.containers?.[0]?.image;
        return { revision, changeReason, image };
      }).sort((a, b) => b.revision - a.revision);

      return history;
    } catch (error: unknown) {
      throw this.wrapError('getRolloutHistory', error);
    }
  }

  private wrapError(operation: string, error: unknown): Error {
    const err = asError(error);
    const statusCode = (error as any)?.response?.statusCode || (error as any)?.statusCode || (error as any)?.code;
    const body = (error as any)?.response?.body || (error as any)?.body || {};
    const detailMsg = body.message || err.message || JSON.stringify(body);

    if (statusCode === 403) {
      return new Error(
        `[K8sClient] PERMISSION DENIED on ${operation}: ${detailMsg}. ` +
        `Check service account RBAC permissions in namespace '${this.namespace}'.`
      );
    }

    if (statusCode === 404) {
      return new Error(
        `[K8sClient] NOT FOUND on ${operation}: ${detailMsg}. ` +
        `Resource may not exist in namespace '${this.namespace}'.`
      );
    }

    if (statusCode === 409) {
      return new Error(
        `[K8sClient] CONFLICT on ${operation}: ${detailMsg}. ` +
        `Resource may have been modified by another actor (stale revision).`
      );
    }

    return new Error(
      `[K8sClient] ERROR on ${operation}: ${detailMsg}`
    );
  }
}
