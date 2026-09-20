import { randomUUID } from 'node:crypto';
import type { NormalizedEvent, EventSource, EventSeverity } from '@ai-sre/event-schema';
import { redactObject } from '@ai-sre/security';

export class EventNormalizer {
  /**
   * Normalizes Prometheus / Alertmanager alerts
   */
  public static normalizePrometheus(alertPayload: any): NormalizedEvent {
    const alert = alertPayload.alerts?.[0] || alertPayload;
    const labels = alert.labels || {};
    const annotations = alert.annotations || {};

    let severity: EventSeverity = 'WARNING';
    if (labels.severity === 'critical' || labels.severity === 'CRITICAL') {
      severity = 'CRITICAL';
    } else if (labels.severity === 'error') {
      severity = 'ERROR';
    }

    return {
      id: randomUUID(),
      source: 'prometheus',
      eventType: `alert.${labels.alertname || 'generic_alert'}`,
      severity,
      timestamp: alert.startsAt ? new Date(alert.startsAt).toISOString() : new Date().toISOString(),
      environment: labels.environment || 'production',
      service: labels.service || labels.app || labels.job || 'checkout-api',
      cluster: labels.cluster || 'aks-primary-eu',
      namespace: labels.namespace || 'payments',
      entityId: labels.pod || labels.instance,
      title: annotations.summary || labels.alertname || 'Prometheus Metric Alert',
      description: annotations.description || 'Prometheus metric threshold exceeded',
      payload: redactObject(alertPayload),
      labels,
      metadata: {
        generatorURL: alert.generatorURL,
        status: alert.status
      }
    };
  }

  /**
   * Normalizes Kubernetes Events (Pod OOMKilled, CrashLoopBackoff, NodeNotReady)
   */
  public static normalizeKubernetes(k8sPayload: any): NormalizedEvent {
    const reason = k8sPayload.reason || k8sPayload.type || 'PodStatusChange';
    const involved = k8sPayload.involvedObject || {};
    const isError = ['OOMKilled', 'Failed', 'CrashLoopBackOff', 'BackOff'].includes(reason);

    return {
      id: randomUUID(),
      source: 'kubernetes',
      eventType: `kubernetes.event.${reason.toLowerCase()}`,
      severity: isError ? 'ERROR' : 'INFO',
      timestamp: k8sPayload.firstTimestamp ? new Date(k8sPayload.firstTimestamp).toISOString() : new Date().toISOString(),
      environment: k8sPayload.environment || 'production',
      service: involved.labels?.app || involved.name?.split('-')[0] || 'checkout-api',
      cluster: k8sPayload.cluster || 'aks-primary-eu',
      namespace: involved.namespace || 'payments',
      entityId: involved.name,
      title: `K8s ${involved.kind || 'Pod'} ${reason}: ${involved.name || ''}`,
      description: k8sPayload.message || `Kubernetes cluster emitted event ${reason}`,
      payload: redactObject(k8sPayload),
      labels: involved.labels || {},
      metadata: {
        count: k8sPayload.count || 1,
        kind: involved.kind
      }
    };
  }

  /**
   * Normalizes GitHub events (Deployments, Releases, Commits)
   */
  public static normalizeGitHub(githubPayload: any): NormalizedEvent {
    const isDeployment = !!githubPayload.deployment;
    const ref = githubPayload.ref || githubPayload.deployment?.ref || 'main';
    const sha = githubPayload.after || githubPayload.deployment?.sha || githubPayload.head_commit?.id || 'v1.1.0';
    const repo = githubPayload.repository?.name || 'checkout-api';

    return {
      id: randomUUID(),
      source: 'github',
      eventType: isDeployment ? 'github.deployment.promoted' : 'github.commit.pushed',
      severity: 'INFO',
      timestamp: new Date().toISOString(),
      environment: githubPayload.deployment?.environment || 'production',
      service: repo,
      cluster: 'aks-primary-eu',
      namespace: 'payments',
      entityId: sha,
      title: isDeployment 
        ? `Deployment promoted: ${repo}@${ref} (${sha.substring(0, 7)})` 
        : `Commit pushed to ${ref}: ${githubPayload.head_commit?.message || 'Update'}`,
      description: githubPayload.head_commit?.message || `Deployment triggered for ref ${ref} commit ${sha}`,
      payload: redactObject(githubPayload),
      labels: {
        repo,
        ref,
        sha
      },
      metadata: {
        author: githubPayload.head_commit?.author?.name || githubPayload.sender?.login || 'sre-engineer',
        compareUrl: githubPayload.compare
      }
    };
  }

  /**
   * Normalizes Sentry exceptions
   */
  public static normalizeSentry(sentryPayload: any): NormalizedEvent {
    const event = sentryPayload.event || sentryPayload;
    const tags = event.tags || {};
    const culprit = event.culprit || event.title || 'UnhandledException';

    return {
      id: randomUUID(),
      source: 'sentry',
      eventType: 'sentry.exception',
      severity: 'ERROR',
      timestamp: event.received ? new Date(event.received).toISOString() : new Date().toISOString(),
      environment: event.environment || 'production',
      service: tags.service || event.project || 'checkout-api',
      cluster: tags.cluster || 'aks-primary-eu',
      namespace: tags.namespace || 'payments',
      entityId: event.id,
      title: `Sentry Error: ${culprit}`,
      description: event.message || event.culprit || 'Unhandled application exception detected',
      payload: redactObject(sentryPayload),
      labels: tags,
      metadata: {
        level: event.level,
        culprit: event.culprit
      }
    };
  }

  /**
   * Normalizes Azure Resource Health events
   */
  public static normalizeAzure(azurePayload: any): NormalizedEvent {
    const data = azurePayload.data || azurePayload;
    const resourceId = data.resourceId || '/subscriptions/...';

    return {
      id: randomUUID(),
      source: 'azure',
      eventType: 'azure.resource_health.status_change',
      severity: data.status === 'Unavailable' ? 'CRITICAL' : 'INFO',
      timestamp: new Date().toISOString(),
      environment: 'production',
      service: 'infrastructure',
      cluster: 'aks-primary-eu',
      namespace: 'kube-system',
      entityId: resourceId,
      title: `Azure Resource Health: ${data.resourceName || 'AKS'} is ${data.status || 'Active'}`,
      description: data.description || 'Azure infrastructure status update',
      payload: redactObject(azurePayload),
      labels: {
        region: data.location || 'westeurope'
      },
      metadata: {
        resourceId
      }
    };
  }
}
