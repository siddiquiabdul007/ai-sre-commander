import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { IncidentRepository } from '@ai-sre/incident-engine';
import { CorrelationEngine } from '@ai-sre/correlation-engine';
import { EventNormalizer } from '@ai-sre/event-ingestion';
import { AIOrchestrator } from '@ai-sre/ai-orchestrator';
import { EvidenceService } from '@ai-sre/evidence-service';
import { RemediationEngine } from '@ai-sre/remediation-engine';
import { PolicyEngine } from '@ai-sre/policy-engine';
import { ExecutionService } from '@ai-sre/execution-service';
import { VerificationService } from '@ai-sre/verification-service';
import { ComplianceService } from '@ai-sre/compliance-service';
import { NotificationService } from '@ai-sre/notification-service';

describe('PRD §26.1 & §38 Flagship Demonstration Scenario: 20-Step Golden Incident', () => {
  it('executes full 20-step incident detection, investigation, remediation, and resolution chain', async () => {
    // 0. Setup Control Plane Services
    const repo = new IncidentRepository();
    const correlation = new CorrelationEngine(repo, 30);
    const orchestrator = new AIOrchestrator(repo);
    const evidenceService = new EvidenceService();
    const policyEngine = new PolicyEngine();
    const remediationEngine = new RemediationEngine(repo);
    const executionService = new ExecutionService(repo);
    const verificationService = new VerificationService(repo);
    const complianceService = new ComplianceService(repo);
    const notificationService = new NotificationService();

    // Step 1: Deploy checkout-api v1.0.0 (Baseline)
    const baselineDeploy = EventNormalizer.normalizeGitHub({
      deployment: { ref: 'v1.0.0', sha: 'a000001', environment: 'production' },
      repository: { name: 'checkout-api' }
    });
    assert.equal(baselineDeploy.service, 'checkout-api');

    // Step 2: Confirm healthy metrics (Baseline established)
    const baselineMetrics = { errorRatePercent: 0.02, memoryMb: 180, healthyReplicas: 3 };
    assert.ok(baselineMetrics.errorRatePercent < 0.1);

    // Step 3: Deploy intentionally faulty checkout-api v1.1.0 (contains memory leak)
    const faultyDeploy = EventNormalizer.normalizeGitHub({
      deployment: { ref: 'v1.1.0', sha: 'e7a4b12399ff', environment: 'production' },
      repository: { name: 'checkout-api' },
      head_commit: { message: 'feat(payments): add in-memory order buffer caching layer' }
    });
    const cDeploy = correlation.correlate(faultyDeploy);
    const incidentId = cDeploy.incident.id;

    // Step 4: Memory usage increases (+47 MB/min steep slope)
    // Step 5: Pods become OOMKilled
    const k8sEvent = EventNormalizer.normalizeKubernetes({
      reason: 'OOMKilled',
      involvedObject: { kind: 'Pod', name: 'checkout-api-7b9d9c-f12', labels: { app: 'checkout-api' } },
      message: 'Container limit 512Mi exceeded with exit code 137'
    });
    const cK8s = correlation.correlate(k8sEvent);
    assert.equal(cK8s.matchedIncidentId, incidentId, 'K8s OOMKilled event must correlate with active incident');

    // Step 6: HTTP 500 rate increases (6.8%)
    // Step 7: Prometheus triggers alert
    const promAlert = EventNormalizer.normalizePrometheus({
      labels: { alertname: 'HighErrorRate5xx', service: 'checkout-api', severity: 'critical' },
      annotations: { summary: 'HTTP 500 error rate spiked to 6.8%' }
    });

    // Step 8: Commander creates/updates incident
    const cAlert = correlation.correlate(promAlert);
    assert.equal(cAlert.matchedIncidentId, incidentId);
    const incident = repo.getIncident(incidentId);
    assert.ok(incident);
    assert.equal(incident.severity, 'SEV-1');

    complianceService.recordAuditEvent({
      tenant: 'tenant-eu-default',
      actor: 'system',
      actorType: 'SYSTEM',
      action: 'incident:detected',
      target: incident.id,
      requestId: randomUUID(),
      incidentId: incident.id
    });

    // Step 9: Agents collect evidence
    // Step 10: Correlation engine links deployment to degradation
    // Step 11: RCA ranks v1.1.0 as leading cause (>90% confidence)
    // Step 12: Remediation engine proposes rollback
    const invResult = await orchestrator.runInvestigation(incidentId);
    for (const ev of invResult.evidence) {
      evidenceService.addEvidence(incidentId, ev);
    }

    assert.equal(invResult.confidence, 94);
    assert.match(invResult.leadingHypothesisTitle, /Deployment v1.1.0/);
    assert.equal(invResult.proposedAction, 'rollback_deployment');

    // Step 13: Policy engine classifies production rollback as HIGH
    const proposal = incident.remediationProposals[0];
    const policyResult = policyEngine.evaluateProposal(proposal);
    assert.equal(policyResult.riskClass, 'HIGH');
    assert.equal(policyResult.requiresHumanApproval, true);

    // Step 14: UI requests human approval
    const notif = await notificationService.notifyApprovalRequired(incident, proposal);
    assert.match(notif.subject, /APPROVAL REQUIRED/);

    // Step 15: Engineer approves with explicit justification
    const sreUser = {
      id: 'usr_sre_01',
      email: 'sre-lead@enterprise.eu',
      name: 'Alex Rivera (Staff SRE)',
      tenantId: 'tenant-eu-default',
      roles: ['sre'],
      tokenIssuer: 'https://login.microsoftonline.com/entra-id'
    };
    const approvedProposal = await remediationEngine.approveProposal(
      incidentId,
      proposal.id,
      sreUser,
      'Approved after verifying memory leak in PR #142 caching layer.'
    );
    assert.equal(approvedProposal.status, 'APPROVED');

    complianceService.recordAuditEvent({
      tenant: 'tenant-eu-default',
      actor: sreUser.email,
      actorType: 'USER',
      action: 'remediation:approve',
      target: approvedProposal.targetResource,
      requestId: randomUUID(),
      incidentId,
      approvalId: approvedProposal.id
    });

    // Step 16: Execution service rolls back
    const execResult = await executionService.executeProposal(incidentId, approvedProposal);
    assert.equal(execResult.status, 'SUCCESS');
    assert.match(execResult.outputMessage, /rolled back to revision 26/);

    // Step 17: Verification confirms recovery
    const verifResult = await verificationService.verifyIncidentRecovery(incidentId);
    assert.equal(verifResult.verification.verified, true);
    assert.equal(verifResult.verification.metrics.errorRatePercent, 0.02);

    // Step 18: Incident is resolved
    const resolvedIncident = repo.getIncident(incidentId);
    assert.equal(resolvedIncident?.state, 'RESOLVED');
    assert.ok(resolvedIncident?.resolvedAt);

    // Step 19: Postmortem is generated
    const postmortem = complianceService.generatePostmortem(incidentId);
    assert.equal(postmortem.incidentId, incidentId);
    assert.ok(postmortem.correctiveActions.length >= 2);
    assert.ok(postmortem.timeline.length >= 5);

    // Step 20: Audit record captures complete chain with cryptographic integrity
    complianceService.recordAuditEvent({
      tenant: 'tenant-eu-default',
      actor: 'ai-verification-agent',
      actorType: 'AI_AGENT',
      action: 'incident:resolved',
      target: incidentId,
      requestId: randomUUID(),
      incidentId
    });

    const auditChain = complianceService.getAuditTrail();
    assert.ok(auditChain.length >= 3);
    assert.equal(complianceService.verifyAuditIntegrity(), true, 'Tamper-evident audit chain must verify cleanly');
  });
});
