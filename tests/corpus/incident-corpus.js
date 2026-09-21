/**
 * Incident Corpus — 12 scenarios for RCA calibration
 * 
 * PRD v2.0 §3.1: 10-15 curated incident scenarios to run RCA accuracy
 * and confidence-calibration checks against.
 * 
 * Each scenario has:
 * - id: unique identifier
 * - title: incident title
 * - service: affected service
 * - severity: SEV level
 * - evidence: array of evidence objects (same structure as real evidence)
 * - expectedRootCause: human-judged correct root cause (ground truth)
 * - expectedAction: expected remediation action
 */

export const incidentCorpus = [
  // 1. Golden Incident — Memory leak OOMKill (canonical)
  {
    id: 'corpus-001',
    title: 'checkout-api OOMKilled after v1.1.0 deployment',
    service: 'checkout-api',
    severity: 'SEV-1',
    expectedRootCause: 'memory_leak_deployment',
    expectedAction: 'rollback_deployment',
    evidence: [
      { id: 'c1-ev1', type: 'K8S_EVENT', source: 'kubernetes', title: 'Pod OOMKilled', summary: 'Container checkout-api exceeded 512Mi memory limit, exit code 137. 4 restarts in 10 min.', confidence: 96, isContradictory: false },
      { id: 'c1-ev2', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'HTTP 5xx Spike', summary: 'HTTP 500 error rate spiked to 6.8% (baseline < 0.05%).', confidence: 98, isContradictory: false },
      { id: 'c1-ev3', type: 'DEPLOYMENT_CHANGE', source: 'github', title: 'Deployment v1.1.0', summary: 'checkout-api deployed v1.1.0 (sha: e7a4b12) 8 min before first OOM.', confidence: 99, isContradictory: false },
      { id: 'c1-ev4', type: 'BASELINE_DEVIATION', source: 'prometheus', title: 'Memory growth', summary: 'Pod memory grew linearly from 180Mi to 512Mi in 7 minutes.', confidence: 94, isContradictory: false },
      { id: 'c1-ev5', type: 'DATABASE_METRICS', source: 'azure', title: 'DB healthy', summary: 'PostgreSQL shows steady 12ms query latency.', confidence: 85, isContradictory: true }
    ]
  },

  // 2. CPU saturation from tight loop
  {
    id: 'corpus-002',
    title: 'payment-processor CPU throttled causing timeouts',
    service: 'payment-processor',
    severity: 'SEV-1',
    expectedRootCause: 'cpu_saturation_code_regression',
    expectedAction: 'rollback_deployment',
    evidence: [
      { id: 'c2-ev1', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'CPU 100%', summary: 'Container CPU usage at 100% limit (throttled) for 15 min. CPU limit: 500m.', confidence: 97, isContradictory: false },
      { id: 'c2-ev2', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'p99 latency spike', summary: 'p99 latency spiked from 120ms to 8200ms.', confidence: 95, isContradictory: false },
      { id: 'c2-ev3', type: 'DEPLOYMENT_CHANGE', source: 'github', title: 'Deploy v3.2.1', summary: 'payment-processor v3.2.1 deployed 20min ago. Diff includes new retry logic in payment validation.', confidence: 92, isContradictory: false },
      { id: 'c2-ev4', type: 'K8S_EVENT', source: 'kubernetes', title: 'Pods running', summary: 'All 3 pods Running, 0 restarts, no OOM. Resource requests met.', confidence: 80, isContradictory: true }
    ]
  },

  // 3. Network partition — DNS resolution failure
  {
    id: 'corpus-003',
    title: 'order-service unable to reach downstream inventory-api',
    service: 'order-service',
    severity: 'SEV-2',
    expectedRootCause: 'dns_resolution_failure',
    expectedAction: 'restart_pod',
    evidence: [
      { id: 'c3-ev1', type: 'K8S_EVENT', source: 'kubernetes', title: 'DNS lookup timeout', summary: 'CoreDNS returning SERVFAIL for inventory-api.payments.svc.cluster.local.', confidence: 95, isContradictory: false },
      { id: 'c3-ev2', type: 'METRIC_ANOMALY', source: 'prometheus', title: '5xx from order-service', summary: 'order-service returning 503 on /api/orders at 12% rate.', confidence: 90, isContradictory: false },
      { id: 'c3-ev3', type: 'K8S_EVENT', source: 'kubernetes', title: 'CoreDNS pod restart', summary: 'CoreDNS pod restarted 2 min ago due to liveness probe failure.', confidence: 88, isContradictory: false },
      { id: 'c3-ev4', type: 'DEPLOYMENT_CHANGE', source: 'github', title: 'No recent deploy', summary: 'No deployments in last 24 hours for order-service or inventory-api.', confidence: 85, isContradictory: true }
    ]
  },

  // 4. Config drift — wrong environment variable
  {
    id: 'corpus-004',
    title: 'user-service returning 500 on all authentication requests',
    service: 'user-service',
    severity: 'SEV-1',
    expectedRootCause: 'config_drift_env_var',
    expectedAction: 'apply_config_patch',
    evidence: [
      { id: 'c4-ev1', type: 'METRIC_ANOMALY', source: 'prometheus', title: '100% error rate', summary: 'All requests to /api/auth returning 500 since ConfigMap update.', confidence: 99, isContradictory: false },
      { id: 'c4-ev2', type: 'K8S_EVENT', source: 'kubernetes', title: 'ConfigMap changed', summary: 'ConfigMap user-service-config updated 12 min ago. AUTH_PROVIDER_URL changed.', confidence: 97, isContradictory: false },
      { id: 'c4-ev3', type: 'K8S_EVENT', source: 'kubernetes', title: 'Pods healthy', summary: 'Pods running, no restarts, memory/CPU normal.', confidence: 80, isContradictory: true },
      { id: 'c4-ev4', type: 'LOG_PATTERN', source: 'kubernetes', title: 'Connection refused', summary: 'Logs show repeated "ECONNREFUSED 10.0.3.99:443" — AUTH_PROVIDER_URL points to wrong IP.', confidence: 96, isContradictory: false }
    ]
  },

  // 5. Dependency failure — downstream timeout
  {
    id: 'corpus-005',
    title: 'checkout-api latency spike caused by inventory-api slowdown',
    service: 'checkout-api',
    severity: 'SEV-2',
    expectedRootCause: 'dependency_timeout',
    expectedAction: 'no_action',
    evidence: [
      { id: 'c5-ev1', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'Latency spike', summary: 'checkout-api p95 latency jumped from 200ms to 4500ms.', confidence: 94, isContradictory: false },
      { id: 'c5-ev2', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'Downstream slow', summary: 'inventory-api p99 latency at 3800ms (baseline 50ms).', confidence: 96, isContradictory: false },
      { id: 'c5-ev3', type: 'K8S_EVENT', source: 'kubernetes', title: 'checkout-api healthy', summary: 'checkout-api pods healthy, 0 restarts, CPU/memory normal.', confidence: 85, isContradictory: true },
      { id: 'c5-ev4', type: 'DATABASE_METRICS', source: 'azure', title: 'DB connection pool exhausted', summary: 'inventory-api Postgres pool at 100% utilization (50/50 connections).', confidence: 93, isContradictory: false }
    ]
  },

  // 6. Disk pressure / PVC exhaustion
  {
    id: 'corpus-006',
    title: 'logging-service pods evicted due to disk pressure',
    service: 'logging-service',
    severity: 'SEV-2',
    expectedRootCause: 'disk_pressure_pvc',
    expectedAction: 'scale_workload',
    evidence: [
      { id: 'c6-ev1', type: 'K8S_EVENT', source: 'kubernetes', title: 'DiskPressure', summary: 'Node condition DiskPressure=True. Node disk at 94% utilization.', confidence: 97, isContradictory: false },
      { id: 'c6-ev2', type: 'K8S_EVENT', source: 'kubernetes', title: 'Pod evicted', summary: 'logging-service-abc123 evicted: "The node had condition: [DiskPressure]".', confidence: 96, isContradictory: false },
      { id: 'c6-ev3', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'PVC full', summary: 'PVC logging-data at 98% capacity (47.5Gi / 50Gi).', confidence: 95, isContradictory: false },
      { id: 'c6-ev4', type: 'DEPLOYMENT_CHANGE', source: 'github', title: 'No deploys', summary: 'No code changes in 48 hours.', confidence: 70, isContradictory: true }
    ]
  },

  // 7. CrashLoopBackOff from bad image tag
  {
    id: 'corpus-007',
    title: 'notification-service CrashLoopBackOff after image update',
    service: 'notification-service',
    severity: 'SEV-2',
    expectedRootCause: 'bad_image_tag',
    expectedAction: 'rollback_deployment',
    evidence: [
      { id: 'c7-ev1', type: 'K8S_EVENT', source: 'kubernetes', title: 'CrashLoopBackOff', summary: 'Container crashing immediately on start. Back-off 5m0s restarting. 12 restarts.', confidence: 98, isContradictory: false },
      { id: 'c7-ev2', type: 'K8S_EVENT', source: 'kubernetes', title: 'Exit code 1', summary: 'Container exited with code 1. Logs: "Error: Cannot find module /app/dist/server.js".', confidence: 97, isContradictory: false },
      { id: 'c7-ev3', type: 'DEPLOYMENT_CHANGE', source: 'github', title: 'Image tag changed', summary: 'Deployment updated image from notification-service:v2.3.0 to notification-service:v2.4.0-beta. Tag v2.4.0-beta was built from wrong branch.', confidence: 95, isContradictory: false },
      { id: 'c7-ev4', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'No metrics', summary: 'No metrics scraped from notification-service — target down.', confidence: 85, isContradictory: false }
    ]
  },

  // 8. Slow query / connection pool exhaustion
  {
    id: 'corpus-008',
    title: 'product-catalog-api slow responses due to unindexed query',
    service: 'product-catalog-api',
    severity: 'SEV-2',
    expectedRootCause: 'slow_query_missing_index',
    expectedAction: 'no_action',
    evidence: [
      { id: 'c8-ev1', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'p99 spike', summary: 'product-catalog-api p99 latency: 12,000ms (baseline: 80ms).', confidence: 96, isContradictory: false },
      { id: 'c8-ev2', type: 'DATABASE_METRICS', source: 'azure', title: 'Slow queries', summary: 'Azure DB insights: query "SELECT * FROM products WHERE category LIKE ..." averaging 9.2s, no index on category column.', confidence: 98, isContradictory: false },
      { id: 'c8-ev3', type: 'DEPLOYMENT_CHANGE', source: 'github', title: 'New search feature', summary: 'v4.1.0 deployed 2 hours ago with new product search endpoint using LIKE queries.', confidence: 93, isContradictory: false },
      { id: 'c8-ev4', type: 'K8S_EVENT', source: 'kubernetes', title: 'Pods healthy', summary: 'All pods running, CPU at 30%, memory at 40%.', confidence: 75, isContradictory: true }
    ]
  },

  // 9. Certificate expiry
  {
    id: 'corpus-009',
    title: 'api-gateway TLS handshake failures after cert expiry',
    service: 'api-gateway',
    severity: 'SEV-1',
    expectedRootCause: 'certificate_expired',
    expectedAction: 'rotate_certificate',
    evidence: [
      { id: 'c9-ev1', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'TLS errors', summary: '100% of incoming HTTPS connections failing with ERR_CERT_DATE_INVALID.', confidence: 99, isContradictory: false },
      { id: 'c9-ev2', type: 'K8S_EVENT', source: 'kubernetes', title: 'Cert expired', summary: 'TLS Secret api-gateway-tls: certificate expired 2 hours ago (notAfter: 2026-09-20T22:00:00Z).', confidence: 99, isContradictory: false },
      { id: 'c9-ev3', type: 'K8S_EVENT', source: 'kubernetes', title: 'Pods healthy', summary: 'api-gateway pods running, healthy, no restarts.', confidence: 80, isContradictory: true },
      { id: 'c9-ev4', type: 'LOG_PATTERN', source: 'kubernetes', title: 'cert-manager logs', summary: 'cert-manager: "Failed to renew certificate: ACME challenge failed, DNS propagation timeout."', confidence: 94, isContradictory: false }
    ]
  },

  // 10. Rate limiting cascade
  {
    id: 'corpus-010',
    title: 'payment-gateway hitting third-party rate limits causing failures',
    service: 'payment-gateway',
    severity: 'SEV-1',
    expectedRootCause: 'rate_limiting_third_party',
    expectedAction: 'scale_workload',
    evidence: [
      { id: 'c10-ev1', type: 'METRIC_ANOMALY', source: 'prometheus', title: '429 responses', summary: 'payment-gateway receiving 429 Too Many Requests from Stripe API at 40% rate.', confidence: 97, isContradictory: false },
      { id: 'c10-ev2', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'Error rate', summary: 'payment-gateway returning 502 to callers at 35% rate.', confidence: 94, isContradictory: false },
      { id: 'c10-ev3', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'Request volume', summary: 'Inbound request rate 3x normal — flash sale event started 30 min ago.', confidence: 92, isContradictory: false },
      { id: 'c10-ev4', type: 'K8S_EVENT', source: 'kubernetes', title: 'Pods autoscaled', summary: 'HPA scaled payment-gateway from 3 to 10 replicas. All pods healthy.', confidence: 80, isContradictory: true }
    ]
  },

  // 11. Memory leak without deployment (long-running)
  {
    id: 'corpus-011',
    title: 'session-service slow memory leak over 72 hours',
    service: 'session-service',
    severity: 'SEV-3',
    expectedRootCause: 'memory_leak_longrunning',
    expectedAction: 'restart_pod',
    evidence: [
      { id: 'c11-ev1', type: 'BASELINE_DEVIATION', source: 'prometheus', title: 'Gradual memory rise', summary: 'session-service memory grew from 200Mi to 480Mi over 72 hours (linear slope).', confidence: 88, isContradictory: false },
      { id: 'c11-ev2', type: 'K8S_EVENT', source: 'kubernetes', title: 'No restarts yet', summary: 'Pod running for 72 hours, 0 restarts, approaching 512Mi limit.', confidence: 82, isContradictory: false },
      { id: 'c11-ev3', type: 'DEPLOYMENT_CHANGE', source: 'github', title: 'No deploys', summary: 'No deployments in last 5 days.', confidence: 70, isContradictory: true },
      { id: 'c11-ev4', type: 'LOG_PATTERN', source: 'kubernetes', title: 'Session cache growing', summary: 'Logs show session cache entries growing monotonically — no TTL eviction.', confidence: 90, isContradictory: false }
    ]
  },

  // 12. Node failure / taint
  {
    id: 'corpus-012',
    title: 'Multiple service disruption from node NotReady',
    service: 'multiple',
    severity: 'SEV-1',
    expectedRootCause: 'node_failure',
    expectedAction: 'cordon_node',
    evidence: [
      { id: 'c12-ev1', type: 'K8S_EVENT', source: 'kubernetes', title: 'Node NotReady', summary: 'Node aks-systempool-12345 transitioned to NotReady. Kubelet stopped posting status.', confidence: 99, isContradictory: false },
      { id: 'c12-ev2', type: 'K8S_EVENT', source: 'kubernetes', title: 'Pods rescheduling', summary: '8 pods evicted from failed node, 6 rescheduled successfully, 2 pending (insufficient resources).', confidence: 95, isContradictory: false },
      { id: 'c12-ev3', type: 'METRIC_ANOMALY', source: 'prometheus', title: 'Multi-service 5xx', summary: 'Transient 5xx spike across checkout-api, order-service, user-service during pod migration.', confidence: 88, isContradictory: false },
      { id: 'c12-ev4', type: 'BASELINE_DEVIATION', source: 'azure', title: 'VM health', summary: 'Azure platform reports VM host degraded — hardware event detected.', confidence: 93, isContradictory: false }
    ]
  }
];
