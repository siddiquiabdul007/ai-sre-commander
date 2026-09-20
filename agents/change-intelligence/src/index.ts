import { randomUUID } from 'node:crypto';
import type { EvidenceObject } from '@ai-sre/event-schema';

export class ChangeIntelligenceAgent {
  public async investigate(incidentId: string, context: {
    service: string;
    targetVersion?: string;
  }): Promise<EvidenceObject[]> {
    const evidenceList: EvidenceObject[] = [];
    const targetVersion = context.targetVersion || 'v1.1.0';

    // 1. Supporting: Recent Production Deployment
    evidenceList.push({
      id: randomUUID(),
      incidentId,
      type: 'DEPLOYMENT_DIFF',
      source: 'github',
      title: `Deployment promoted: ${context.service}@${targetVersion}`,
      summary: `Revision 27 deployed version ${targetVersion} containing payment buffer caching logic 12 minutes prior to first error spike.`,
      confidence: 95,
      isContradictory: false,
      provenance: {
        sourceSystem: 'github-actions/deploy-prod',
        queryOrFilter: `repos/org/${context.service}/deployments`,
        extractedAt: new Date().toISOString(),
        untrustedInputHash: 'gh_dep_hash_987'
      },
      data: {
        version: targetVersion,
        revision: 27,
        previousVersion: 'v1.0.0',
        previousRevision: 26,
        author: 'sre-engineer@enterprise.eu',
        commitMessage: 'feat(payments): add in-memory order buffer caching layer'
      }
    });

    // 2. Supporting: Code commit diff introduces unbounded array
    evidenceList.push({
      id: randomUUID(),
      incidentId,
      type: 'GIT_COMMIT',
      source: 'github',
      title: 'Commit diff shows unbounded static Map growth',
      summary: `PR #142 introduced static cache 'orderHistoryMap' with no eviction policy or TTL, directly correlating with memory leak symptoms.`,
      confidence: 93,
      isContradictory: false,
      provenance: {
        sourceSystem: 'github-api',
        queryOrFilter: `repos/org/${context.service}/commits/diff`,
        extractedAt: new Date().toISOString(),
        untrustedInputHash: 'git_commit_hash_654'
      },
      data: {
        prNumber: 142,
        filesChanged: ['src/services/payment-buffer.ts'],
        additions: 48,
        deletions: 4
      }
    });

    // 3. Contradictory Evidence (PRD §7: inspectable contradictory evidence)
    // External dependency health: Postgres database latency stayed completely flat (12ms)
    evidenceList.push({
      id: randomUUID(),
      incidentId,
      type: 'BASELINE_DEVIATION',
      source: 'azure',
      title: 'Downstream Database Latency Unchanged (12ms)',
      summary: `Azure Database for PostgreSQL Flexible Server response time remains healthy at 12ms with 0 errors, contradicting hypotheses of database connection pool exhaustion.`,
      confidence: 99,
      isContradictory: true,
      provenance: {
        sourceSystem: 'azure-monitor-postgresql',
        queryOrFilter: `AzureMetrics | where Resource == "psql-commander-prod"`,
        extractedAt: new Date().toISOString(),
        untrustedInputHash: 'az_metrics_hash_321'
      },
      data: {
        avgLatencyMs: 12,
        activeConnections: 18,
        maxConnections: 100,
        status: 'HEALTHY'
      }
    });

    return evidenceList;
  }
}
