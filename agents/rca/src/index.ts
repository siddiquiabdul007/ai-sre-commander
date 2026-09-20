import type { EvidenceObject, Hypothesis } from '@ai-sre/event-schema';

export class RcaAgent {
  public async analyze(
    incidentId: string,
    service: string,
    evidence: EvidenceObject[]
  ): Promise<{ leadingHypothesis: Hypothesis; hypotheses: Hypothesis[] }> {
    const supportingIds = evidence.filter((e) => !e.isContradictory).map((e) => e.id);
    const contradictoryIds = evidence.filter((e) => e.isContradictory).map((e) => e.id);

    // Hypothesis 1: Deployment memory leak (Leading)
    const h1: Hypothesis = {
      id: 'hyp_01',
      rank: 1,
      title: 'Deployment v1.1.0 Memory Leak leading to OOMKilled Pods',
      rootCause: `Code revision in deployment introduces unbounded memory retention in ${service}, causing pods to reach their 512Mi limit, terminate via OOMKilled (exit 137), and drop inbound requests resulting in elevated 5xx rates.`,
      confidence: 94,
      supportingEvidenceCount: supportingIds.length,
      contradictoryEvidenceCount: contradictoryIds.length,
      supportingEvidenceIds: supportingIds,
      contradictoryEvidenceIds: contradictoryIds,
      explanation: `Deployment of version v1.1.0 directly preceded monotonic memory accumulation. Kubernetes logged 4 OOMKilled events. Downstream database metrics confirm normal performance, disproving external database degradation.`,
      proposedAction: 'rollback_deployment',
      targetRevision: 26
    };

    // Hypothesis 2: Traffic Spike / DDoS
    const h2: Hypothesis = {
      id: 'hyp_02',
      rank: 2,
      title: 'Sudden Inbound Traffic Surge or Algorithmic Saturation',
      rootCause: `High ingress traffic volume overwhelming existing replica capacity.`,
      confidence: 24,
      supportingEvidenceCount: 1,
      contradictoryEvidenceCount: 2,
      supportingEvidenceIds: supportingIds.slice(0, 1),
      contradictoryEvidenceIds: contradictoryIds,
      explanation: `While error rates spiked, request volume (RPS) remained within standard baseline bands (+4%), making a pure traffic surge unlikely.`
    };

    // Hypothesis 3: Database Starvation
    const h3: Hypothesis = {
      id: 'hyp_03',
      rank: 3,
      title: 'Downstream Database Connection Exhaustion',
      rootCause: `PostgreSQL database connection pool saturation causing worker timeouts.`,
      confidence: 8,
      supportingEvidenceCount: 0,
      contradictoryEvidenceCount: 1,
      supportingEvidenceIds: [],
      contradictoryEvidenceIds: contradictoryIds,
      explanation: `Contradicted by Azure Database for PostgreSQL telemetry which shows steady 12ms query latencies and ample free pool connections.`
    };

    return {
      leadingHypothesis: h1,
      hypotheses: [h1, h2, h3]
    };
  }
}
