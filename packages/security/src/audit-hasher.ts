import { createHash } from 'node:crypto';

export interface AuditRecordPayload {
  timestamp: string;
  tenant: string;
  actor: string;
  action: string;
  target: string;
  requestId: string;
  incidentId?: string;
  policyDecision?: any;
  approvalId?: string;
  modelMetadata?: any;
  executionResult?: any;
}

export class AuditHasher {
  public static GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  /**
   * Computes deterministic SHA-256 hash of an audit event linked to previous hash
   */
  public static computeEventHash(previousHash: string, payload: AuditRecordPayload): string {
    const serialized = JSON.stringify({
      previousHash,
      timestamp: payload.timestamp,
      tenant: payload.tenant,
      actor: payload.actor,
      action: payload.action,
      target: payload.target,
      requestId: payload.requestId,
      incidentId: payload.incidentId || '',
      policyDecision: payload.policyDecision || null,
      approvalId: payload.approvalId || '',
      modelMetadata: payload.modelMetadata || null,
      executionResult: payload.executionResult || null
    });

    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Validates integrity of a chain of audit records
   */
  public static verifyChain(records: Array<{ previousHash: string; currentHash: string; payload: AuditRecordPayload }>): boolean {
    let expectedPrevious = AuditHasher.GENESIS_HASH;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (record.previousHash !== expectedPrevious) {
        return false;
      }
      const calculatedHash = AuditHasher.computeEventHash(record.previousHash, record.payload);
      if (calculatedHash !== record.currentHash) {
        return false;
      }
      expectedPrevious = record.currentHash;
    }

    return true;
  }
}
