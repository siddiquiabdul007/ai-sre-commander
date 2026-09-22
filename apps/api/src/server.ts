import 'dotenv/config';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { OIDCValidator, type AuthUser } from '@ai-sre/auth';
import { PrismaIncidentRepository, getPrismaClient } from '@ai-sre/database';
import { CorrelationEngine } from '@ai-sre/correlation-engine';
import { EventNormalizer } from '@ai-sre/event-ingestion';
import { AIOrchestrator } from '@ai-sre/ai-orchestrator';
import { EvidenceService } from '@ai-sre/evidence-service';
import { RemediationEngine } from '@ai-sre/remediation-engine';
import { PolicyEngine } from '@ai-sre/policy-engine';
import { ExecutionService } from '@ai-sre/execution-service';
import { VerificationService } from '@ai-sre/verification-service';
import { ComplianceService } from '@ai-sre/compliance-service';
import { NotificationService } from '@ai-sre/notification-service';
import { TelemetryCollector } from '@ai-sre/telemetry';

// ── Zod Schemas for Input Validation (PRD v4.0 §B.3) ──────────────────────
const CreateIncidentSchema = z.object({
  title: z.string().min(1).max(500),
  service: z.string().min(1).max(100),
  severity: z.enum(['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4']).default('SEV-2'),
  environment: z.enum(['production', 'staging', 'development']).default('production')
});

const CreateRemediationSchema = z.object({
  action: z.enum([
    'rollback_deployment', 'restart_pod', 'scale_workload',
    'cordon_node', 'traffic_drain', 'feature_flag_disable'
  ]).default('rollback_deployment'),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('HIGH'),
  targetResource: z.string().min(1).optional(),
  parameters: z.record(z.any()).optional(),
  expectedImpact: z.string().optional(),
  blastRadius: z.string().optional(),
  reason: z.string().optional()
});

const ApproveRemediationSchema = z.object({
  justification: z.string().min(1, 'Justification is required for audit trail')
});

const RejectRemediationSchema = z.object({
  reason: z.string().min(1, 'Rejection reason is required for audit trail')
});

// Routes that do NOT require Entra ID JWT authentication
const AUTH_EXEMPT_ROUTES = new Set([
  '/health',
  '/metrics',
  '/api/events'  // Webhook ingress — uses HMAC verification instead
]);

export class ApiServer {
  public app: FastifyInstance;
  public repo: PrismaIncidentRepository;
  public correlation: CorrelationEngine;
  public orchestrator: AIOrchestrator;
  public evidenceService: EvidenceService;
  public remediationEngine: RemediationEngine;
  public policyEngine: PolicyEngine;
  public executionService: ExecutionService;
  public verificationService: VerificationService;
  public complianceService: ComplianceService;
  public notificationService: NotificationService;

  constructor(repo?: PrismaIncidentRepository) {
    // PRD v4.0 §B.2: 1MB body size limit
    this.app = Fastify({ logger: false, bodyLimit: 1_048_576 });
    this.repo = repo || new PrismaIncidentRepository(getPrismaClient());
    this.correlation = new CorrelationEngine(this.repo);
    this.orchestrator = new AIOrchestrator(this.repo);
    this.evidenceService = new EvidenceService();
    this.remediationEngine = new RemediationEngine(this.repo);
    this.policyEngine = new PolicyEngine();
    this.executionService = new ExecutionService(this.repo);
    this.verificationService = new VerificationService(this.repo);
    this.complianceService = new ComplianceService(this.repo);
    this.notificationService = new NotificationService();
  }

  private async getUser(req: FastifyRequest): Promise<AuthUser> {
    // Use pre-validated user from onRequest hook if available
    if ((req as any).user) return (req as any).user;
    const authHeader = req.headers.authorization;
    return OIDCValidator.validateTokenLive(authHeader);
  }

  /**
   * Verify HMAC-SHA256 signature on webhook payloads (PRD v4.0 §B.1)
   * Supports X-Hub-Signature-256 (GitHub) format: sha256=<hex>
   */
  private verifyWebhookSignature(req: FastifyRequest): void {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      // If no webhook secret configured, log warning but allow (for initial setup)
      console.warn('[ApiServer] WEBHOOK_SECRET not set — webhook signature verification disabled.');
      return;
    }

    const signature = req.headers['x-hub-signature-256'] as string;
    if (!signature) {
      throw new Error('Missing X-Hub-Signature-256 header. Unsigned webhooks are rejected.');
    }

