/**
 * Prometheus Client — Real PromQL HTTP API Integration
 * 
 * PRD v2.0 §3.4: Real PromQL queries against Prometheus
 * - Connects to in-cluster or port-forwarded Prometheus
 * - Executes instant queries and range queries
 * - Gracefully handles scrape gaps, delayed metrics, and empty series
 */

export interface MetricSample {
  metric: Record<string, string>;
  value: [number, string]; // [timestamp, valueString]
}

export interface MetricRangeSample {
  metric: Record<string, string>;
  values: [number, string][]; // array of [timestamp, valueString]
}

export interface PrometheusQueryResponse {
  status: 'success' | 'error';
  errorType?: string;
  error?: string;
  data?: {
    resultType: 'vector' | 'matrix' | 'scalar' | 'string';
    result: MetricSample[] | MetricRangeSample[];
  };
}

export class PrometheusClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options?: { baseUrl?: string; timeoutMs?: number }) {
    this.baseUrl = (options?.baseUrl || process.env.PROMETHEUS_URL || 'http://localhost:9090').replace(/\/$/, '');
    this.timeoutMs = options?.timeoutMs || 5000;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Execute an instant PromQL query
   */
  public async query(promql: string, time?: number): Promise<MetricSample[]> {
    const params = new URLSearchParams({ query: promql });
    if (time) params.append('time', String(time));

    const url = `${this.baseUrl}/api/v1/query?${params.toString()}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Prometheus HTTP ${res.status}: ${res.statusText}`);
      }

      const json: PrometheusQueryResponse = await res.json();
      if (json.status !== 'success' || !json.data) {
        throw new Error(`Prometheus query error: ${json.error || 'Unknown error'}`);
      }

      return (json.data.result || []) as MetricSample[];
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Prometheus query timed out after ${this.timeoutMs}ms: ${promql}`);
      }
      throw err;
    }
  }

  /**
   * Execute a range PromQL query
   */
  public async queryRange(promql: string, start: number, end: number, step = '15s'): Promise<MetricRangeSample[]> {
    const params = new URLSearchParams({
      query: promql,
      start: String(start),
      end: String(end),
      step
    });

    const url = `${this.baseUrl}/api/v1/query_range?${params.toString()}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`Prometheus HTTP ${res.status}: ${res.statusText}`);
      }

      const json: PrometheusQueryResponse = await res.json();
      if (json.status !== 'success' || !json.data) {
        throw new Error(`Prometheus query_range error: ${json.error || 'Unknown error'}`);
      }

      return (json.data.result || []) as MetricRangeSample[];
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Prometheus query_range timed out after ${this.timeoutMs}ms: ${promql}`);
      }
      throw err;
    }
  }

  /**
   * Check if Prometheus is reachable and healthy
   */
  public async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/-/healthy`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
