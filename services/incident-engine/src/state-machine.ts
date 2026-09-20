import type { IncidentState } from '@ai-sre/event-schema';

/**
 * Valid transitions according to PRD §19:
 * DETECTED -> TRIAGED -> INVESTIGATING -> DIAGNOSED -> REMEDIATION_PROPOSED -> AWAITING_APPROVAL
 * -> EXECUTING -> VERIFYING -> (RESOLVED | ESCALATED) -> POSTMORTEM
 */
export const ALLOWED_TRANSITIONS: Record<IncidentState, IncidentState[]> = {
  DETECTED: ['TRIAGED', 'INVESTIGATING'],
  TRIAGED: ['INVESTIGATING', 'RESOLVED'],
  INVESTIGATING: ['DIAGNOSED', 'ESCALATED', 'RESOLVED'],
  DIAGNOSED: ['REMEDIATION_PROPOSED', 'INVESTIGATING', 'ESCALATED'],
  REMEDIATION_PROPOSED: ['AWAITING_APPROVAL', 'EXECUTING', 'INVESTIGATING'],
  AWAITING_APPROVAL: ['EXECUTING', 'REMEDIATION_PROPOSED', 'ESCALATED'],
  EXECUTING: ['VERIFYING', 'ESCALATED'],
  VERIFYING: ['RESOLVED', 'ESCALATED', 'REMEDIATION_PROPOSED'],
  ESCALATED: ['INVESTIGATING', 'AWAITING_APPROVAL', 'RESOLVED', 'POSTMORTEM'],
  RESOLVED: ['POSTMORTEM', 'INVESTIGATING'],
  POSTMORTEM: []
};

export class IllegalStateTransitionError extends Error {
  constructor(public fromState: IncidentState, public toState: IncidentState, public incidentId: string) {
    super(`Illegal state transition for incident ${incidentId}: cannot transition from '${fromState}' to '${toState}'.`);
    this.name = 'IllegalStateTransitionError';
  }
}

export class IncidentStateMachine {
  public static canTransition(current: IncidentState, target: IncidentState): boolean {
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    return allowed.includes(target);
  }

  public static assertTransition(incidentId: string, current: IncidentState, target: IncidentState): void {
    if (!this.canTransition(current, target)) {
      throw new IllegalStateTransitionError(current, target, incidentId);
    }
  }
}
