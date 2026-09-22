import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IncidentRepository } from '@ai-sre/incident-engine';
import { PolicyEngine } from '@ai-sre/policy-engine';
import { RemediationEngine } from '@ai-sre/remediation-engine';
import { ExecutionService } from '@ai-sre/execution-service';
import { VerificationService } from '@ai-sre/verification-service';
import { EvidenceService } from '@ai-sre/evidence-service';


describe('Remediation, Policy Engine, Execution & Verification Tests', () => {
  it('enforces policy engine risk rules and approval gates', () => {
    const policy = new PolicyEngine();

    // High risk in prod
    const highRiskProposal = {
      id: 'rem_01',
      incidentId: 'inc_01',
      action: 'rollback_deployment',
      risk: 'HIGH',
      environment: 'production',
      namespace: 'payments',
      targetResource: 'deployment/checkout-api',
      parameters: { deployment: 'checkout-api', targetRevision: 26 },
      expectedImpact: 'Revert to revision 26',
      blastRadius: 'checkout-api only',
      status: 'PROPOSED',
      proposedBy: 'ai',
      reason: 'Memory leak detected',
      idempotencyKey: 'idemp_01',
      createdAt: new Date().toISOString()
    };

    const evalHigh = policy.evaluateProposal(highRiskProposal);
    assert.equal(evalHigh.allowed, true);
    assert.equal(evalHigh.requiresHumanApproval, true);
    assert.equal(evalHigh.ruleEvaluated, 'RULE_HIGH_RISK_HUMAN_APPROVAL_REQUIRED');

    // Unallowed action type
    const illegalProposal = {
      ...highRiskProposal,
      action: 'delete_entire_database'
    };
    const evalIllegal = policy.evaluateProposal(illegalProposal);
    assert.equal(evalIllegal.allowed, false);
    assert.match(evalIllegal.reason, /not in the approved remediation allow-list/);
  });

  it('rejects unauthorized approval attempts and allows SRE approval', async () => {
    const repo = new IncidentRepository();
    const inc = repo.createIncident({
      title: 'Checkout API CrashLoop',
      service: 'checkout-api',
      severity: 'SEV-1'
    });

    const proposal = {
      id: 'rem_02',
      incidentId: inc.id,
      action: 'rollback_deployment',
      risk: 'HIGH',
      environment: 'production',
      namespace: 'payments',
      targetResource: 'deployment/checkout-api',
      parameters: { deployment: 'checkout-api', targetRevision: 26 },
      expectedImpact: 'Revert to revision 26',
      blastRadius: 'checkout-api only',
      status: 'PROPOSED',
      proposedBy: 'ai',
      reason: 'Memory leak detected',
      idempotencyKey: 'idemp_02',
      createdAt: new Date().toISOString()
    };

    inc.remediationProposals = [proposal];
    repo.updateIncident(inc);

    const remEngine = new RemediationEngine(repo);

    // Attempt 1: Developer role (must fail for HIGH risk in production)
    const devUser = {
      id: 'usr_dev',
      email: 'dev@enterprise.eu',
      name: 'Dev User',
      tenantId: 'tenant-eu-default',
      roles: ['developer'],
      tokenIssuer: 'test'
    };

    await assert.rejects(async () => {
      await remEngine.approveProposal(inc.id, proposal.id, devUser);
    }, /Unauthorized/);

    // Attempt 2: SRE role (must succeed)
    const sreUser = {
      id: 'usr_sre',
      email: 'sre@enterprise.eu',
      name: 'Staff SRE',
      tenantId: 'tenant-eu-default',
      roles: ['sre'],
      tokenIssuer: 'test'
    };

    const approved = await remEngine.approveProposal(inc.id, proposal.id, sreUser, 'Approved after verifying memory leak');
    assert.equal(approved.status, 'APPROVED');
    assert.match(approved.approvedBy, /Staff SRE/);
  });

  it('executes approved action with idempotency protection and verifies recovery', async () => {
    const repo = new IncidentRepository();
    const namespace = process.env.K8S_NAMESPACE || 'sre-demo';
    const inc = repo.createIncident({
      title: 'Checkout API CrashLoop',
      service: 'checkout-api',
      severity: 'SEV-1',
      namespace
    });

    // Advance to REMEDIATION_PROPOSED
    repo.transitionState(inc.id, 'TRIAGED');
    repo.transitionState(inc.id, 'INVESTIGATING');
    repo.transitionState(inc.id, 'DIAGNOSED');
    repo.transitionState(inc.id, 'REMEDIATION_PROPOSED');

    const proposal = {
      id: 'rem_03',
      incidentId: inc.id,
      action: 'rollback_deployment',
      risk: 'HIGH',
      environment: 'production',
      namespace,
      targetResource: 'deployment/checkout-api',
      parameters: { deployment: 'checkout-api', targetRevision: 1, namespace },
      expectedImpact: 'Revert to revision 26',
      blastRadius: 'checkout-api only',
      status: 'APPROVED',
      proposedBy: 'ai',
      reason: 'Memory leak detected',
      idempotencyKey: 'idemp_key_unique_999',
      createdAt: new Date().toISOString()
    };

    inc.remediationProposals = [proposal];
    repo.updateIncident(inc);

    const execService = new ExecutionService(repo);

    // 1. First execution
    const execResult = await execService.executeProposal(inc.id, proposal);
    assert.equal(execResult.status, 'SUCCESS');
    assert.equal(repo.getIncident(inc.id)?.state, 'VERIFYING');

    // 2. Duplicate replay with same idempotency key (must not re-run)
    const replayResult = await execService.executeProposal(inc.id, proposal);
    assert.match(replayResult.outputMessage, /Idempotent replay detected/);

    // 3. Post-execution verification
    const verifService = new VerificationService(repo);
    const verifResult = await verifService.verifyIncidentRecovery(inc.id);

    assert.equal(verifResult.verification.verified, true);
    assert.equal(repo.getIncident(inc.id)?.state, 'RESOLVED');
  });

  it('manages evidence objects and exports verifiable evidence bundles', () => {
    const evidenceService = new EvidenceService();
    const incId = 'inc_ev_01';

    evidenceService.addEvidence(incId, {
      type: 'METRIC_ANOMALY',
      source: 'prometheus',
      title: '5xx Error Rate Spike',
      summary: '5xx spike to 6.8%',
      confidence: 98,
      isContradictory: false,
      provenance: { sourceSystem: 'prom', extractedAt: new Date().toISOString(), untrustedInputHash: '' },
      data: { rate: 6.8 }
    });

    evidenceService.addEvidence(incId, {
      type: 'BASELINE_DEVIATION',
      source: 'azure',
      title: 'Downstream DB Healthy',
      summary: 'DB latency 12ms steady',
      confidence: 99,
      isContradictory: true,
      provenance: { sourceSystem: 'azure-db', extractedAt: new Date().toISOString(), untrustedInputHash: '' },
      data: { latency: 12 }
    });

    const bundle = evidenceService.generateEvidenceBundle(incId);
    assert.equal(bundle.totalCount, 2);
    assert.equal(bundle.supportingCount, 1);
    assert.equal(bundle.contradictoryCount, 1);
    assert.ok(bundle.bundleHash.length === 64, 'Must have valid SHA-256 bundle hash');
  });
});
