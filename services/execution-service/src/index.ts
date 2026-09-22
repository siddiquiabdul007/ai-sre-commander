/**
 * Execution Service — Real Kubernetes Remediation Execution
 * 
 * PRD v3.0 Mandate:
 * - Strictly live: No mock or offline simulation paths.
 * - Idempotency enforcement: prevents double execution of same proposal.
 * - Real K8s client with scoped 'sre-executor' credentials.
 * - Async-safe repository integration.
 */

import { randomUUID } from 'node:crypto';
import type { RemediationProposal } from '@ai-sre/event-schema';
import { TelemetryCollector } from '@ai-sre/telemetry';
import { K8sClient } from './k8s-client.js';

export interface ExecutionResult {
  executionId: string;
  idempotencyKey: string;
  status: 'SUCCESS' | 'FAILED';
  action: string;
  targetResource: string;
  outputMessage: string;
  k8sMode: 'live';
  timestamp: string;
  targetImage?: string;
  revision?: number;
}

export class ExecutionService {
  private executedKeys = new Map<string, ExecutionResult>();
  private telemetry = TelemetryCollector.getInstance();
  private k8sClient: K8sClient;

  constructor(private incidentRepo: any) {
    this.k8sClient = new K8sClient({
      namespace: process.env.K8S_NAMESPACE || 'sre-demo',
      role: 'executor'
    });
    console.log('[ExecutionService] Initialized in LIVE mode with sre-executor role.');
  }

  public getK8sClient(): K8sClient {
    return this.k8sClient;
  }

  public async executeProposal(incidentId: string, proposal: RemediationProposal): Promise<ExecutionResult> {
    const incident = await this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    // 1. Enforce Idempotency Key (PRD §18) - check in-memory cache and PostgreSQL
    if (this.executedKeys.has(proposal.idempotencyKey)) {
      const cached = this.executedKeys.get(proposal.idempotencyKey)!;
      return {
        ...cached,
        outputMessage: `Idempotent replay detected: action already executed for key ${proposal.idempotencyKey}.`,
        timestamp: new Date().toISOString()
      };
    }

    if (typeof (this.incidentRepo as any).getProposalByIdempotencyKey === 'function') {
      const dbRecord = await (this.incidentRepo as any).getProposalByIdempotencyKey(proposal.idempotencyKey);
      if (dbRecord && (dbRecord.status === 'SUCCESS' || dbRecord.status === 'EXECUTING')) {
        return {
          executionId: `exec_db_${proposal.idempotencyKey.substring(0, 8)}`,
          idempotencyKey: proposal.idempotencyKey,
          status: 'SUCCESS',
          action: proposal.action,
          targetResource: proposal.targetResource,
          outputMessage: `Idempotent replay detected in PostgreSQL: action already executed for key ${proposal.idempotencyKey}.`,
          k8sMode: 'live',
          timestamp: new Date().toISOString()
        };
      }
    }

    // 2. Validate status
    if (proposal.status !== 'APPROVED') {
      throw new Error(`Cannot execute proposal ${proposal.id}: status is '${proposal.status}', must be 'APPROVED'.`);
    }

    // 3. State transition: EXECUTING
    await this.incidentRepo.transitionState(incidentId, 'EXECUTING', `Executing remediation ${proposal.action} on ${proposal.targetResource}.`);
    proposal.status = 'EXECUTING';

    const executionId = randomUUID();
    let outputMsg = '';
    let success = false;
    let targetImage: string | undefined;
    let revision: number | undefined;

    try {
      const result = await this.executeLive(proposal);
      outputMsg = result.message;
      success = result.success;
      targetImage = result.targetImage;
      revision = result.revision;
    } catch (error: any) {
      outputMsg = `Execution FAILED: ${error.message}`;
      success = false;
    }

    proposal.status = success ? 'SUCCESS' : 'FAILED';
    this.telemetry.recordRemediationExecution(success);

    await this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'EXECUTION',
      title: `Execution ${success ? 'Completed' : 'Failed'}: ${proposal.action}`,
      description: outputMsg,
      data: {
        executionId,
        idempotencyKey: proposal.idempotencyKey,
        parameters: proposal.parameters,
        k8sMode: 'live',
        success,
        targetImage,
        revision
      }
    });

    if (success) {
      // 5. State transition: VERIFYING
      await this.incidentRepo.transitionState(incidentId, 'VERIFYING', 'Action executed; entering post-remediation health verification.');
    } else {
      console.error(`[ExecutionService] Execution FAILED for ${proposal.action}: ${outputMsg}`);
    }

    if (typeof this.incidentRepo.updateIncident === 'function') {
      await this.incidentRepo.updateIncident(incident);
    }

    const execResult: ExecutionResult = {
      executionId,
      idempotencyKey: proposal.idempotencyKey,
      status: success ? 'SUCCESS' : 'FAILED',
      action: proposal.action,
      targetResource: proposal.targetResource,
      outputMessage: outputMsg,
      k8sMode: 'live',
      timestamp: new Date().toISOString(),
      targetImage,
      revision
    };

    this.executedKeys.set(proposal.idempotencyKey, execResult);
    return execResult;
  }

  /**
   * LIVE: Execute remediation via real Kubernetes API
   */
  private async executeLive(proposal: RemediationProposal): Promise<{
    success: boolean;
    message: string;
    targetImage?: string;
    revision?: number;
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
        return this.k8sClient.rollbackDeployment(String(deploymentName), targetRevision);
      }

      case 'restart_pod': {
        const serviceName = proposal.parameters?.serviceName ||
                            proposal.targetResource.replace(/^pod\//, '');
        // List pods matching the target, delete them to trigger restart
        const pods = await this.k8sClient.listPods(`app=${serviceName}`);
        if (pods.length === 0) {
          return { success: false, message: `No pods found matching label app=${serviceName}` };
        }
        const podName = pods[0].metadata?.name;
        if (!podName) {
          return { success: false, message: 'Pod has no name metadata' };
        }
        return this.k8sClient.restartPod(podName);
      }

      case 'scale_workload': {
        const deploymentName = proposal.parameters?.deploymentName ||
                               proposal.parameters?.deployment ||
                               proposal.targetResource.replace(/^deployment\//, '');
        const replicas = typeof proposal.parameters?.replicas === 'number' ? proposal.parameters.replicas : 2;
        return this.k8sClient.scaleDeployment(String(deploymentName), replicas);
      }

      default:
        return {
          success: false,
          message: `Action '${proposal.action}' not supported in live K8s mode. Supported: rollback_deployment, restart_pod, scale_workload.`
        };
    }
  }
}

export * from './k8s-client.js';
