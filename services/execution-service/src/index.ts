/**
 * Execution Service — Real Kubernetes Remediation Execution
 * 
 * PRD v2.0 §3.2: Real K8s API calls for remediation execution.
 * - K8S_MODE=live: Real @kubernetes/client-node calls
 * - K8S_MODE=offline: Deterministic simulated responses (local dev only)
 * - Idempotency enforcement via in-memory key set (Stage 5 will migrate to DB)
 * - Error handling: permission denied, stale revision, network timeout
 */

import { randomUUID } from 'node:crypto';
import type { RemediationProposal } from '@ai-sre/event-schema';
import { IncidentRepository } from '@ai-sre/incident-engine';
import { TelemetryCollector } from '@ai-sre/telemetry';
import { K8sClient } from './k8s-client.js';

export type K8sMode = 'live' | 'offline';

export interface ExecutionResult {
  executionId: string;
  idempotencyKey: string;
  status: 'SUCCESS' | 'FAILED';
  action: string;
  targetResource: string;
  outputMessage: string;
  k8sMode: K8sMode;
  timestamp: string;
}

export class ExecutionService {
  private executedKeys = new Set<string>();
  private telemetry = TelemetryCollector.getInstance();
  private k8sClient: K8sClient | null = null;
  private mode: K8sMode;

  constructor(private incidentRepo: IncidentRepository) {
    this.mode = (process.env.K8S_MODE as K8sMode) || 'offline';

    if (this.mode === 'live') {
      try {
        this.k8sClient = new K8sClient({
          namespace: process.env.K8S_NAMESPACE || 'sre-demo'
        });
        console.log('[ExecutionService] Initialized in LIVE mode — real K8s API calls enabled.');
      } catch (error: any) {
        console.error(`[ExecutionService] Failed to init K8s client: ${error.message}. Falling back to offline.`);
        this.mode = 'offline';
      }
    } else {
      console.log('[ExecutionService] Initialized in OFFLINE mode — deterministic responses.');
    }
  }

  public async executeProposal(incidentId: string, proposal: RemediationProposal): Promise<ExecutionResult> {
    const incident = this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    // 1. Enforce Idempotency Key (PRD §18)
    if (this.executedKeys.has(proposal.idempotencyKey)) {
      return {
        executionId: `exec_cached_${proposal.idempotencyKey.substring(0, 8)}`,
        idempotencyKey: proposal.idempotencyKey,
        status: 'SUCCESS',
        action: proposal.action,
        targetResource: proposal.targetResource,
        outputMessage: `Idempotent replay detected: action already executed for key ${proposal.idempotencyKey}.`,
        k8sMode: this.mode,
        timestamp: new Date().toISOString()
      };
    }

    // 2. Validate status
    if (proposal.status !== 'APPROVED') {
      throw new Error(`Cannot execute proposal ${proposal.id}: status is '${proposal.status}', must be 'APPROVED'.`);
    }

    this.executedKeys.add(proposal.idempotencyKey);

    // 3. State transition: EXECUTING
    this.incidentRepo.transitionState(incidentId, 'EXECUTING', `Executing remediation ${proposal.action} on ${proposal.targetResource}.`);
    proposal.status = 'EXECUTING';

    const executionId = randomUUID();
    let outputMsg = '';
    let success = false;

    try {
      if (this.mode === 'live' && this.k8sClient) {
        // LIVE: Real Kubernetes API calls
        const result = await this.executeLive(proposal);
        outputMsg = result.message;
        success = result.success;
      } else {
        // OFFLINE: Deterministic simulated responses
        outputMsg = this.executeOffline(proposal);
        success = true;
      }
    } catch (error: any) {
      outputMsg = `Execution FAILED: ${error.message}`;
      success = false;
    }

    proposal.status = success ? 'SUCCESS' : 'FAILED';
    this.telemetry.recordRemediationExecution(success);

    this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'EXECUTION',
      title: `Execution ${success ? 'Completed' : 'Failed'}: ${proposal.action}`,
      description: outputMsg,
      data: {
        executionId,
        idempotencyKey: proposal.idempotencyKey,
        parameters: proposal.parameters,
        k8sMode: this.mode,
        success
      }
    });

    if (success) {
      // 5. State transition: VERIFYING
      this.incidentRepo.transitionState(incidentId, 'VERIFYING', 'Action executed; entering post-remediation health verification.');
    } else {
      // Failed — stay in EXECUTING state, log the failure
      console.error(`[ExecutionService] Execution FAILED for ${proposal.action}: ${outputMsg}`);
    }

    this.incidentRepo.updateIncident(incident);

    return {
      executionId,
      idempotencyKey: proposal.idempotencyKey,
      status: success ? 'SUCCESS' : 'FAILED',
      action: proposal.action,
      targetResource: proposal.targetResource,
      outputMessage: outputMsg,
      k8sMode: this.mode,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * LIVE: Execute remediation via real Kubernetes API
   */
  private async executeLive(proposal: RemediationProposal): Promise<{ success: boolean; message: string }> {
    if (!this.k8sClient) {
      throw new Error('K8s client not initialized');
    }

    const actionNormalized = proposal.action.toLowerCase();

    switch (actionNormalized) {
      case 'rollback_deployment': {
        const deploymentName = proposal.parameters?.deploymentName || proposal.parameters?.deployment || proposal.targetResource.replace(/^deployment\//, '');
        const targetRevision = typeof proposal.parameters?.targetRevision === 'number'
          ? proposal.parameters.targetRevision
          : undefined;
        return this.k8sClient.rollbackDeployment(String(deploymentName), targetRevision);
      }

      case 'restart_pod': {
        const serviceName = proposal.parameters?.serviceName || proposal.targetResource.replace(/^pod\//, '');
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
        const deploymentName = proposal.parameters?.deploymentName || proposal.parameters?.deployment || proposal.targetResource.replace(/^deployment\//, '');
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

  /**
   * OFFLINE: Deterministic rule-based responses for local development
   */
  private executeOffline(proposal: RemediationProposal): string {
    if (proposal.action === 'rollback_deployment') {
      const targetRev = proposal.parameters.targetRevision || 26;
      return `[OFFLINE] Kubernetes API: Deployment '${proposal.parameters.deployment}' in namespace '${proposal.namespace}' rolled back to revision ${targetRev}. RollingUpdate pods progressing.`;
    } else if (proposal.action === 'restart_pod') {
      return `[OFFLINE] Kubernetes API: Pod restart triggered for target in namespace '${proposal.namespace}'.`;
    } else if (proposal.action === 'scale_workload') {
      return `[OFFLINE] Kubernetes API: Scaled ${proposal.targetResource} to ${proposal.parameters.replicas || 3} replicas.`;
    } else {
      return `[OFFLINE] Action ${proposal.action} executed against ${proposal.targetResource}.`;
    }
  }
}
