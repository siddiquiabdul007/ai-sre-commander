import type { RemediationProposal } from '@ai-sre/event-schema';
import { IncidentRepository } from '@ai-sre/incident-engine';
import { PolicyEngine, type PolicyEvaluationResult } from '@ai-sre/policy-engine';
import type { AuthUser } from '@ai-sre/auth';

export class RemediationEngine {
  private policyEngine = new PolicyEngine();

  constructor(private incidentRepo: IncidentRepository) {}

  public getProposal(incidentId: string, proposalId: string): RemediationProposal | undefined {
    const incident = this.incidentRepo.getIncident(incidentId);
    return incident?.remediationProposals.find((p) => p.id === proposalId);
  }

  public evaluateProposal(proposal: RemediationProposal): PolicyEvaluationResult {
    return this.policyEngine.evaluateProposal(proposal);
  }

  public async approveProposal(
    incidentId: string,
    proposalId: string,
    approver: AuthUser,
    justification?: string
  ): Promise<RemediationProposal> {
    const incident = this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const proposal = incident.remediationProposals.find((p) => p.id === proposalId);
    if (!proposal) {
      throw new Error(`Remediation proposal ${proposalId} not found`);
    }

    // 1. Evaluate policy
    const policyResult = this.policyEngine.evaluateProposal(proposal);
    if (!policyResult.allowed) {
      throw new Error(`Policy denied: ${policyResult.reason}`);
    }

    // 2. Verify approver role permission
    const hasRole = approver.roles.some((role) =>
      this.policyEngine.authorizeApproval(role, proposal.risk)
    );
    if (!hasRole) {
      throw new Error(`Unauthorized: User roles [${approver.roles.join(', ')}] cannot approve ${proposal.risk} risk actions.`);
    }

    // 3. Mark approved
    proposal.status = 'APPROVED';
    proposal.approvedBy = `${approver.name} (${approver.email})`;
    proposal.approvedAt = new Date().toISOString();

    // 4. Update incident state machine
    if (incident.state === 'REMEDIATION_PROPOSED') {
      this.incidentRepo.transitionState(incidentId, 'AWAITING_APPROVAL', 'Proposal reviewed by engineer.');
    }

    this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'APPROVAL',
      title: `Remediation APPROVED by ${approver.name}`,
      description: justification || `Approved action ${proposal.action} for ${proposal.targetResource}.`,
      data: {
        proposalId,
        approver: approver.email,
        risk: proposal.risk
      }
    });

    this.incidentRepo.updateIncident(incident);
    return proposal;
  }

  public async rejectProposal(
    incidentId: string,
    proposalId: string,
    rejector: AuthUser,
    reason: string
  ): Promise<RemediationProposal> {
    const incident = this.incidentRepo.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }

    const proposal = incident.remediationProposals.find((p) => p.id === proposalId);
    if (!proposal) {
      throw new Error(`Remediation proposal ${proposalId} not found`);
    }

    proposal.status = 'REJECTED';
    proposal.rejectionReason = reason;

    this.incidentRepo.addTimelineEntry(incidentId, {
      type: 'STATE_CHANGE',
      title: `Remediation REJECTED by ${rejector.name}`,
      description: `Reason: ${reason}`,
      data: { proposalId, rejector: rejector.email }
    });

    this.incidentRepo.updateIncident(incident);
    return proposal;
  }
}
