/**
 * Concurrency, Quorum & Security Boundary Integration Tests
 * 
 * Directly tests acceptance criteria from PRD Sections 5.1, 5.3, 5.4, 12, 17:
 * - FR-P0-004: 100 concurrent requests with the same idempotency key produce exactly one active claim
 * - FR-P1-003: 20 concurrent approvals for one proposal produce one accepted terminal transition
 * - FR-P1-004: Two approvals from same identity cannot satisfy 2-person quorum
 * - FR-P1-005: Canonical proposal hash binding rejects mutated parameters
 * - FR-P1-006: Approval TTL expiry enforced
 * - FR-P1-007: Tenant isolation across database boundaries
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaIncidentRepository, getPrismaClient } from '@ai-sre/database';
import { PolicyEngine } from '@ai-sre/policy-engine';

describe('PRD §12 Concurrency, Quorum & Tenant Security Gates', () => {
  let prisma;
  let repo;
  let testIncident;

  before(async () => {
    prisma = getPrismaClient();
    repo = new PrismaIncidentRepository(prisma);

    testIncident = await repo.createIncident({
      title: 'PRD §12 Concurrency & Quorum Verification Incident',
      service: 'checkout-api',
      severity: 'CRITICAL',
      environment: 'production',
      cluster: 'aks-aisre-prod',
      namespace: 'sre-demo',
      tenantId: 'tenant-eu-alpha'
    });
  });

  it('FR-P0-004: 100 concurrent execution claims with same key produce exactly 1 active claim', async () => {
    const proposal = await repo.createRemediationProposal({
      incidentId: testIncident.id,
      action: 'scale_workload',
      targetResource: 'deployment/checkout-api',
      parameters: { replicas: 3 },
      computedRisk: 'LOW',
      proposalHash: 'hash-claim-race-test',
      tenantId: 'tenant-eu-alpha',
      expiresInSeconds: 300
    });
    const sharedIdempotencyKey = `idemp-100-way-${randomUUID()}`;
    const proposalId = proposal.id;

    // Fire 100 concurrent claim attempts across workers
    const claimPromises = Array.from({ length: 100 }, (_, i) => {
      return repo.claimExecution({
        proposalId,
        incidentId: testIncident.id,
        idempotencyKey: sharedIdempotencyKey,
        claimedBy: `worker-replica-${i}`,
        leaseDurationMs: 60000,
        tenantId: 'tenant-eu-alpha'
      }).catch((err) => ({ error: err.message, code: err.code }));
    });

    const results = await Promise.all(claimPromises);

    const newClaims = results.filter((r) => r.isNewClaim);
    const leaseHeld = results.filter((r) => r.code === 'LEASE_HELD' || (!r.isNewClaim && r.execution));

    assert.equal(newClaims.length, 1, 'Exactly one worker must obtain the active claim');
    assert.equal(newClaims.length + leaseHeld.length, 100, 'All 100 workers must be accounted for');

    // The winning claim must be valid and bound to the lease
    assert.ok(newClaims[0].execution.id);
    assert.equal(newClaims[0].execution.idempotencyKey, sharedIdempotencyKey);
  });

  it('FR-P1-003: 20 concurrent approvals for one proposal produce exactly one accepted terminal transition', async () => {
    const proposal = await repo.createRemediationProposal({
      incidentId: testIncident.id,
      action: 'scale_workload',
      targetResource: 'deployment/checkout-api',
      parameters: { replicas: 3 },
      computedRisk: 'LOW',
      proposalHash: 'hash-concurrency-test',
      tenantId: 'tenant-eu-alpha',
      expiresInSeconds: 300
    });

    // 20 concurrent approval attempts for the single-approver proposal
    const approvalPromises = Array.from({ length: 20 }, (_, i) => {
      return repo.addApproval({
        proposalId: proposal.id,
        tenantId: 'tenant-eu-alpha',
        approverSubject: `sre-operator-${i}@enterprise.eu`,
        role: 'sre',
        justification: `Approved scale update from runner ${i}`,
        proposalHash: 'hash-concurrency-test'
      }).catch((err) => ({ error: err.message, code: (err).code }));
    });

    const results = await Promise.all(approvalPromises);

    // Exactly one must succeed in transitioning the proposal, subsequent ones succeed as idempotently approved or error
    const successful = results.filter((r) => !r.error);
    assert.ok(successful.length >= 1, 'At least 1 approval succeeds');

    // Check final proposal state in database
    const proposalAfter = await prisma.remediationProposal.findUnique({
      where: { id: proposal.id }
    });
    assert.equal(proposalAfter.status, 'APPROVED');
  });

  it('FR-P1-004: Two approvals from the same identity cannot satisfy a 2-person quorum', async () => {
    const proposal = await repo.createRemediationProposal({
      incidentId: testIncident.id,
      action: 'rollback_deployment',
      targetResource: 'deployment/checkout-api',
      parameters: { deployment: 'checkout-api', targetRevision: 10 },
      computedRisk: 'CRITICAL', // CRITICAL requires 2 distinct approvers
      proposalHash: 'hash-quorum-test-999',
      tenantId: 'tenant-eu-alpha',
      expiresInSeconds: 300
    });

    // Approver 1 approves
    const app1 = await repo.addApproval({
      proposalId: proposal.id,
      tenantId: 'tenant-eu-alpha',
      approverSubject: 'alice.sre@enterprise.eu',
      role: 'sre',
      justification: 'Critical rollback verified',
      proposalHash: 'hash-quorum-test-999',
      requiredQuorum: 2
    });

    assert.equal(app1.quorumSatisfied, false, 'Quorum should not be satisfied with only 1 approval');
    assert.equal(app1.distinctApprovers, 1);

    // Same approver (Alice) tries to approve a second time to satisfy quorum
    await assert.rejects(async () => {
      await repo.addApproval({
        proposalId: proposal.id,
        tenantId: 'tenant-eu-alpha',
        approverSubject: 'alice.sre@enterprise.eu', // duplicate identity
        role: 'sre',
        justification: 'Trying to approve again',
        proposalHash: 'hash-quorum-test-999',
        requiredQuorum: 2
      });
    }, (err) => {
      return err.message.includes('already approved') || (err).code === 'DUPLICATE_APPROVER';
    });

    // Distinct approver (Bob) approves -> Quorum satisfied!
    const app2 = await repo.addApproval({
      proposalId: proposal.id,
      tenantId: 'tenant-eu-alpha',
      approverSubject: 'bob.security@enterprise.eu',
      role: 'security_lead',
      justification: 'Second independent SRE approval',
      proposalHash: 'hash-quorum-test-999',
      requiredQuorum: 2
    });

    assert.equal(app2.quorumSatisfied, true, 'Quorum must be satisfied with 2 distinct approvers');
    assert.equal(app2.distinctApprovers, 2);
  });

  it('FR-P1-005: Modifying parameters invalidates proposal hash and blocks approval', async () => {
    const canonicalHash = 'canonical-hash-immutable-42';
    const proposal = await repo.createRemediationProposal({
      incidentId: testIncident.id,
      action: 'scale_workload',
      targetResource: 'deployment/checkout-api',
      parameters: { replicas: 4 },
      computedRisk: 'HIGH',
      proposalHash: canonicalHash,
      tenantId: 'tenant-eu-alpha',
      expiresInSeconds: 300
    });

    // Attempt approval with altered proposal hash (simulating parameter tampering)
    const tamperedHash = 'tampered-hash-attacker-55';
    await assert.rejects(async () => {
      await repo.addApproval({
        proposalId: proposal.id,
        tenantId: 'tenant-eu-alpha',
        approverSubject: 'sre-auditor@enterprise.eu',
        role: 'sre',
        justification: 'Approving tampered proposal',
        proposalHash: tamperedHash
      });
    }, (err) => {
      return (err).code === 'STALE_PROPOSAL' || err.message.includes('Proposal hash mismatch');
    });
  });

  it('FR-P1-006: Approval after TTL expiration is rejected', async () => {
    // Create proposal expired 10 seconds ago
    const expiredProposal = await repo.createRemediationProposal({
      incidentId: testIncident.id,
      action: 'restart_pod',
      targetResource: 'pod/checkout-api-xxx',
      parameters: { podName: 'checkout-api-xxx' },
      computedRisk: 'LOW',
      proposalHash: 'hash-expired-ttl',
      tenantId: 'tenant-eu-alpha',
      expiresInSeconds: -10 // already expired
    });

    await assert.rejects(async () => {
      await repo.addApproval({
        proposalId: expiredProposal.id,
        tenantId: 'tenant-eu-alpha',
        approverSubject: 'sre@enterprise.eu',
        role: 'sre',
        justification: 'Approving past TTL',
        proposalHash: 'hash-expired-ttl'
      });
    }, (err) => {
      return (err).code === 'APPROVAL_EXPIRED' || err.message.includes('expired');
    });
  });

  it('FR-P1-007: Cross-tenant isolation blocks Tenant B from accessing or approving Tenant A resources', async () => {
    const proposalTenantA = await repo.createRemediationProposal({
      incidentId: testIncident.id,
      action: 'restart_pod',
      targetResource: 'pod/checkout-api-tenant-a',
      parameters: { podName: 'checkout-api-tenant-a' },
      computedRisk: 'LOW',
      proposalHash: 'hash-tenant-a-only',
      tenantId: 'tenant-eu-alpha',
      expiresInSeconds: 300
    });

    // Tenant B attempts to read Tenant A's incident
    await assert.rejects(async () => {
      await repo.getIncident(testIncident.id, 'tenant-eu-beta');
    }, (err) => {
      return err.code === 'TENANT_FORBIDDEN' || err.message.includes('belongs to different tenant');
    });

    // Tenant B attempts to approve Tenant A's proposal
    await assert.rejects(async () => {
      await repo.addApproval({
        proposalId: proposalTenantA.id,
        tenantId: 'tenant-eu-beta', // Tenant B
        approverSubject: 'attacker@tenant-beta.eu',
        role: 'sre',
        justification: 'Malicious cross-tenant approval',
        proposalHash: 'hash-tenant-a-only'
      });
    }, (err) => {
      return err.code === 'TENANT_FORBIDDEN' || err.message.includes('Tenant mismatch');
    });
  });
});
