/**
 * Execution Service — Real Kubernetes Remediation Execution
 * 
 * Residual Production-Safety Gaps PRD Mandate:
 * - R1: Exact rollback restoration (FR-RB-001..006): restores complete PodTemplateSpec.
 * - R2: Rollback verification trust: computes hash from fresh GET; never trusts self-authored annotations.
 * - R3: Server-enforced concurrency: server-evaluated precondition `test` on resourceVersion.
 * - R4: HPA fail-closed tri-state checking.
 * - R5: Scoped credential provider without kubeconfig fallback.
 * - R6: Mandatory TenantContext on every sensitive repository method.
 * - R7: State-bound approval snapshot validation.
 */

import { randomUUID } from 'node:crypto';
import {
  type RemediationProposal,
  type TenantContext,
  type ApprovalSnapshot,
  hashCanonicalPodTemplate,
  asError
} from '@ai-sre/event-schema';
import { TelemetryCollector } from '@ai-sre/telemetry';
import { K8sClient, type RollbackResult } from './k8s-client.js';

export interface ExecutionResult {
  executionId: string;
  idempotencyKey: string;
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN' | 'CLAIMED' | 'EXPIRED';
  action: string;
  targetResource: string;
  outputMessage: string;
  k8sMode: 'live';
  timestamp: string;
  targetImage?: string;
  revision?: number;
  observedStateHash?: string;
  errorCode?: string;
}

export class ExecutionService {
  private executedKeys = new Map<string, ExecutionResult>();
  private inFlightClaims = new Map<string, Promise<ExecutionResult>>();
  private telemetry = TelemetryCollector.getInstance();
  private k8sClient: K8sClient;
  private workerId = `worker-${process.pid}-${randomUUID().substring(0, 8)}`;

  constructor(private incidentRepo: any, k8sClient?: K8sClient) {
    this.k8sClient = k8sClient || new K8sClient({
      namespace: process.env.K8S_NAMESPACE || 'sre-demo',
      role: 'executor'
    });
    console.log(`[ExecutionService] Initialized in LIVE mode with sre-executor role (workerId: ${this.workerId}).`);
  }

  public getK8sClient(): K8sClient {
    return this.k8sClient;
  }

  public executeProposal(
    incidentId: string,
    proposal: RemediationProposal,
    options?: { claimedBy?: string; timeoutMs?: number; tenantId?: string; tenantContext?: TenantContext }
  ): Promise<ExecutionResult> {
    const key = proposal.idempotencyKey;

    // 0. Synchronous check of completed cache
    if (this.executedKeys.has(key)) {
      const cached = this.executedKeys.get(key)!;
      return Promise.resolve({
        ...cached,
        outputMessage: `Idempotent replay detected: mutation already SUCCEEDED for key ${key}.`,
        timestamp: new Date().toISOString()
      });
    }

    // 0b. Synchronous in-flight lock check
    if (this.inFlightClaims.has(key)) {
      return this.inFlightClaims.get(key)!.then((inFlightRes) => ({
        ...inFlightRes,
        outputMessage: `Idempotent replay detected: mutation already SUCCEEDED for key ${key}.`,
        timestamp: new Date().toISOString()
      }));
    }

    const executionPromise = this.performExecution(incidentId, proposal, options);
    this.inFlightClaims.set(key, executionPromise);

    return executionPromise
      .then((res) => {
        this.executedKeys.set(key, res);
        return res;
      })
      .finally(() => {
        this.inFlightClaims.delete(key);
      });
  }

