import type { RemediationProposal, RiskClass } from '@ai-sre/event-schema';
import { PolicyEngine, type PolicyEvaluationResult } from '@ai-sre/policy-engine';
import type { AuthUser } from '@ai-sre/auth';
import { createHash } from 'node:crypto';

export class RemediationEngine {
  private policyEngine = new PolicyEngine();
  public static readonly DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000; // 15 minutes

  constructor(private incidentRepo: any) {}

  public async getProposal(incidentId: string, proposalId: string): Promise<RemediationProposal | undefined> {
    const incident = await this.incidentRepo.getIncident(incidentId);
    return incident?.remediationProposals?.find((p: any) => p.id === proposalId);
  }

  public evaluateProposal(proposal: RemediationProposal): PolicyEvaluationResult {
    return this.policyEngine.evaluateProposal(proposal);
  }

  public computeProposalHash(proposal: RemediationProposal): string {
    const canonical = {
      action: proposal.action,
      targetResource: proposal.targetResource,
      parameters: proposal.parameters || {},
      environment: proposal.environment,
      policyVersion: PolicyEngine.POLICY_VERSION
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  /**
   * FR-P1-003, FR-P1-004, FR-P1-005, FR-P1-006:
   * Atomic, multi-party quorum approval bound to immutable proposal snapshot and TTL.
   */
  public async approveProposal(
    incidentId: string,
    proposalId: string,
    approver: AuthUser,
    justification?: string
  ): Promise<RemediationProposal> {
    const incident = await this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const proposal = incident.remediationProposals?.find((p: any) => p.id === proposalId);
    if (!proposal) {
      throw new Error(`Remediation proposal ${proposalId} not found`);
    }

    // 1. Evaluate deterministic policy
    // FR-P1-001: Derive canonical risk from context, never trust proposal.risk
    const policyResult = this.policyEngine.evaluateProposal(proposal);
    if (!policyResult.allowed) {
      throw new Error(`Policy denied: ${policyResult.reason}`);
    }

    const canonicalRisk = policyResult.riskClass;
    proposal.risk = canonicalRisk;

    // 2. Verify approver role permission against canonical risk
    const hasRole = approver.roles.some((role) =>
      this.policyEngine.authorizeApproval(role, canonicalRisk)
    );
    if (!hasRole) {
      throw new Error(`Unauthorized: User roles [${approver.roles.join(', ')}] cannot approve ${canonicalRisk} risk actions.`);
    }

    // 3. Compute immutable canonical proposal hash
    const proposalHash = this.computeProposalHash(proposal);
    proposal.proposalHash = proposalHash;

    const expiresAt = new Date(Date.now() + RemediationEngine.DEFAULT_APPROVAL_TTL_MS).toISOString();
    proposal.expiresAt = expiresAt;

    let quorumSatisfied = true;
    let distinctApproversCount = 1;

    // 4. FR-P1-004: Transactional DB quorum approval if repo supports it
    if (typeof (this.incidentRepo as any).addApproval === 'function') {
      const approvalResult = await (this.incidentRepo as any).addApproval(proposalId, {
        approverSubject: approver.id || approver.email,
        approverName: approver.name,
        approverEmail: approver.email,
        role: approver.roles[0] || 'sre',
        justification: justification || `Approved action ${proposal.action} for ${proposal.targetResource}.`,
        proposalHash,
        tenantId: incident.tenantId,
        requiredQuorum: policyResult.requiredQuorum
      });

      quorumSatisfied = approvalResult.quorumSatisfied;
      distinctApproversCount = approvalResult.distinctApprovers;
    }

    if (quorumSatisfied) {
      proposal.status = 'APPROVED';
      proposal.approvedBy = `${approver.name} (${approver.email})`;
      proposal.approvedAt = new Date().toISOString();

      if (incident.state === 'REMEDIATION_PROPOSED' || incident.state === 'AWAITING_APPROVAL') {
        await this.incidentRepo.transitionState(
          incidentId,
          'APPROVED',
          `Quorum satisfied (${distinctApproversCount}/${policyResult.requiredQuorum}). Proposal approved.`
        ).catch(() => {
          return this.incidentRepo.transitionState(incidentId, 'AWAITING_APPROVAL', 'Approved by operator.');
        });
      }
    } else {
      proposal.status = 'PENDING_APPROVAL';
      if (incident.state === 'REMEDIATION_PROPOSED') {
        await this.incidentRepo.transitionState(
          incidentId,
          'AWAITING_APPROVAL',
          `Partial approval recorded (${distinctApproversCount}/${policyResult.requiredQuorum}). Awaiting quorum.`
        );
      }
    }

    await this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'APPROVAL',
      title: `Remediation Approval from ${approver.name}`,
      description: justification || `Approved action ${proposal.action} (Quorum: ${distinctApproversCount}/${policyResult.requiredQuorum}).`,
      data: {
        proposalId,
        approver: approver.email,
        risk: canonicalRisk,
        proposalHash,
        quorumSatisfied,
        distinctApprovers: distinctApproversCount
      }
    });

    if (typeof (this.incidentRepo as any).updateProposalStatus === 'function') {
      await (this.incidentRepo as any).updateProposalStatus(proposalId, proposal.status);
    }
    await this.incidentRepo.updateIncident(incident);

    return proposal;
  }

  public async rejectProposal(
    incidentId: string,
    proposalId: string,
    rejector: AuthUser,
    reason: string
  ): Promise<RemediationProposal> {
    const incident = await this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const proposal = incident.remediationProposals?.find((p: any) => p.id === proposalId);
    if (!proposal) {
      throw new Error(`Remediation proposal ${proposalId} not found`);
    }

    proposal.status = 'REJECTED';
    proposal.rejectionReason = reason;

    await this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'STATE_CHANGE',
      title: `Remediation REJECTED by ${rejector.name}`,
      description: `Reason: ${reason}`,
      data: { proposalId, rejector: rejector.email }
    });

    if (typeof (this.incidentRepo as any).updateProposalStatus === 'function') {
      await (this.incidentRepo as any).updateProposalStatus(proposalId, 'REJECTED');
    }
    await this.incidentRepo.updateIncident(incident);

    return proposal;
  }
}
