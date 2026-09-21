import 'dotenv/config';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';

import { OIDCValidator, type AuthUser } from '@ai-sre/auth';
import { IncidentRepository } from '@ai-sre/incident-engine';
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

export class ApiServer {
  public app: FastifyInstance;
  public repo: IncidentRepository;
  public correlation: CorrelationEngine;
  public orchestrator: AIOrchestrator;
  public evidenceService: EvidenceService;
  public remediationEngine: RemediationEngine;
  public policyEngine: PolicyEngine;
  public executionService: ExecutionService;
  public verificationService: VerificationService;
  public complianceService: ComplianceService;
  public notificationService: NotificationService;

  constructor() {
    this.app = Fastify({ logger: false });
    this.repo = new IncidentRepository();
    this.correlation = new CorrelationEngine(this.repo);
    this.orchestrator = new AIOrchestrator(this.repo);
    this.evidenceService = new EvidenceService();
    this.remediationEngine = new RemediationEngine(this.repo);
    this.policyEngine = new PolicyEngine();
    this.executionService = new ExecutionService(this.repo);
    this.verificationService = new VerificationService(this.repo);
    this.complianceService = new ComplianceService(this.repo);
    this.notificationService = new NotificationService();

    // Routes setup will be awaited in start()
  }

  private getUser(req: FastifyRequest): AuthUser {
    const authHeader = req.headers.authorization;
    return OIDCValidator.validateToken(authHeader);
  }

  private async setupRoutes() {
    await this.app.register(cors, { origin: '*' });

    // Health
    this.app.get('/health', async () => ({ status: 'UP', platform: 'AI SRE Commander v1.0' }));

    // Golden Signals & Telemetry
    this.app.get('/api/telemetry', async () => {
      return TelemetryCollector.getInstance().getAIMetrics();
    });

    // 1. Incidents API (PRD §34)
    this.app.get('/api/incidents', async () => {
      return this.repo.listIncidents();
    });

    this.app.post('/api/incidents', async (req: FastifyRequest) => {
      const user = this.getUser(req);
      const body = req.body as any;
      const incident = this.repo.createIncident({
        title: body.title || 'Manual Incident Alert',
        service: body.service || 'checkout-api',
        severity: body.severity || 'SEV-2',
        environment: body.environment || 'production'
      });

      this.complianceService.recordAuditEvent({
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
      const incident = this.repo.getIncident(req.params.id);
      if (!incident) return reply.status(404).send({ error: 'Incident not found' });
      return incident;
    });

    this.app.post('/api/incidents/:id/investigate', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = this.getUser(req);
      const incident = this.repo.getIncident(req.params.id);
      if (!incident) return reply.status(404).send({ error: 'Incident not found' });

      const result = await this.orchestrator.runInvestigation(req.params.id);

      // Store generated evidence
      for (const ev of result.evidence) {
        this.evidenceService.addEvidence(req.params.id, ev);
      }

      this.complianceService.recordAuditEvent({
        tenant: user.tenantId,
        actor: 'ai-orchestrator',
        actorType: 'AI_AGENT',
        action: 'investigation:complete',
        target: incident.id,
        requestId: randomUUID(),
        incidentId: incident.id,
        modelMetadata: {
          provider: 'Gemini',
          model: 'gemini-2.5-pro',
          promptHash: randomUUID()
        }
      });

      return result;
    });

    this.app.get('/api/incidents/:id/evidence', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      return this.evidenceService.getEvidenceForIncident(req.params.id);
    });

    this.app.get('/api/incidents/:id/timeline', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      return this.repo.getTimeline(req.params.id);
    });