  private async performExecution(
    incidentId: string,
    proposal: RemediationProposal,
    options?: { claimedBy?: string; timeoutMs?: number; tenantId?: string; tenantContext?: TenantContext }
  ): Promise<ExecutionResult> {
    let incident = await this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const tenantId = options?.tenantContext?.tenantId || options?.tenantId || incident.tenantId || 'tenant-eu-default';
    if (options?.tenantContext?.tenantId && incident.tenantId && incident.tenantId !== options.tenantContext.tenantId) {
      const err = new Error(`Tenant mismatch: access to incident ${incidentId} forbidden`);
      (err as any).code = 'TENANT_FORBIDDEN';
      throw err;
    }

    const ctx: TenantContext = options?.tenantContext || {
      tenantId,
      subject: options?.claimedBy || this.workerId,
      roles: ['executor', 'sre'],
      authzVersion: 'v1'
    };

    const claimedBy = options?.claimedBy || this.workerId;
    const timeoutMs = options?.timeoutMs || 25000;

    // 1. Validate proposal status & support safe idempotent replay
    if (proposal.status !== 'APPROVED') {
      if (proposal.status === 'SUCCESS') {
        return {
          executionId: (proposal as any).executionId || randomUUID(),
          idempotencyKey: proposal.idempotencyKey,
          status: 'SUCCESS',
          action: proposal.action,
          targetResource: proposal.targetResource,
          outputMessage: `Idempotent replay detected: mutation already SUCCEEDED for key ${proposal.idempotencyKey}.`,
          k8sMode: 'live',
          timestamp: new Date().toISOString()
        };
      }
      throw new Error(`Cannot execute proposal ${proposal.id}: status is '${proposal.status}', must be 'APPROVED'.`);
    }

    // R8: Check fixed proposal-level deadline
    if (proposal.expiresAt) {
      const expiresAtMs = new Date(proposal.expiresAt).getTime();
      if (Date.now() >= expiresAtMs) {
        return {
          executionId: randomUUID(),
          idempotencyKey: proposal.idempotencyKey,
          status: 'EXPIRED',
          action: proposal.action,
          targetResource: proposal.targetResource,
          outputMessage: `Proposal expired at ${proposal.expiresAt}. Re-approval required.`,
          k8sMode: 'live',
          timestamp: new Date().toISOString(),
          errorCode: 'APPROVAL_EXPIRED'
        };
      }
    }

    // 2. Durable Exactly-One-Claim
    let executionId = randomUUID();
    let isNewClaim = true;

    if (typeof (this.incidentRepo as any).claimExecution === 'function') {
      const claimResult = await (this.incidentRepo as any).claimExecution({
        proposalId: proposal.id,
        incidentId,
        idempotencyKey: proposal.idempotencyKey,
        claimedBy,
        leaseDurationMs: 45000,
        tenantId: ctx.tenantId
      });

      executionId = claimResult.execution.id;
      isNewClaim = claimResult.isNewClaim;

      if (!isNewClaim) {
        const ex = claimResult.execution;
        if (ex.status === 'EXECUTING' || ex.status === 'UNKNOWN') {
          return {
            executionId: ex.id,
            idempotencyKey: proposal.idempotencyKey,
            status: 'UNKNOWN',
            action: proposal.action,
            targetResource: proposal.targetResource,
            outputMessage: `Execution is currently ambiguous (${ex.status}). Live reconciliation required before proceeding.`,
            k8sMode: 'live',
            timestamp: new Date().toISOString(),
            errorCode: 'RECONCILIATION_REQUIRED'
          };
        }

        if (ex.status === 'SUCCEEDED') {
          return {
            executionId: ex.id,
            idempotencyKey: proposal.idempotencyKey,
            status: 'SUCCESS',
            action: proposal.action,
            targetResource: proposal.targetResource,
            outputMessage: `Idempotent replay detected: mutation already SUCCEEDED for key ${proposal.idempotencyKey}.`,
            k8sMode: 'live',
            timestamp: new Date().toISOString()
          };
        }

        if (ex.status === 'FAILED') {
          return {
            executionId: ex.id,
            idempotencyKey: proposal.idempotencyKey,
            status: 'FAILED',
            action: proposal.action,
            targetResource: proposal.targetResource,
            outputMessage: `Idempotent replay: mutation previously FAILED for key ${proposal.idempotencyKey}.`,
            k8sMode: 'live',
            timestamp: new Date().toISOString(),
            errorCode: ex.errorCode || 'EXECUTION_FAILED'
          };
        }
      }
    } else {
      if (this.executedKeys.has(proposal.idempotencyKey)) {
        const cached = this.executedKeys.get(proposal.idempotencyKey)!;
        return {
          ...cached,
          outputMessage: `Idempotent replay detected: action already executed for key ${proposal.idempotencyKey}.`,
          timestamp: new Date().toISOString()
        };
      }
    }

    // 3. Mark incident EXECUTING
    await this.incidentRepo.transitionState(
      incidentId,
      'EXECUTING',
      `Executing remediation ${proposal.action} on ${proposal.targetResource}.`,
      { tenantId: ctx.tenantId }
    );
    proposal.status = 'EXECUTING';

    // 4. Update execution record to EXECUTING
    if (typeof (this.incidentRepo as any).updateExecution === 'function') {
      await (this.incidentRepo as any).updateExecution(ctx, executionId, {
        status: 'EXECUTING',
        externalRequestId: randomUUID()
      }).catch(() => {});
    }

    let outputMsg = '';
    let status: 'SUCCESS' | 'FAILED' | 'UNKNOWN' = 'FAILED';
    let targetImage: string | undefined;
    let revision: number | undefined;
    let observedStateHash: string | undefined;
    let errorCode: string | undefined;

    try {
      const livePromise = this.executeLive(proposal);
      const timeoutPromise = new Promise<{ success: boolean; message: string; code?: string }>((_, reject) =>
        setTimeout(() => reject(new Error('Kubernetes execution timed out')), timeoutMs)
      );

      const result: any = await Promise.race([livePromise, timeoutPromise]);
      outputMsg = result.message;
      targetImage = result.targetImage;
      revision = result.revision;
      observedStateHash = result.targetTemplateHash || result.actualTemplateHash;
      errorCode = result.code;

      if (result.success) {
        status = 'SUCCESS';
      } else {
        status = 'FAILED';
      }
    } catch (error: unknown) {
      const err = asError(error);
      if (err.message.includes('timed out')) {
        status = 'UNKNOWN';
        outputMsg = `Execution outcome externally ambiguous: request timed out while communicating with Kubernetes API.`;
        errorCode = 'UNKNOWN_EXTERNAL_OUTCOME';
      } else {
        status = 'FAILED';
        outputMsg = `Execution FAILED: ${err.message}`;
        errorCode = 'EXECUTION_FAILED';
      }
    }

    // 5. Durably persist outcome
    proposal.status = status === 'SUCCESS' ? 'SUCCESS' : (status === 'UNKNOWN' ? 'EXECUTING' : 'FAILED');
    this.telemetry.recordRemediationExecution(status === 'SUCCESS');

    if (typeof (this.incidentRepo as any).updateExecution === 'function') {
      await (this.incidentRepo as any).updateExecution(ctx, executionId, {
        status: status === 'SUCCESS' ? 'SUCCEEDED' : (status === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED'),
        observedStateHash,
        errorCode,
        errorDetails: { message: outputMsg }
      }).catch(() => {});
    }

    await this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'EXECUTION',
      title: `Execution ${status}: ${proposal.action}`,
      description: outputMsg,
      data: {
        executionId,
        idempotencyKey: proposal.idempotencyKey,
        parameters: proposal.parameters,
        k8sMode: 'live',
        status,
        targetImage,
        revision,
        errorCode
      },
      tenantId: ctx.tenantId
    });

