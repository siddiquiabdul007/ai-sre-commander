import { createHash } from 'node:crypto';

export interface CanonicalPodTemplateOptions {
  excludeBookkeepingAnnotations?: boolean;
}

const BOOKKEEPING_ANNOTATION_PREFIXES = [
  'ai-sre-commander/',
  'kubectl.kubernetes.io/restartedAt'
];

/**
 * Recursively sort object keys for deterministic canonical JSON serialization.
 */
export function canonicalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'object') return val;
  if (Array.isArray(val)) {
    return val.map(canonicalizeValue);
  }
  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const res: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    res[k] = canonicalizeValue(obj[k]);
  }
  return res;
}

/**
 * FR-RB-002 & FR-RB-003: Canonicalize PodTemplateSpec for deterministic hashing.
 * Excludes only documented Kubernetes-generated volatile fields and Commander bookkeeping annotations.
 * Preserves all application containers, sidecars, initContainers, volumes, securityContext, affinity, etc.
 */
export function canonicalizePodTemplateSpec(
  template: any,
  options: CanonicalPodTemplateOptions = { excludeBookkeepingAnnotations: true }
): Record<string, unknown> {
  if (!template) return {};
  const cloned = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;

  if (cloned.metadata && typeof cloned.metadata === 'object') {
    const meta = cloned.metadata as Record<string, unknown>;
    if (meta.annotations && typeof meta.annotations === 'object' && options.excludeBookkeepingAnnotations) {
      const filteredAnnotations: Record<string, string> = {};
      for (const [k, v] of Object.entries(meta.annotations as Record<string, unknown>)) {
        if (!BOOKKEEPING_ANNOTATION_PREFIXES.some(prefix => k.startsWith(prefix))) {
          filteredAnnotations[k] = String(v);
        }
      }
      meta.annotations = filteredAnnotations;
    }
    // Delete volatile metadata fields
    delete meta.creationTimestamp;
    delete meta.generation;
    delete meta.resourceVersion;
    delete meta.uid;
  }

  delete cloned.status;

  return canonicalizeValue(cloned) as Record<string, unknown>;
}

/**
 * Compute SHA-256 hash of canonicalized PodTemplateSpec.
 */
export function hashCanonicalPodTemplate(
  template: any,
  options?: CanonicalPodTemplateOptions
): string {
  const canonical = canonicalizePodTemplateSpec(template, options);
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json).digest('hex');
}

