/**
 * Platform & AI Telemetry
 * Implements PRD §17 Observability of the Platform:
 * - Golden Signals (Latency, Traffic, Errors, Saturation)
 * - AI-Specific Telemetry (Model latency, Tokens, Cost, Retries, Confidence, Rejection rate)
 */

export interface GoldenSignals {
  latencyP95Ms: number;
  latencyP99Ms: number;
  requestsPerSecond: number;
  errorRatePercent: number;
  cpuSaturationPercent: number;
  memorySaturationPercent: number;
}

export interface AITelemetryMetrics {
  totalInvocations: number;
  totalTokensUsed: number;
  estimatedCostUsd: number;
  avgModelLatencyMs: number;
  toolCallsCount: number;
  agentRetriesCount: number;
  invalidOutputsCount: number;
  humanOverrideCount: number;
  remediationsExecuted: number;
  remediationsSucceeded: number;
}

export class TelemetryCollector {
  private static instance: TelemetryCollector;
  private metrics: AITelemetryMetrics = {
    totalInvocations: 0,
    totalTokensUsed: 0,
    estimatedCostUsd: 0,
    avgModelLatencyMs: 0,
    toolCallsCount: 0,
    agentRetriesCount: 0,
    invalidOutputsCount: 0,
    humanOverrideCount: 0,
    remediationsExecuted: 0,
    remediationsSucceeded: 0
  };

  public static getInstance(): TelemetryCollector {
    if (!TelemetryCollector.instance) {
      TelemetryCollector.instance = new TelemetryCollector();
    }
    return TelemetryCollector.instance;
  }

  public recordModelInvocation(tokens: number, latencyMs: number, costUsd: number) {
    this.metrics.totalInvocations++;
    this.metrics.totalTokensUsed += tokens;
    this.metrics.estimatedCostUsd += costUsd;
    this.metrics.avgModelLatencyMs = 
      (this.metrics.avgModelLatencyMs * (this.metrics.totalInvocations - 1) + latencyMs) / this.metrics.totalInvocations;
  }

  public recordToolCall() {
    this.metrics.toolCallsCount++;
  }

  public recordRetry() {
    this.metrics.agentRetriesCount++;
  }

  public recordInvalidOutput() {
    this.metrics.invalidOutputsCount++;
  }

  public recordHumanDecision(approved: boolean, overridden: boolean) {
    if (overridden) {
      this.metrics.humanOverrideCount++;
    }
  }

  public recordRemediationExecution(succeeded: boolean) {
    this.metrics.remediationsExecuted++;
    if (succeeded) {
      this.metrics.remediationsSucceeded++;
    }
  }

  public getAIMetrics(): AITelemetryMetrics {
    return { ...this.metrics };
  }

  public toPrometheusText(): string {
    return [
      '# HELP ai_sre_llm_invocations_total Total LLM invocations',
      '# TYPE ai_sre_llm_invocations_total counter',
      `ai_sre_llm_invocations_total ${this.metrics.totalInvocations}`,
      '# HELP ai_sre_llm_tokens_total Total tokens used by LLM Gateway',
      '# TYPE ai_sre_llm_tokens_total counter',
      `ai_sre_llm_tokens_total ${this.metrics.totalTokensUsed}`,
      '# HELP ai_sre_llm_cost_usd_total Estimated LLM cost in USD',
      '# TYPE ai_sre_llm_cost_usd_total counter',
      `ai_sre_llm_cost_usd_total ${this.metrics.estimatedCostUsd.toFixed(6)}`,
      '# HELP ai_sre_llm_latency_ms Average LLM invocation latency in ms',
      '# TYPE ai_sre_llm_latency_ms gauge',
      `ai_sre_llm_latency_ms ${this.metrics.avgModelLatencyMs.toFixed(2)}`,
      '# HELP ai_sre_tool_calls_total Total tool calls made by agents',
      '# TYPE ai_sre_tool_calls_total counter',
      `ai_sre_tool_calls_total ${this.metrics.toolCallsCount}`,
      '# HELP ai_sre_agent_retries_total Total agent retries',
      '# TYPE ai_sre_agent_retries_total counter',
      `ai_sre_agent_retries_total ${this.metrics.agentRetriesCount}`,
      '# HELP ai_sre_invalid_outputs_total Total invalid outputs from LLM',
      '# TYPE ai_sre_invalid_outputs_total counter',
      `ai_sre_invalid_outputs_total ${this.metrics.invalidOutputsCount}`,
      '# HELP ai_sre_human_overrides_total Total operator overrides of AI decisions',
      '# TYPE ai_sre_human_overrides_total counter',
      `ai_sre_human_overrides_total ${this.metrics.humanOverrideCount}`,
      '# HELP ai_sre_remediations_executed_total Total remediations executed',
      '# TYPE ai_sre_remediations_executed_total counter',
      `ai_sre_remediations_executed_total ${this.metrics.remediationsExecuted}`,
      '# HELP ai_sre_remediations_succeeded_total Total remediations succeeded',
      '# TYPE ai_sre_remediations_succeeded_total counter',
      `ai_sre_remediations_succeeded_total ${this.metrics.remediationsSucceeded}`
    ].join('\n') + '\n';
  }
}