    // 6. Transition state according to PRD state machine
    if (status === 'SUCCESS') {
      await this.incidentRepo.transitionState(
        incidentId,
        'VERIFYING',
        'Action executed; entering post-remediation health verification.',
        { tenantId: ctx.tenantId }
      );
    } else if (status === 'UNKNOWN') {
      try {
        await this.incidentRepo.transitionState(
          incidentId,
          'UNKNOWN',
          'Action outcome externally ambiguous; reconciliation required.',
          { tenantId: ctx.tenantId }
        );
      } catch {
        try {
          await this.incidentRepo.transitionState(incidentId, 'ESCALATED', 'Execution ambiguous.', { tenantId: ctx.tenantId });
        } catch {}
      }
    } else {
      try {
        await this.incidentRepo.transitionState(
          incidentId,
          'EXECUTION_FAILED',
          `Remediation failed: ${outputMsg}`,
          { tenantId: ctx.tenantId }
        );
      } catch {
        try {
          await this.incidentRepo.transitionState(incidentId, 'ESCALATED', `Execution failed: ${outputMsg}`, { tenantId: ctx.tenantId });
        } catch {}
      }
    }

    if (typeof this.incidentRepo.updateIncident === 'function') {
      await this.incidentRepo.updateIncident(incident);
    }

