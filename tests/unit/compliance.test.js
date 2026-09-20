import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IncidentRepository } from '@ai-sre/incident-engine';
import { ComplianceService } from '@ai-sre/compliance-service';
import { NotificationService } from '@ai-sre/notification-service';

describe('Enterprise Governance, EU Compliance & Postmortem Tests', () => {
  it('records tamper-evident audit ledger and validates cryptographic hash chain', () => {
    const repo = new IncidentRepository();
    const compliance = new ComplianceService(repo);

    compliance.recordAuditEvent({
      tenant: 'tenant-eu-default',
      actor: 'system',
      actorType: 'SYSTEM',
      action: 'incident:detect',
      target: 'checkout-api',
      requestId: 'req-001'
    });

    compliance.recordAuditEvent({
      tenant: 'tenant-eu-default',
      actor: 'sre-engineer@enterprise.eu',
      actorType: 'USER',
      action: 'remediation:approve',
      target: 'deployment/checkout-api',
      requestId: 'req-002',
      policyDecision: { allowed: true, riskClass: 'HIGH' }
    });

    const chain = compliance.getAuditTrail();
    assert.equal(chain.length, 2);
    assert.equal(compliance.verifyAuditIntegrity(), true);

    // Assert that tamper-evident hashes are 64-char hex
    assert.equal(chain[0].currentHash.length, 64);
    assert.equal(chain[1].previousHash, chain[0].currentHash);
  });

  it('generates DORA ICT major incident report and NIS2 posture', () => {
    const repo = new IncidentRepository();
    const inc = repo.createIncident({
      title: 'Checkout API Outage',
      service: 'checkout-api',
      severity: 'SEV-1'
    });

    const compliance = new ComplianceService(repo);
    const dora = compliance.generateDoraReport(inc.id);

    assert.equal(dora.framework, 'DORA_EU_2022_2554');
    assert.equal(dora.ictClassification, 'MAJOR_ICT_INCIDENT');
    assert.ok(dora.thirdPartyIctDependencies.length >= 3);
    assert.ok(dora.thirdPartyIctDependencies.some((d) => d.name.includes('AKS')));

    const nis2 = compliance.generateNis2Report();
    assert.equal(nis2.framework, 'NIS2_EU_2022_2555');
    assert.equal(nis2.incidentNotificationDeadlineHours, 24);
    assert.equal(nis2.securityMeasuresEvaluated.accessControlMFA, 'ENTRA_ID_ENFORCED');
  });

  it('maintains EU AI Act transparency registry', () => {
    const repo = new IncidentRepository();
    const compliance = new ComplianceService(repo);
    const aiRegistry = compliance.getEuAiActRegistry();

    assert.match(aiRegistry.aiSystemName, /Root Cause & Remediation Engine/);
    assert.equal(aiRegistry.humanOversightPolicy, 'HUMAN_APPROVAL_MANDATORY_FOR_PRODUCTION_ACTIONS');
    assert.ok(aiRegistry.modelsInUse.length >= 2);
  });

  it('calculates SLOs and error budget burn rate', () => {
    const repo = new IncidentRepository();
    const compliance = new ComplianceService(repo);
    const slos = compliance.getSloMetrics('checkout-api');

    assert.equal(slos.length, 3);
    assert.ok(slos[0].errorBudgetRemainingPercent > 0);
  });

  it('generates structured postmortem report with corrective actions and timeline', () => {
    const repo = new IncidentRepository();
    const inc = repo.createIncident({
      title: 'Checkout API Memory Leak',
      service: 'checkout-api',
      severity: 'SEV-1'
    });

    inc.leadingHypothesis = {
      id: 'hyp_01',
      rank: 1,
      title: 'Deployment v1.1.0 Memory Leak',
      rootCause: 'Unbounded in-memory order buffer caching.',
      confidence: 94,
      supportingEvidenceCount: 7,
      contradictoryEvidenceCount: 1,
      supportingEvidenceIds: ['ev_1', 'ev_2'],
      contradictoryEvidenceIds: ['ev_3'],
      explanation: 'Deployment preceded OOMKills.'
    };
    repo.updateIncident(inc);

    const compliance = new ComplianceService(repo);
    const postmortem = compliance.generatePostmortem(inc.id);

    assert.equal(postmortem.incidentId, inc.id);
    assert.match(postmortem.title, /Checkout API Memory Leak/);
    assert.ok(postmortem.correctiveActions.length >= 2);
    assert.ok(postmortem.evidenceCitations.length >= 2);
  });

  it('dispatches notifications to Slack/Teams for incident and approval events', async () => {
    const repo = new IncidentRepository();
    const inc = repo.createIncident({
      title: 'Checkout API Crash',
      service: 'checkout-api',
      severity: 'SEV-1'
    });

    const notif = new NotificationService();
    const res1 = await notif.notifyIncidentCreated(inc);
    assert.equal(res1.channel, 'slack');
    assert.match(res1.subject, /SEV-1/);

    const res2 = await notif.notifyApprovalRequired(inc, {
      id: 'rem-1',
      incidentId: inc.id,
      action: 'rollback_deployment',
      risk: 'HIGH',
      environment: 'production',
      namespace: 'payments',
      targetResource: 'deployment/checkout-api',
      parameters: {},
      expectedImpact: 'Restores stable release',
      blastRadius: 'payments',
      status: 'PROPOSED',
      proposedBy: 'ai',
      reason: 'Memory leak',
      idempotencyKey: 'idemp-1',
      createdAt: new Date().toISOString()
    });
    assert.match(res2.subject, /APPROVAL REQUIRED/);
    assert.equal(notif.getHistory().length, 2);
  });
});
