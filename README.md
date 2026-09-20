# AI SRE Commander

> **Production-Grade AI-Powered Incident Detection, Investigation, Remediation & Reliability Control Plane**
> *Targeted for European SaaS, Fintech, Enterprise, and Cloud-Native Engineering Teams on Microsoft Azure / Kubernetes (AKS).*

---

## 1. Product Vision

AI SRE Commander transforms fragmented operational telemetry across Kubernetes, Prometheus, Sentry, Azure, and GitHub into evidence-grounded incident understanding and policy-controlled remediation.

```
DETECT → CORRELATE → INVESTIGATE → EXPLAIN → RECOMMEND → APPROVE → EXECUTE → VERIFY → DOCUMENT
```

### Core Product Principles:
- **Separation of Reasoning and Execution**: AI may reason over operational evidence, but deterministic policy engines control infrastructure actions.
- **Inspectable Hypotheses**: Every AI conclusion presents supporting evidence, contradictory evidence, provenance, and calibrated confidence.
- **Human-in-the-Loop Safeguards**: High-risk production actions (such as rollbacks or node drains) require cryptographic authorization and human sign-off.
- **Tamper-Evident Governance**: Every action, policy check, and model invocation is permanently recorded in a SHA-256 hash-chained audit ledger conforming to DORA, NIS2, and EU AI Act requirements.

---

## 2. Architecture & Repository Layout

```
ai-sre-commander/
├── apps/
│   ├── web/                         # React 19 + TypeScript + Tailwind SRE Control Console
│   └── api/                         # Fastify API Gateway / BFF with Realtime SSE & OIDC/RBAC
├── services/
│   ├── event-ingestion/             # Normalizes signals from K8s, Prometheus, Sentry, GitHub, Azure
│   ├── incident-engine/             # 10-state incident lifecycle state machine
│   ├── correlation-engine/          # Temporal and causal graph correlation
│   ├── ai-orchestrator/             # Multi-agent coordination, prompt sanitization, model routing
│   ├── evidence-service/            # Structured evidence objects & contradiction tracking
│   ├── remediation-engine/          # Typed action planning and risk classification
│   ├── policy-engine/               # OPA-compatible rules & environment boundaries
│   ├── execution-service/           # Sandboxed Kubernetes API executor with idempotency keys
│   ├── verification-service/        # Post-action metric window health verification
│   └── notification-service/        # Alert dispatch (Slack, Teams, Webhooks)
├── agents/
│   ├── kubernetes/                  # Pods, deployments, nodes, and saturation
│   ├── observability/               # Metrics, baseline deviations, error rates
│   ├── change-intelligence/         # Git commits, PRs, deployments, config diffs
│   ├── rca/                         # Ranked competing hypotheses & evidence scoring
│   ├── remediation/                 # Structured action proposal & expected blast radius
│   └── verification/                # Post-action recovery validation
├── packages/
│   ├── event-schema/                # Unified Event Model & Zod schemas
│   ├── auth/                        # Entra ID / OIDC RBAC & permission mapping
│   ├── telemetry/                   # Golden signals & AI-specific telemetry
│   ├── api-client/                  # Type-safe client for frontend and CLI
│   └── security/                    # Secret redactor, prompt-injection defense, audit hasher
├── infrastructure/
│   ├── terraform/                   # Azure Resource Group, AKS, ACR, Postgres, Redis, Key Vault
│   ├── helm/                        # Helm charts for Commander & checkout-api demo
│   ├── argocd/                      # GitOps manifests
│   └── policies/                    # Gatekeeper & Rego safety rules
└── tests/
    ├── unit/                        # Unit tests for domain logic and state transitions
    ├── integration/                 # Adapter and pipeline tests
    ├── e2e/                         # Golden incident end-to-end scenario
    ├── chaos/                       # Fault injection and resilience verification
    └── security/                    # RBAC negative tests and prompt-injection defense
```

---

## 3. Quickstart

### Prerequisites
- Node.js >= 20
- npm >= 10
- Azure CLI (`az`) logged in
- Terraform >= 1.5

### Install & Build
```bash
npm install
npm run build
npm test
```

### Run Flagship Incident Demo
```bash
npm run test:e2e
```