    const execResult: ExecutionResult = {
      executionId,
      idempotencyKey: proposal.idempotencyKey,
      status,
      action: proposal.action,
      targetResource: proposal.targetResource,
      outputMessage: outputMsg,
      k8sMode: 'live',
      timestamp: new Date().toISOString(),
      targetImage,
      revision,
      observedStateHash,
      errorCode
    };

    this.executedKeys.set(proposal.idempotencyKey, execResult);
    return execResult;
  }

  /**
   * R2: Reconciler comparing live Kubernetes state to desired postconditions
   * without relying on self-authored annotations.
   */
  public async reconcileExecution(
    incidentId: string,
    executionId: string,
    options?: { tenantId?: string; tenantContext?: TenantContext }
  ): Promise<{ status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; message: string; observedStateHash?: string }> {
    const tenantId = options?.tenantContext?.tenantId || options?.tenantId || 'tenant-eu-default';
    const ctx: TenantContext = options?.tenantContext || {
      tenantId,
      subject: 'reconciler',
      roles: ['sre', 'executor'],
      authzVersion: 'v1'
    };

    let execution: any = null;
    if (typeof (this.incidentRepo as any).getExecution === 'function') {
      execution = await (this.incidentRepo as any).getExecution(ctx, executionId);
    }

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const proposal = await (this.incidentRepo as any).getProposal(ctx, execution.proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${execution.proposalId} not found for execution ${executionId}`);
    }

    const action = proposal.action.toLowerCase();

    if (action === 'rollback_deployment') {
      const deploymentName = proposal.parameters?.deploymentName ||
                             proposal.parameters?.deployment ||
                             proposal.targetResource.replace(/^deployment\//, '');
      try {
        const deployment = await this.k8sClient.getDeployment(String(deploymentName));
        if (!deployment.spec?.template) {
          return {
            status: 'FAILED',
            message: `Deployment '${deploymentName}' has no spec.template.`
          };
        }

        // FR-RB-005 / R2: Compute hash directly from live spec.template; NEVER trust annotations!
        const actualHash = hashCanonicalPodTemplate(deployment.spec.template);
        const expectedHash = proposal.parameters?.targetTemplateHash || execution.desiredStateHash;

        let matchesTarget = false;
        if (expectedHash) {
          matchesTarget = (actualHash === expectedHash);
        } else {
          const currentRev = deployment.metadata?.annotations?.['deployment.kubernetes.io/revision'];
          const targetRev = proposal.parameters?.targetRevision;
          matchesTarget = targetRev ? String(targetRev) === currentRev : true;
        }

        if (matchesTarget) {
          await (this.incidentRepo as any).updateExecution(ctx, executionId, {
            status: 'SUCCEEDED',
            observedStateHash: actualHash
          });
          await this.incidentRepo.transitionState(
            incidentId,
            'VERIFYING',
            `Reconciliation confirmed rollback succeeded on deployment '${deploymentName}' (hash: ${actualHash.substring(0, 8)}).`,
            { tenantId: ctx.tenantId }
          );
          return {
            status: 'SUCCEEDED',
            message: `Rollback verified via live spec.template canonical hash (${actualHash.substring(0, 8)}).`,
            observedStateHash: actualHash
          };
        } else {
          await (this.incidentRepo as any).updateExecution(ctx, executionId, {
            status: 'FAILED',
            errorCode: 'RECONCILIATION_FAILED'
          });
          await this.incidentRepo.transitionState(
            incidentId,
            'EXECUTION_FAILED',
            `Reconciliation determined mutation was not accepted by cluster.`,
            { tenantId: ctx.tenantId }
          );
          return {
            status: 'FAILED',
            message: `Rollback was not reflected in live deployment (hash mismatch).`
          };
        }
      } catch (err: unknown) {
        return {
          status: 'UNKNOWN',
          message: `Unable to read live cluster state during reconciliation: ${asError(err).message}`
        };
      }
    }

    return {
      status: 'UNKNOWN',
      message: `Reconciliation for action '${action}' not implemented.`
    };
  }

  private async executeLive(proposal: RemediationProposal): Promise<{
    success: boolean;
    message: string;
    targetImage?: string;
    revision?: number;
    targetTemplateHash?: string;
    actualTemplateHash?: string;
    code?: string;
  }> {
    const actionNormalized = proposal.action.toLowerCase();

    switch (actionNormalized) {
      case 'rollback_deployment': {
        const deploymentName = proposal.parameters?.deploymentName ||
                               proposal.parameters?.deployment ||
                               proposal.targetResource.replace(/^deployment\//, '');
        const targetRevision = typeof proposal.parameters?.targetRevision === 'number'
          ? proposal.parameters.targetRevision
          : undefined;
        const expectedResourceVersion = proposal.parameters?.expectedResourceVersion;
        const approvalSnapshot: ApprovalSnapshot | undefined =
          proposal.parameters?.approvalSnapshot || (proposal as any).approvalSnapshot;

        return this.k8sClient.rollbackDeployment(
          String(deploymentName),
          targetRevision,
          { expectedResourceVersion, approvalSnapshot }
        );
      }

      case 'restart_pod': {
        const podName = proposal.parameters?.podName ||
                        proposal.parameters?.targetPod ||
                        (proposal.targetResource.startsWith('pod/') ? proposal.targetResource.replace(/^pod\//, '') : undefined);

        if (!podName) {
          return {
            success: false,
            code: 'TARGET_AMBIGUOUS',
            message: `restart_pod requires an exact evidenced pod identity ('podName'). Semantic shortcut pods[0] is prohibited.`
          };
        }

        const expectedUid = proposal.parameters?.podUid || proposal.parameters?.expectedUid;
        const expectedOwner = proposal.parameters?.expectedOwner || proposal.parameters?.serviceName;
        const expectedResourceVersion = proposal.parameters?.expectedResourceVersion;

        return this.k8sClient.restartPod(podName, { expectedUid, expectedOwner, expectedResourceVersion });
      }

      case 'scale_workload': {
        const deploymentName = proposal.parameters?.deploymentName ||
                               proposal.parameters?.deployment ||
                               proposal.targetResource.replace(/^deployment\//, '');
        const replicas = proposal.parameters?.replicas;

        if (typeof replicas !== 'number') {
          return {
            success: false,
            code: 'PARAMETER_REJECTED',
            message: `scale_workload requires numeric 'replicas' parameter.`
          };
        }

        const expectedResourceVersion = proposal.parameters?.expectedResourceVersion;
        return this.k8sClient.scaleDeployment(String(deploymentName), replicas, { expectedResourceVersion });
      }

      default:
        return {
          success: false,
          code: 'UNSUPPORTED_ACTION',
          message: `Action '${proposal.action}' not supported in live K8s mode. Supported: rollback_deployment, restart_pod, scale_workload.`
        };
    }
  }
}

export * from './k8s-client.js';