    const body = JSON.stringify(req.body);
    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw new Error('Invalid webhook signature. Payload rejected.');
    }
  }

  /**
   * Startup Health Gate: verifies all required live dependencies before
   * allowing the API server to listen on port.
   * PRD v3.0 §2.4: Refuses to boot in degraded/simulated state.
   */
  public async verifyDependenciesAtBoot(): Promise<void> {
    console.log('[Startup Health Gate] Verifying live external dependencies...');

    // 1. PostgreSQL Flexible Server
    const dbHealthy = await this.repo.ping();
    if (!dbHealthy) {
      throw new Error('[Startup Health Gate] FATAL: Azure PostgreSQL Flexible Server is unreachable.');
    }
    console.log('✓ PostgreSQL connected (SELECT 1 succeeded)');

    // 2. In-Cluster Prometheus
    const promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    try {
      const res = await fetch(`${promUrl}/-/healthy`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      console.log(`✓ Prometheus connected (${promUrl})`);
    } catch (err: any) {
      throw new Error(`[Startup Health Gate] FATAL: In-cluster Prometheus is unreachable at ${promUrl}: ${err.message}`);
    }

    // 3. Microsoft Entra ID JWKS
    const jwksHealth = await OIDCValidator.checkJwksHealth();
    if (!jwksHealth.healthy) {
      throw new Error(`[Startup Health Gate] FATAL: Microsoft Entra ID JWKS endpoint unreachable at ${jwksHealth.uri}`);
    }
    console.log(`✓ Entra ID JWKS active (${jwksHealth.keyCount} keys discovered)`);

    // 4. Gemini API Key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('[Startup Health Gate] FATAL: GEMINI_API_KEY is not configured.');
    }
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      console.log('✓ Gemini API reachable and credentials validated');
    } catch (err: any) {
      throw new Error(`[Startup Health Gate] FATAL: Gemini API unreachable: ${err.message}`);
    }

    // 5. Kubernetes Cluster API
    try {
      const k8sPing = await this.executionService.getK8sClient().ping();
      if (!k8sPing.connected) throw new Error(k8sPing.error || 'Failed to ping cluster');
      console.log('✓ Kubernetes API server connected (pod list probe succeeded)');
    } catch (err: any) {
      throw new Error(`[Startup Health Gate] FATAL: Kubernetes cluster unreachable: ${err.message}`);
    }

    // 6. Azure Blob WORM Storage
    try {
      const blobHealth = await this.complianceService.checkWormStorageHealth();
      if (!blobHealth.connected) throw new Error(blobHealth.error || 'Container probe failed');
      console.log(`✓ Azure Blob WORM storage connected (container: ${blobHealth.container})`);
    } catch (err: any) {
      throw new Error(`[Startup Health Gate] FATAL: Azure Blob Storage unreachable: ${err.message}`);
    }

    console.log('[Startup Health Gate] All live dependencies verified. Boot sequence approved.\n');
  }

  private async setupRoutes() {
    // ── PRD v4.0 §B.2: Scoped CORS origin allow-list ────────────────────
    const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
      ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4000'];

    await this.app.register(cors, {
      origin: allowedOrigins,
      credentials: true
    });

    // ── PRD v4.0 §B.2: Rate limiting ────────────────────────────────────
    await this.app.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute'
    });

    // ── PRD v4.0 §B.1: Global authentication hook ───────────────────────
    // Enforces Entra ID JWT validation on ALL /api/* routes except the
    // explicit auth-exempt list. Both audits independently found read
    // endpoints unauthenticated — this closes that gap.
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const url = request.url.split('?')[0]; // strip query params

      // Skip auth for explicitly exempted routes
      if (AUTH_EXEMPT_ROUTES.has(url)) return;
      if (!url.startsWith('/api/')) return; // non-API routes (static assets, etc.)

      // Enforce Entra ID JWT on all other /api/* routes
      try {
        const user = await OIDCValidator.validateTokenLive(request.headers.authorization);
        (request as any).user = user;
      } catch (err: any) {
        reply.status(401).send({
          error: 'Unauthorized',
          message: err.message || 'Authentication required. Provide a valid Entra ID Bearer token.'
        });
      }
    });

    // Global error handler for authentication and validation
    this.app.setErrorHandler((error: any, request: FastifyRequest, reply: FastifyReply) => {
      if (
        error.message?.includes('Authentication required') ||
        error.message?.includes('Token verification failed')
      ) {
        return reply.status(401).send({ error: 'Unauthorized', message: error.message });
      }
      if (error.validation || error.name === 'ZodError') {
        return reply.status(400).send({
          error: 'ValidationError',
          message: error.message,
          issues: error.issues || error.validation
        });
      }
      reply.status(error.statusCode || 500).send({
        error: error.name || 'InternalServerError',
        message: error.message || 'An unexpected error occurred'
      });
    });

    // ── Health & System Status (PRD v3.0 §2.5: Real connectivity checks) ─
    this.app.get('/health', async () => {
      const dbConnected = await this.repo.ping();
      
      const promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
      let promConnected = false;
      try {
        const pRes = await fetch(`${promUrl}/-/healthy`, { signal: AbortSignal.timeout(3000) });
        promConnected = pRes.ok;
      } catch {
        promConnected = false;
      }

      const jwks = await OIDCValidator.checkJwksHealth();
      const authConnected = jwks.healthy;

      const apiKey = process.env.GEMINI_API_KEY;
      let llmConnected = false;
      if (apiKey) {
        try {
          const lRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
            signal: AbortSignal.timeout(3000)
          });
          llmConnected = lRes.ok;
        } catch {
          llmConnected = false;
        }
      }

      const k8sHealth = await this.executionService.getK8sClient().ping();
      const blobHealth = await this.complianceService.checkWormStorageHealth();

      const allUp = dbConnected && promConnected && authConnected && llmConnected && k8sHealth.connected && blobHealth.connected;

      return {
        status: allUp ? 'UP' : 'DEGRADED',
        platform: 'AI SRE Commander v4.0 (Real-Only, Hardened)',
        database: dbConnected ? 'CONNECTED' : 'UNREACHABLE',
        prometheus: promConnected ? 'CONNECTED' : 'UNREACHABLE',
        auth: authConnected ? 'CONNECTED' : 'UNREACHABLE',
        llm: llmConnected ? 'CONNECTED' : 'UNREACHABLE',
        kubernetes: k8sHealth.connected ? 'CONNECTED' : 'UNREACHABLE',
        wormStorage: blobHealth.connected ? 'CONNECTED' : 'UNREACHABLE',
        timestamp: new Date().toISOString()
      };
    });

    // ── PRD v4.0 §C.8: Prometheus scrape endpoint for platform self-observability ─
    this.app.get('/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
      reply.type('text/plain; version=0.0.4');
      return TelemetryCollector.getInstance().toPrometheusText();
    });

    // Golden Signals & Telemetry
    this.app.get('/api/telemetry', async () => {
      return TelemetryCollector.getInstance().getAIMetrics();
    });

    // ── 1. Incidents API (PRD §34) ──────────────────────────────────────
    this.app.get('/api/incidents', async () => {
      return this.repo.listIncidents();
    });

    this.app.post('/api/incidents', async (req: FastifyRequest) => {
      const user = await this.getUser(req);
      // PRD v4.0 §B.3: Zod validation at API boundary
      const body = CreateIncidentSchema.parse(req.body);
      const incident = await this.repo.createIncident({
        title: body.title,
        service: body.service,
        severity: body.severity,
        environment: body.environment
      });

      await this.complianceService.recordAuditEvent({
        tenant: user.tenantId,
        actor: user.email,
        actorType: 'USER',
        action: 'incident:create',
        target: incident.id,
        requestId: randomUUID(),
        incidentId: incident.id
      });

      await this.notificationService.notifyIncidentCreated(incident);
      return incident;
    });

    this.app.get('/api/incidents/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const incident = await this.repo.getIncident(req.params.id);
      if (!incident) return reply.status(404).send({ error: 'Incident not found' });
      return incident;
    });

    this.app.post('/api/incidents/:id/investigate', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await this.getUser(req);
      const incident = await this.repo.getIncident(req.params.id);
      if (!incident) return reply.status(404).send({ error: 'Incident not found' });

      const result = await this.orchestrator.runInvestigation(req.params.id);

      // Store generated evidence
      for (const ev of result.evidence) {
        await this.repo.addEvidence(req.params.id, ev);
      }

      await this.complianceService.recordAuditEvent({
        tenant: user.tenantId,
        actor: 'ai-orchestrator',
        actorType: 'AI_AGENT',
        action: 'investigation:complete',
        target: incident.id,
        requestId: randomUUID(),
        incidentId: incident.id,
        modelMetadata: {
          provider: 'Google',
          model: 'gemini-3.8-flash',
          promptHash: randomUUID()
        }
      });

      return result;
    });

    this.app.get('/api/incidents/:id/evidence', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      return this.repo.getEvidenceForIncident(req.params.id);
    });

    this.app.get('/api/incidents/:id/timeline', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      return this.repo.getTimeline(req.params.id);
    });

    // ── 2. Remediations & Approvals API ─────────────────────────────────
    this.app.post('/api/incidents/:id/remediations', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      // PRD v4.0 §B.3: Zod validation at API boundary
      const body = CreateRemediationSchema.parse(req.body);
      const incident = await this.repo.getIncident(req.params.id);
      if (!incident) throw new Error('Incident not found');

      const proposal = {
        id: randomUUID(),
        incidentId: req.params.id,
        action: body.action,
        risk: body.risk,
        environment: incident.environment,
        namespace: incident.namespace,
        targetResource: body.targetResource || `deployment/${incident.service}`,
        parameters: body.parameters || { deployment: incident.service, targetRevision: 1 },
        expectedImpact: body.expectedImpact || 'Revert to stable release',
        blastRadius: body.blastRadius || 'Workload replicas only',
        status: 'PROPOSED' as const,
        proposedBy: 'operator',
        reason: body.reason || 'Operator initiated proposal',
        idempotencyKey: randomUUID(),
        createdAt: new Date().toISOString()
      };

      await this.repo.recordProposal(proposal as any);
      return proposal;
    });

    this.app.post('/api/remediations/:id/approve', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const user = await this.getUser(req);
      // PRD v4.0 §B.3: Require justification for audit trail
      const body = ApproveRemediationSchema.parse(req.body);

      const incidents = await this.repo.listIncidents();
      const incident = incidents.find((inc) => inc.remediationProposals.some((p) => p.id === req.params.id));
      if (!incident) throw new Error(`Remediation proposal ${req.params.id} not found`);

      const approved = await this.remediationEngine.approveProposal(
        incident.id,
        req.params.id,
        user,
        body.justification
      );

      await this.complianceService.recordAuditEvent({
        tenant: user.tenantId,
        actor: user.email,
        actorType: 'USER',
        action: 'remediation:approve',
        target: approved.targetResource,
        requestId: randomUUID(),
        incidentId: incident.id,
        approvalId: req.params.id,
        policyDecision: { allowed: true, riskClass: approved.risk }
      });

      return { success: true, remediation: approved };
    });

    this.app.post('/api/remediations/:id/reject', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const user = await this.getUser(req);
      // PRD v4.0 §B.3: Require reason for audit trail
      const body = RejectRemediationSchema.parse(req.body);

      const incidents = await this.repo.listIncidents();
      const incident = incidents.find((inc) => inc.remediationProposals.some((p) => p.id === req.params.id));
      if (!incident) throw new Error(`Remediation proposal ${req.params.id} not found`);

      const rejected = await this.remediationEngine.rejectProposal(
        incident.id,
        req.params.id,
        user,
        body.reason
      );

      await this.complianceService.recordAuditEvent({
        tenant: user.tenantId,
        actor: user.email,
        actorType: 'USER',
        action: 'remediation:reject',
        target: rejected.targetResource,
        requestId: randomUUID(),
        incidentId: incident.id
      });

      return { success: true, remediation: rejected };
    });

    this.app.post('/api/remediations/:id/execute', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const user = await this.getUser(req);
      const incidents = await this.repo.listIncidents();
      const incident = incidents.find((inc) => inc.remediationProposals.some((p) => p.id === req.params.id));
      if (!incident) throw new Error(`Remediation proposal ${req.params.id} not found`);

      const proposal = incident.remediationProposals.find((p) => p.id === req.params.id)!;
      const execResult = await this.executionService.executeProposal(incident.id, proposal);

      await this.complianceService.recordAuditEvent({
        tenant: user.tenantId,
        actor: user.email,
        actorType: 'USER',
        action: 'remediation:execute',
        target: proposal.targetResource,
        requestId: randomUUID(),
        incidentId: incident.id,
        executionResult: { status: execResult.status, details: execResult }
      });

      // Automatically trigger post-execution verification
      const verifResult = await this.verificationService.verifyIncidentRecovery(incident.id);

      return {
        success: true,
        execution: execResult,
        verification: verifResult.verification,
        incident: verifResult.incident
      };
    });

    // ── 3. Postmortem & Audit ───────────────────────────────────────────
    this.app.get('/api/incidents/:id/postmortem', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      return this.complianceService.generatePostmortem(req.params.id);
    });

    this.app.get('/api/audit', async () => {
      return this.complianceService.getAuditTrailFromDb();
    });

    // ── 4. Compliance & SLOs ────────────────────────────────────────────
    this.app.get('/api/slos', async () => {
      return this.complianceService.getSloMetrics('checkout-api');
    });

    this.app.get('/api/compliance/dora/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      return this.complianceService.generateDoraReport(req.params.id);
    });

    this.app.get('/api/compliance/nis2', async () => {
      return this.complianceService.generateNis2Report();
    });

    this.app.get('/api/compliance/eu-ai-act', async () => {
      return this.complianceService.getEuAiActRegistry();
    });

    // ── 5. Ingest External Event (Prometheus, K8s, GitHub) ──────────────
    // PRD v4.0 §B.1: HMAC-SHA256 webhook verification
    this.app.post('/api/events', async (req: FastifyRequest) => {
      this.verifyWebhookSignature(req);

      const raw = req.body as any;
      let norm;

      if (raw.source === 'prometheus' || raw.alerts) {
        norm = EventNormalizer.normalizePrometheus(raw);
      } else if (raw.source === 'kubernetes' || raw.reason) {
        norm = EventNormalizer.normalizeKubernetes(raw);
      } else if (raw.deployment || raw.head_commit) {
        norm = EventNormalizer.normalizeGitHub(raw);
      } else {
        norm = EventNormalizer.normalizePrometheus(raw);
      }

      const corr = await this.correlation.correlate(norm);
      return { accepted: true, eventId: norm.id, correlation: corr };
    });

    // ── 6. Interactive Flagship Demonstration Scenario trigger (PRD §38) ─
    this.app.post('/api/demo/trigger-flagship', async () => {
      // Step 1: Ingest Deployment v1.1.0
      const deployEvent = EventNormalizer.normalizeGitHub({
        deployment: { ref: 'v1.1.0', sha: 'e7a4b12399ff', environment: 'production' },
        repository: { name: 'checkout-api' }
      });
      const c1 = await this.correlation.correlate(deployEvent);
      const incId = c1.incident.id;

      // Step 2: Pod OOMKilled
      const k8sEvent = EventNormalizer.normalizeKubernetes({
        reason: 'OOMKilled',
        involvedObject: { kind: 'Pod', name: 'checkout-api-5f585985bf-ng58r', labels: { app: 'checkout-api' } },
        message: 'Container limit 512Mi exceeded'
      });
      await this.correlation.correlate(k8sEvent);

      // Step 3: Prometheus Alert firing
      const promAlert = EventNormalizer.normalizePrometheus({
        labels: { alertname: 'HighErrorRate5xx', service: 'checkout-api', severity: 'critical' },
        annotations: { summary: 'HTTP 500 error rate spiked to 6.8%' }
      });
      await this.correlation.correlate(promAlert);

      // Step 4: Run AI Investigation
      const inv = await this.orchestrator.runInvestigation(incId);
      for (const ev of inv.evidence) {
        await this.repo.addEvidence(incId, ev);
      }

      const updatedIncident = await this.repo.getIncident(incId);
      return {
        message: 'Flagship demo incident initiated and diagnosed.',
        incident: updatedIncident,
        proposal: updatedIncident?.remediationProposals[0]
      };
    });
  }

  public async start(port = 4000): Promise<string> {
    await this.verifyDependenciesAtBoot();
    await this.setupRoutes();
    return this.app.listen({ port, host: '0.0.0.0' });
  }

  public async stop(): Promise<void> {
    await this.app.close();
  }
}

// Start server if run directly
const isMain = process.argv[1]
  ? (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith('server.js'))
  : false;
if (isMain) {
  const srv = new ApiServer();
  const port = Number(process.env.PORT) || 4000;
  srv.start(port).then((addr) => {
    console.log(`[AI SRE Commander] API Gateway running on ${addr}`);
  }).catch((err) => {
    console.error('[AI SRE Commander] Server failed to start:', err);
    process.exit(1);
  });
}
