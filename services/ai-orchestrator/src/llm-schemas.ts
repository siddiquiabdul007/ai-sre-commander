/**
 * LLM Structured Output Schemas
 * Defines Zod schemas for each AI task type's expected response format.
 * These are used both for runtime validation and for passing JSON schema
 * to Gemini's responseSchema parameter.
 * 
 * PRD v2.0 §3.1: Structured-output enforcement on every response.
 */

import { z } from 'zod';

// --- Classification ---
export const ClassificationResultSchema = z.object({
  severity: z.enum(['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4']),
  category: z.enum([
    'memory_leak',
    'cpu_saturation',
    'network_failure',
    'disk_pressure',
    'config_drift',
    'dependency_failure',
    'deployment_regression',
    'certificate_expiry',
    'rate_limiting',
    'crash_loop',
    'unknown'
  ]),
  confidence: z.number().min(0).max(100),
  summary: z.string().min(10).max(500)
});
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

// --- RCA Hypothesis ---
export const HypothesisSchema = z.object({
  rank: z.number().int().min(1),
  title: z.string().min(5).max(200),
  rootCause: z.string().min(20).max(1000),
  confidence: z.number().min(0).max(100),
  supportingEvidenceIds: z.array(z.string()),
  contradictoryEvidenceIds: z.array(z.string()),
  explanation: z.string().min(20).max(2000),
  proposedAction: z.string().optional(),
  targetRevision: z.number().optional()
});

export const RcaResultSchema = z.object({
  hypotheses: z.array(HypothesisSchema).min(1).max(5),
  reasoning: z.string().min(20).max(3000),
  overallConfidence: z.number().min(0).max(100)
});
export type RcaResult = z.infer<typeof RcaResultSchema>;

// --- Remediation Plan ---
export const RemediationPlanSchema = z.object({
  action: z.enum([
    'rollback_deployment',
    'restart_pod',
    'scale_workload',
    'cordon_node',
    'apply_config_patch',
    'rotate_certificate',
    'flush_cache',
    'no_action'
  ]),
  targetResource: z.string(),
  parameters: z.record(z.unknown()),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  blastRadius: z.string(),
  expectedImpact: z.string(),
  estimatedRecoveryMinutes: z.number().min(0).max(120),
  rollbackPlan: z.string()
});
export type RemediationPlan = z.infer<typeof RemediationPlanSchema>;

// --- Log Summarization ---
export const LogSummarySchema = z.object({
  summary: z.string().min(20).max(2000),
  keyPatterns: z.array(z.object({
    pattern: z.string(),
    count: z.number(),
    severity: z.enum(['info', 'warning', 'error', 'critical'])
  })),
  timeRange: z.object({
    start: z.string(),
    end: z.string()
  }),
  anomalies: z.array(z.string())
});
export type LogSummary = z.infer<typeof LogSummarySchema>;

// --- Postmortem ---
export const PostmortemSchema = z.object({
  title: z.string(),
  severity: z.string(),
  duration: z.string(),
  impactSummary: z.string(),
  rootCause: z.string(),
  timeline: z.array(z.object({
    timestamp: z.string(),
    event: z.string()
  })),
  lessonsLearned: z.array(z.string()),
  actionItems: z.array(z.object({
    description: z.string(),
    owner: z.string(),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']),
    dueDate: z.string().optional()
  })),
  preventionMeasures: z.array(z.string())
});
export type Postmortem = z.infer<typeof PostmortemSchema>;

// --- Zod to Gemini JSON Schema converter ---
/**
 * Converts a Zod schema to a simplified JSON Schema object compatible
 * with Gemini's responseSchema parameter.
 */
export function zodToGeminiSchema(schema: z.ZodTypeAny): any {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToGeminiSchema(value as z.ZodTypeAny);
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: 'OBJECT',
      properties,
      required
    };
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: 'ARRAY',
      items: zodToGeminiSchema(schema.element)
    };
  }

  if (schema instanceof z.ZodString) {
    return { type: 'STRING' };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: 'NUMBER' };
  }

  if (schema instanceof z.ZodEnum) {
    return {
      type: 'STRING',
      enum: schema.options
    };
  }

  if (schema instanceof z.ZodOptional) {
    return zodToGeminiSchema(schema.unwrap());
  }

  if (schema instanceof z.ZodRecord) {
    return { type: 'OBJECT' };
  }

  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) {
    return { type: 'STRING' };
  }

  // Fallback
  return { type: 'STRING' };
}