    // 2. Remediations & Approvals API
    this.app.post('/api/incidents/:id/remediations', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const body = req.body as any;
      const incident = this.repo.getIncident(req.params.id);
      if (!incident) throw new Error('Incident not found');

      const proposal = {
        id: randomUUID(),
        incidentId: req.params.id,
        action: body.action || 'rollback_deployment',
        risk: body.risk || 'HIGH',
        environment: incident.environment,
        namespace: incident.namespace,
        targetResource: body.targetResource || `deployment/${incident.service}`,
        parameters: body.parameters || { deployment: incident.service, targetRevision: 26 },
        expectedImpact: body.expectedImpact || 'Revert to stable release',
        blastRadius: body.blastRadius || 'Workload replicas only',
        status: 'PROPOSED' as const,
        proposedBy: 'operator',
        reason: body.reason || 'Operator initiated proposal',
        idempotencyKey: randomUUID(),
        createdAt: new Date().toISOString()
      };

      incident.remediationProposals.push(proposal);
      this.repo.updateIncident(incident);
      return proposal;
    });

    this.app.post('/api/remediations/:id/approve', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const user = this.getUser(req);
      const body = (req.body as any) || {};

      // Find incident containing proposal
      const incidents = this.repo.listIncidents();
      const incident = incidents.find((inc) => inc.remediationProposals.some((p) => p.id === req.params.id));
      if (!incident) throw new Error(`Remediation proposal ${req.params.id} not found`);

      const approved = await this.remediationEngine.approveProposal(
        incident.id,
        req.params.id,
        user,
        body.justification
      );

      this.complianceService.recordAuditEvent({
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
      const user = this.getUser(req);
      const body = (req.body as any) || {};

      const incidents = this.repo.listIncidents();
      const incident = incidents.find((inc) => inc.remediationProposals.some((p) => p.id === req.params.id));
      if (!incident) throw new Error(`Remediation proposal ${req.params.id} not found`);

      const rejected = await this.remediationEngine.rejectProposal(
        incident.id,
        req.params.id,
        user,
        body.reason || 'Declined by operator'
      );

      this.complianceService.recordAuditEvent({
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
      const user = this.getUser(req);
      const incidents = this.repo.listIncidents();
      const incident = incidents.find((inc) => inc.remediationProposals.some((p) => p.id === req.params.id));
      if (!incident) throw new Error(`Remediation proposal ${req.params.id} not found`);

      const proposal = incident.remediationProposals.find((p) => p.id === req.params.id)!;
      const execResult = await this.executionService.executeProposal(incident.id, proposal);

      this.complianceService.recordAuditEvent({
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

    // 3. Postmortem & Audit
    this.app.get('/api/incidents/:id/postmortem', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      return this.complianceService.generatePostmortem(req.params.id);
    });

    this.app.get('/api/audit', async () => {
      return this.complianceService.getAuditTrail();
    });

    // 4. Compliance & SLOs
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

    // 5. Ingest External Event (Prometheus, K8s, GitHub, Sentry)
    this.app.post('/api/events', async (req: FastifyRequest) => {
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

      const corr = this.correlation.correlate(norm);
      return { accepted: true, eventId: norm.id, correlation: corr };
    });

    // 6. Interactive Flagship Demonstration Scenario trigger (PRD §38)
    this.app.post('/api/demo/trigger-flagship', async () => {
      // Step 1: Ingest Deployment v1.1.0
      const deployEvent = EventNormalizer.normalizeGitHub({
        deployment: { ref: 'v1.1.0', sha: 'e7a4b12399ff', environment: 'production' },
        repository: { name: 'checkout-api' }
      });
      const c1 = this.correlation.correlate(deployEvent);
      const incId = c1.incident.id;

      // Step 2: Pod OOMKilled
      const k8sEvent = EventNormalizer.normalizeKubernetes({
        reason: 'OOMKilled',
        involvedObject: { kind: 'Pod', name: 'checkout-api-7b9d9c-f12', labels: { app: 'checkout-api' } },
        message: 'Container limit 512Mi exceeded'
      });
      this.correlation.correlate(k8sEvent);

      // Step 3: Prometheus Alert firing
      const promAlert = EventNormalizer.normalizePrometheus({
        labels: { alertname: 'HighErrorRate5xx', service: 'checkout-api', severity: 'critical' },
        annotations: { summary: 'HTTP 500 error rate spiked to 6.8%' }
      });
      this.correlation.correlate(promAlert);

      // Step 4: Run AI Investigation
      const inv = await this.orchestrator.runInvestigation(incId);
      for (const ev of inv.evidence) {
        this.evidenceService.addEvidence(incId, ev);
      }

      const updatedIncident = this.repo.getIncident(incId);
      return {
        message: 'Flagship demo incident initiated and diagnosed.',
        incident: updatedIncident,
        proposal: updatedIncident?.remediationProposals[0]
      };
    });
  }

  public async start(port = 4000): Promise<string> {
    await this.setupRoutes();
    return this.app.listen({ port, host: '0.0.0.0' });
  }

  public async stop(): Promise<void> {
    await this.app.close();
  }
}

// Start server
const srv = new ApiServer();
const port = Number(process.env.PORT) || 4000;
srv.start(port).then((addr) => {
  console.log(`[AI SRE Commander] API Gateway running on ${addr}`);
}).catch((err) => {
  console.error('[AI SRE Commander] Server failed to start:', err);
});

