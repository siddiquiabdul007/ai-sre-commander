/**
 * Execution Service — Real Kubernetes Remediation Execution
 * 
 * PRD v3.0 / Production Remediation PRD Mandate:
 * - Durable execution record (FR-P0-003): Dedicated Execution entity per attempt.
 * - Exactly-one-claim semantics (FR-P0-004): Unique idempotency claim with lease.
 * - UNKNOWN outcome semantics (FR-P0-005): EXECUTING never mapped to SUCCESS; live reconciliation.
 * - Execution failure closure (FR-P0-006): Terminal states EXECUTION_FAILED/ESCALATED; never stranded.
 * - Exact pod targeting (FR-P0-013): Validates target UID and ownership; never pods[0].
 * - Bounded scaling (FR-P0-014): Strict replica validation and HPA check.
 */

import { randomUUID, createHash } from 'node:crypto';
import type { RemediationProposal } from '@ai-sre/event-schema';
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

  constructor(private incidentRepo: any) {
    this.k8sClient = new K8sClient({
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
    options?: { claimedBy?: string; timeoutMs?: number; tenantId?: string }
  ): Promise<ExecutionResult> {
    const key = proposal.idempotencyKey;

    // 0. FR-P0-004: Synchronous check of completed cache
    if (this.executedKeys.has(key)) {
      const cached = this.executedKeys.get(key)!;
      return Promise.resolve({
        ...cached,
        outputMessage: `Idempotent replay detected: mutation already SUCCEEDED for key ${key}.`,
        timestamp: new Date().toISOString()
      });
    }

    // 0b. FR-P0-004: Synchronous in-flight lock check
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
    options?: { claimedBy?: string; timeoutMs?: number; tenantId?: string }
  ): Promise<ExecutionResult> {
    const incident = await this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const tenantId = options?.tenantId || incident.tenantId || 'tenant-eu-default';
    const claimedBy = options?.claimedBy || this.workerId;
    const timeoutMs = options?.timeoutMs || 25000;

    // 1. Validate proposal status & support safe idempotent replay (FR-P0-004)
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

    // 2. FR-P0-003 & FR-P0-004: Durable Exactly-One-Claim
    let executionId = randomUUID();
    let isNewClaim = true;


    if (typeof (this.incidentRepo as any).claimExecution === 'function') {
      const claimResult = await (this.incidentRepo as any).claimExecution({
        proposalId: proposal.id,
        incidentId,
        idempotencyKey: proposal.idempotencyKey,
        claimedBy,
        leaseDurationMs: 45000,
        tenantId
      });

      executionId = claimResult.execution.id;
      isNewClaim = claimResult.isNewClaim;

      if (!isNewClaim) {
        const ex = claimResult.execution;
        // FR-P0-005: If already EXECUTING or UNKNOWN, require reconciliation — DO NOT map to SUCCESS!
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
      // Local fallback idempotency cache
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
      { tenantId }
    );
    proposal.status = 'EXECUTING';

    // 4. Update execution record to EXECUTING
    if (typeof (this.incidentRepo as any).updateExecution === 'function') {
      await (this.incidentRepo as any).updateExecution(executionId, {
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
      // Execute live with timeout protection
      const livePromise = this.executeLive(proposal);
      const timeoutPromise = new Promise<{ success: boolean; message: string; code?: string }>((_, reject) =>
        setTimeout(() => reject(new Error('Kubernetes execution timed out')), timeoutMs)
      );

      const result: any = await Promise.race([livePromise, timeoutPromise]);
      outputMsg = result.message;
      targetImage = result.targetImage;
      revision = result.revision;
      observedStateHash = result.targetTemplateHash;
      errorCode = result.code;

      if (result.success) {
        status = 'SUCCESS';
      } else {
        status = 'FAILED';
      }
    } catch (error: any) {
      if (error.message?.includes('timed out')) {
        // FR-P0-005: Timeout is UNKNOWN, NEVER map to SUCCESS!
        status = 'UNKNOWN';
        outputMsg = `Execution outcome externally ambiguous: request timed out while communicating with Kubernetes API.`;
        errorCode = 'UNKNOWN_EXTERNAL_OUTCOME';
      } else {
        status = 'FAILED';
        outputMsg = `Execution FAILED: ${error.message}`;
        errorCode = 'EXECUTION_FAILED';
      }
    }

    // 5. Durably persist outcome
    proposal.status = status === 'SUCCESS' ? 'SUCCESS' : (status === 'UNKNOWN' ? 'EXECUTING' : 'FAILED');
    this.telemetry.recordRemediationExecution(status === 'SUCCESS');

    if (typeof (this.incidentRepo as any).updateExecution === 'function') {
      await (this.incidentRepo as any).updateExecution(executionId, {
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
      tenantId
    });

    // 6. FR-P0-006: Execution failure closure — NEVER leave incident in EXECUTING!
    if (status === 'SUCCESS') {
      await this.incidentRepo.transitionState(
        incidentId,
        'VERIFYING',
        'Action executed; entering post-remediation health verification.',
        { tenantId }
      );
    } else if (status === 'UNKNOWN') {
      try {
        await this.incidentRepo.transitionState(
          incidentId,
          'UNKNOWN',
          'Action outcome externally ambiguous; reconciliation required.',
          { tenantId }
        );
      } catch {
        try {
          await this.incidentRepo.transitionState(incidentId, 'ESCALATED', 'Execution ambiguous.', { tenantId });
        } catch {}
      }
    } else {
      // FAILED
      try {
        await this.incidentRepo.transitionState(
          incidentId,
          'EXECUTION_FAILED',
          `Remediation failed: ${outputMsg}`,
          { tenantId }
        );
      } catch {
        try {
          await this.incidentRepo.transitionState(incidentId, 'ESCALATED', `Execution failed: ${outputMsg}`, { tenantId });
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
   * FR-P0-005: Reconciler comparing live Kubernetes state to desired postconditions
   */
  public async reconcileExecution(
    incidentId: string,
    executionId: string,
    options?: { tenantId?: string }
  ): Promise<{ status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; message: string; observedStateHash?: string }> {
    const tenantId = options?.tenantId || 'tenant-eu-default';
    let execution: any = null;

    if (typeof (this.incidentRepo as any).getExecution === 'function') {
      execution = await (this.incidentRepo as any).getExecution(executionId);
    }

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const proposal = await (this.incidentRepo as any).getProposal(execution.proposalId);
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
        const annotations = deployment.metadata?.annotations || {};
        const recordedRevision = annotations['ai-sre-commander/target-revision'];
        const currentTemplateHash = annotations['ai-sre-commander/template-hash'];

        const targetRevision = proposal.parameters?.targetRevision;
        const matchesTarget = targetRevision ? String(targetRevision) === recordedRevision : Boolean(recordedRevision);

        if (matchesTarget) {
          await (this.incidentRepo as any).updateExecution(executionId, {
            status: 'SUCCEEDED',
            observedStateHash: currentTemplateHash
          });
          await this.incidentRepo.transitionState(
            incidentId,
            'VERIFYING',
            `Reconciliation confirmed rollback succeeded on deployment '${deploymentName}'.`,
            { tenantId }
          );
          return {
            status: 'SUCCEEDED',
            message: `Rollback verified via live deployment annotations.`,
            observedStateHash: currentTemplateHash
          };
        } else {
          await (this.incidentRepo as any).updateExecution(executionId, {
            status: 'FAILED',
            errorCode: 'RECONCILIATION_FAILED'
          });
          await this.incidentRepo.transitionState(
            incidentId,
            'EXECUTION_FAILED',
            `Reconciliation determined mutation was not accepted by cluster.`,
            { tenantId }
          );
          return {
            status: 'FAILED',
            message: `Rollback was not reflected in live deployment.`
          };
        }
      } catch (err: any) {
        return {
          status: 'UNKNOWN',
          message: `Unable to read live cluster state during reconciliation: ${err.message}`
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

        return this.k8sClient.rollbackDeployment(
          String(deploymentName),
          targetRevision,
          { expectedResourceVersion }
        );
      }

      case 'restart_pod': {
        // FR-P0-013: Exact pod targeting. Never choose pods[0]!
        const podName = proposal.parameters?.podName ||
                        proposal.parameters?.targetPod ||
                        (proposal.targetResource.startsWith('pod/') ? proposal.targetResource.replace(/^pod\//, '') : undefined);

        if (!podName) {
          // If only serviceName given, must NOT blindly pick pods[0]
          return {
            success: false,
            code: 'TARGET_AMBIGUOUS',
            message: `restart_pod requires an exact evidenced pod identity ('podName'). Semantic shortcut pods[0] is prohibited.`
          };
        }

        const expectedUid = proposal.parameters?.podUid || proposal.parameters?.expectedUid;
        const expectedOwner = proposal.parameters?.expectedOwner || proposal.parameters?.serviceName;

        return this.k8sClient.restartPod(podName, { expectedUid, expectedOwner });
      }

      case 'scale_workload': {
        // FR-P0-014: Bounded scaling
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
