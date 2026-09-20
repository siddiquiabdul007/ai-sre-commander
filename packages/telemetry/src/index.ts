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
}
