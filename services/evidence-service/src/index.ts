import { createHash, randomUUID } from 'node:crypto';
import type { EvidenceObject, EvidenceType, EventSource } from '@ai-sre/event-schema';
import { sanitizeTelemetry } from '@ai-sre/security';

export class EvidenceService {
  private evidenceStore: Map<string, EvidenceObject[]> = new Map();

  public addEvidence(incidentId: string, item: Omit<EvidenceObject, 'id' | 'incidentId'>): EvidenceObject {
    const serializedData = JSON.stringify(item.data || {});
    const inputHash = createHash('sha256').update(serializedData).digest('hex');

    const sanitizedSummary = sanitizeTelemetry(item.summary).sanitizedContent;

    const evidence: EvidenceObject = {
      id: randomUUID(),
      incidentId,
      type: item.type,
      source: item.source,
      title: item.title,
      summary: sanitizedSummary,
      confidence: item.confidence,
      isContradictory: item.isContradictory,
      provenance: {
        sourceSystem: item.provenance.sourceSystem,
        queryOrFilter: item.provenance.queryOrFilter,
        extractedAt: item.provenance.extractedAt || new Date().toISOString(),
        untrustedInputHash: inputHash
      },
      data: item.data
    };

    const list = this.evidenceStore.get(incidentId) || [];
    list.push(evidence);
    this.evidenceStore.set(incidentId, list);

    return evidence;
  }

  public getEvidenceForIncident(incidentId: string): EvidenceObject[] {
    return this.evidenceStore.get(incidentId) || [];
  }

  public generateEvidenceBundle(incidentId: string): {
    incidentId: string;
    totalCount: number;
    supportingCount: number;
    contradictoryCount: number;
    bundleHash: string;
    items: EvidenceObject[];
  } {
    const items = this.getEvidenceForIncident(incidentId);
    const supporting = items.filter((i) => !i.isContradictory);
    const contradictory = items.filter((i) => i.isContradictory);

    const serialized = JSON.stringify(items);
    const bundleHash = createHash('sha256').update(serialized).digest('hex');

    return {
      incidentId,
      totalCount: items.length,
      supportingCount: supporting.length,
      contradictoryCount: contradictory.length,
      bundleHash,
      items
    };
  }
}
