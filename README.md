# AI SRE Commander

<div align="center">

![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=nodedotjs&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5.2-000000?logo=fastify&logoColor=white)
![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)
![Kubernetes](https://img.shields.io/badge/Kubernetes-Azure%20AKS-326CE5?logo=kubernetes&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/Database-Azure%20PostgreSQL-336791?logo=postgresql&logoColor=white)
![Prometheus](https://img.shields.io/badge/Telemetry-Prometheus-E6522C?logo=prometheus&logoColor=white)
![Gemini](https://img.shields.io/badge/AI%20Model-Gemini%203.8%20Flash-4285F4?logo=google&logoColor=white)
![Compliance](https://img.shields.io/badge/Compliance-DORA%20%7C%20NIS2%20%7C%20EU%20AI%20Act-003399?logo=europeanunion&logoColor=white)

**Autonomous Incident Investigation, Remediation & Reliability Control Plane for Cloud-Native Infrastructure**  
*Built for European Enterprise SaaS, Fintech, and Mission-Critical Workloads on Microsoft Azure & Kubernetes.*

[Engineering Guide](docs/ENGINEERING_GUIDE.md) • [Architecture](#2-system-architecture--workflow) • [EU Compliance](#3-eu-regulatory-governance--compliance-targeting) • [Tech Stack](#4-technology-stack) • [Control Console UI](#5-sre-control-console-ui) • [Security](#6-production-hardened-security-architecture) • [Getting Started](#7-getting-started--local-verification)

</div>

---

## 1. Executive Summary & Problem Statement

Modern enterprise Kubernetes environments generate gigabytes of fragmented operational noise per minute across distributed tracing, Prometheus metrics, pod crash loops, deployment pipelines, and alert managers. During high-severity production outages (SEV-1/SEV-2):

1. **Mean Time to Detect (MTTD) & Diagnose (MTTDia) is Dragged Out**: SREs waste 40–70% of incident response time manually correlating deployment diffs with container OOMKills, saturated connection pools, and error rate spikes.
2. **Generic LLMs Hallucinate in Production Operations**: Naive chat interfaces lack domain-grounded telemetry, execute destructive unvetted scripts, or produce ungrounded causal claims.
3. **Strict European Regulatory Liabilities (DORA, NIS2, EU AI Act)**: Regulatory frameworks mandate rigorous continuous monitoring, verifiable human oversight, tamper-evident audit trails, and strict postmortem reporting deadlines (e.g., 24-hour NIS2 notification).

### The Solution: AI SRE Commander

**AI SRE Commander** is a production-hardened reliability control plane that ingests heterogeneous raw events, builds temporal and causal dependency graphs, conducts multi-agent hypothesis tournaments using Google Gemini, evaluates actions through deterministic policy gates, and executes verified rollbacks against live Kubernetes clusters.

```
DETECT ➔ CORRELATE ➔ INVESTIGATE ➔ EXPLAIN ➔ RECOMMEND ➔ APPROVE ➔ EXECUTE ➔ VERIFY ➔ DOCUMENT
```

### Core Design Principles

- **Strict Separation of Reasoning and Execution**: Large Language Models reason over correlated evidence and formulate ranked hypotheses. Deterministic, cryptographically signed policy engines and human SRE operators authorize mutations.
- **Inspectable Causal Tournament**: Every AI conclusion delivers calibrated confidence percentages, explicit supporting evidence, and contradictory evidence checks.
- **Zero Mock / Real-Adapter Architecture**: The control plane interfaces directly with Azure Kubernetes Service (`aks-aisre-prod`), Azure PostgreSQL Flexible Server, in-cluster Prometheus, Azure Blob WORM storage, and Microsoft Entra ID.
- **Cryptographic Immutability**: All decisions, operator justifications, AI prompts, and execution hashes are permanently recorded in a SHA-256 tamper-evident ledger stored on immutable WORM blob containers.

---

## 2. System Architecture & Workflow

AI SRE Commander is structured as a modular TypeScript monorepo with clean boundaries between ingestion, state management, multi-agent reasoning, policy enforcement, and infrastructure execution.

### High-Level Architectural Flow

```mermaid
flowchart TD
    subgraph Ingress ["1. Telemetry Ingress & Hardening"]
        A1[GitHub Deployments] -->|HMAC-SHA256| INGEST[Event Ingestion Engine]
        A2[Kubernetes Events] -->|Watch Stream| INGEST
        A3[Prometheus Alerts] -->|Webhook| INGEST
    end

    subgraph Correlation ["2. Correlation & State Engine"]
        INGEST -->|Normalize| CORR[Correlation Engine]
        CORR -->|10-State FSM| DB[(Azure PostgreSQL Flexible)]
        CORR -->|Temporal Windowing| INCIDENT[Active Incident]
    end

    subgraph Reasoning ["3. Multi-Agent AI Orchestrator"]
        INCIDENT --> ORCH[AI Orchestrator]
        ORCH --> K8S_AGENT[Kubernetes Agent]
        ORCH --> OBS_AGENT[Observability Agent]
        ORCH --> CHANGE_AGENT[Change Intelligence Agent]
        K8S_AGENT & OBS_AGENT & CHANGE_AGENT -->|Grounding Evidence| LLM[Google Gemini 3.8 Flash]
        LLM -->|Causal Tournament| HYP[Ranked Hypotheses & Remediation Proposal]
    end

    subgraph Governance ["4. Policy Engine & Approval Gate"]
        HYP --> POLICY{Policy Engine}
        POLICY -->|Low Risk| AUTO[Automated Action]
        POLICY -->|Medium/High Risk| GATE[Human SRE Approval Gate]
        GATE -->|Entra ID RS256 JWT| AUTH_USER[Authenticated SRE Operator]
    end

    subgraph Execution ["5. Execution & Live Verification"]
        AUTH_USER -->|Approved + Justification| EXEC[Execution Service]
        EXEC -->|Idempotency Check| K8S_API[Live AKS Cluster API]
        K8S_API -->|Rollback Deployment| REPAIR[checkout-api Reverted]
        REPAIR --> VERIF[Verification Agent]
        VERIF -->|PromQL Error Rate Query| PROM[Prometheus Server]
    end

    subgraph Compliance ["6. Cryptographic Ledger & Audit"]
        EXEC & VERIF --> COMPLIANCE[Compliance Service]
        COMPLIANCE -->|SHA-256 Hash Chain| WORM[(Azure Blob WORM Storage)]
        COMPLIANCE --> DORA[DORA Incident Report]
        COMPLIANCE --> NIS2[NIS2 Notification File]
        COMPLIANCE --> EU_AI[EU AI Act Article Registry]
    end
```

---

## 3. EU Regulatory Governance & Compliance Targeting

AI SRE Commander was architected from inception to satisfy the stringent compliance requirements of European financial, critical infrastructure, and digital service regulations.

### Regulatory Mapping Matrix

| Regulation | Article / Mandate | Legal Requirement | How AI SRE Commander Implements It |
| :--- | :--- | :--- | :--- |
| **DORA**<br>*(Regulation EU 2022/2554)* | **Article 9**<br>*Protection & Prevention* | Continuous monitoring and automated detection of ICT-related incidents. | Real-time event ingestion normalizes signals across Kubernetes, Prometheus, and GitHub in under 1 second. |
| **DORA** | **Article 11**<br>*Response & Recovery* | Dedicated business continuity policies and automated recovery measures. | Scoped Kubernetes rollback execution restores degraded workloads within 12 seconds with post-action verification. |
| **DORA** | **Article 12**<br>*Backup & Immutability* | Unalterable, secure retention of incident records and diagnostic evidence. | SHA-256 hash-chained ledger written to Azure Blob Storage configured with immutable regulatory WORM policies. |
| **DORA** | **Article 17 & 19**<br>*Incident Classification & Reporting* | Systematic classification of major ICT incidents and structured reporting. | Automated generation of DORA-compliant incident reports including economic impact, root cause, and MTTR metrics. |
| **NIS2**<br>*(Directive EU 2022/2555)* | **Article 21**<br>*Cybersecurity Risk Management* | Supply chain integrity, multi-factor access control, and cryptographic hygiene. | Entra ID OIDC RS256 token verification, HMAC webhook signatures, NFKC prompt sanitization, and secret redaction. |
| **NIS2** | **Article 23**<br>*Reporting Obligations* | Mandatory 24-hour early warning and 72-hour incident assessment notifications. | `/api/compliance/nis2` automatically generates standardized notification payloads upon incident triage. |
| **EU AI Act**<br>*(Regulation EU 2024/1689)* | **Article 9**<br>*Risk Management System* | Continuous identification and mitigation of AI-induced systemic risks. | LLM Gateway implements model routing, token cost boundaries, prompt injection filters, and hallucination scoring. |
| **EU AI Act** | **Article 12**<br>*Record-Keeping & Logging* | Automatic recording of events throughout high-impact AI lifecycles. | Every AI prompt, raw completion, token count, and reasoning output is cryptographically hashed and logged. |
| **EU AI Act** | **Article 13**<br>*Transparency & Interpretability* | AI systems must be interpretable with clear provenance and confidence calibration. | Hypotheses are ranked with explicit confidence scores, supporting evidence citations, and contradictory evidence checks. |
| **EU AI Act** | **Article 14**<br>*Human Oversight* | Verifiable human-in-the-loop controls, dual authorization, and emergency stop buttons. | Medium and High-risk actions require human SRE justification and cryptographic Entra ID sign-off before cluster mutation. |
| **EU AI Act** | **Article 15**<br>*Cybersecurity & Robustness* | Resistance to adversarial attacks, data poisoning, and prompt injection. | 4-tier prompt sanitization: NFKC normalization, URL/base64 decode, delimiter neutralization, and regex scrubbing. |

---

## 4. Technology Stack

### System Overview

| Layer | Technologies | Purpose |
| :--- | :--- | :--- |
| **Frontend / Web Console** | React 19, TypeScript 5.8, Tailwind CSS, Vite, Lucide Icons | Responsive SRE Control Room dashboard with real-time multi-view navigation. |
| **API Gateway / BFF** | Fastify 5.2, `@fastify/cors`, `@fastify/rate-limit`, Zod, SSE | High-throughput, rate-limited API gateway with scoped CORS and body parsing limits. |
| **AI Reasoning & LLM** | Google Gemini 3.8 Flash, Multi-Agent Orchestration | Causal root cause synthesis, competing hypothesis tournaments, and remediation planning. |
| **Database & ORM** | Azure PostgreSQL Flexible Server, Prisma ORM 5.x | Acid-compliant transactional persistence, 10-state incident FSM, and audit tables. |
| **Identity & Security** | Microsoft Entra ID (Azure AD), OIDC, RS256 JWKS | Enterprise SSO, role-based access control (`sre`, `platform_admin`), and token verification. |
| **Observability & Telemetry** | Prometheus, PromQL, Alertmanager, Custom OpenTelemetry | Golden signals monitoring, real-time error rate queries, and recovery verification. |
| **Infrastructure & Cloud** | Azure Kubernetes Service (AKS), Terraform, Helm | Live managed Kubernetes cluster, namespace isolation (`sre-demo`), and GitOps deployments. |
| **Immutable Storage** | Azure Blob Storage (Immutable WORM Policy) | DORA-compliant 7-year regulatory retention of audit ledgers and diagnostic evidence. |

---

## 5. SRE Control Console UI

The web console (`http://localhost:3000`) provides an interactive command center for site reliability engineers, security teams, and compliance auditors.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  AI SRE COMMANDER ── AKS CONTROL PLANE               [aks-aisre-prod] [EU Governance]  │
├───────────────┬────────────────────────────────────────────────────────────────────────┤
│ ❖ Overview    │  CONTROL ROOM OVERVIEW                                                 │
│ ⚠ Incidents   │  ┌─────────────────────────┐ ┌───────────────────────┐ ┌─────────────┐ │
│ ▤ Services    │  │ Azure PostgreSQL        │ │ Prometheus In-Cluster │ │ Azure AKS   │ │
│ ⛁ Infras      │  │ ● CONNECTED (SSL)       │ │ ● CONNECTED (200 OK)  │ │ ● CONNECTED │ │
│ ⎇ SLOs        │  └─────────────────────────┘ └───────────────────────┘ └─────────────┘ │
│ ⚲ Investigate │                                                                        │
│ ⟲ Remediate   │  ACTIVE INCIDENTS (PostgreSQL Live)                                    │
│ 🔒 Policies   │  • SEV-1: checkout-api: High 5xx Error Spike & OOMKills after v1.1.0   │
│ 📄 Audit      │    State: DETECTED ➔ AI Confidence: 94% ➔ Action: ROLLBACK             │
│ ⚙ Settings    │                                                                        │
├───────────────┤  [ Run Flagship Golden Demo ]                     [ Refresh Feeds ]   │
│ Authenticated │                                                                        │
│ Staff SRE     │                                                                        │
└───────────────┴────────────────────────────────────────────────────────────────────────┘
```

### The 10 Interactive Control Room Panels

#### 1. Overview Dashboard
![Control Room Overview](docs/01_Control_Room_Overview.png)
*Real-time status cards for all 6 external adapters (Azure AKS, Azure PostgreSQL, Prometheus in-cluster, Azure Blob WORM, Microsoft Entra ID, and Google Gemini), platform health indicators, active incident counters, live SRE operator identity, and one-click Flagship Demo trigger.*

#### 2. Incidents Catalog & Multi-Severity Triage
![Incidents Catalog](docs/02_Incidents_Catalog.png)
*Complete catalog of all incidents stored in PostgreSQL with filtering by severity (`SEV-1`, `SEV-2`, `SEV-3`) and state transitions (`DETECTED` ➔ `TRIAGING` ➔ `REMEDIATING` ➔ `RESOLVED`). Clicking **Inspect** opens the 10-tab deep-dive investigation workspace.*

#### 3. Production Service Catalog
![Service Catalog](docs/03_Service_Catalog.png)
*Service catalog displaying managed workloads (`checkout-api` on AKS in namespace `sre-demo`), replica availability, image version tags, and live SLO health adherence.*

#### 4. Infrastructure & Cluster Health Matrix
![Infrastructure Health](docs/04_Infrastructure_Health.png)
*Live cluster matrix detailing node status, CPU and memory utilization, pod lifecycle phases, PostgreSQL connection pools, and scoped ServiceAccount RBAC permissions.*

#### 5. SLOs & Error Budget Burn Rates
![SLOs and Error Budgets](docs/05_SLOs_Error_Budgets.png)
*Real-time Service Level Objectives (Availability 99.94%, Latency p95 99.12%, HTTP Error Rate 99.86%), remaining error budget percentages, and burn rate indicators calculated directly from Prometheus metrics.*

#### 6. AI RCA Multi-Agent Investigations
![AI RCA Investigations](docs/06_AI_RCA_Investigations.png)
*Multi-agent causal investigations powered by Google Gemini 3.8 Flash, featuring ranked competing hypotheses, confidence calibration percentages (94%), supporting telemetry evidence, and contradictory proof checks.*

#### 7. Remediation Proposals & Execution Log
![Remediation Proposals](docs/07_Remediation_Proposals.png)
*Typed action proposal log with UUIDv4 idempotency keys, blast radius risk tiers (`LOW`, `MEDIUM`, `HIGH`), human-in-the-loop approval triggers, and real-time execution tracking (`PROPOSED`, `APPROVED`, `EXECUTED`).*

#### 8. Policy Engine & EU Regulatory Governance
![Policy Engine and EU Governance](docs/08_Policy_Engine_EU_Governance.png)
*Active deterministic PolicyEngine rules, command allowlists (`kubectl rollout undo` permitted; destructive actions blocked), DORA Article 19 status, NIS2 24-hour notification posture, and EU AI Act Article 71 registry metrics.*

#### 9. Cryptographic Tamper-Evident Audit Ledger
![Cryptographic Audit Ledger](docs/09_Cryptographic_Audit_Ledger.png)
*Unbroken SHA-256 Merkle hash chain recording every platform event, operator authorization, and AI prompt with cryptographic proof verification and legal immutability hold (WORM).*

#### 10. Settings & Runtime Configuration
*Runtime cluster configuration, API Gateway endpoints, Microsoft Entra ID tenant validation, and operator role bindings.*

---

## 6. Production-Hardened Security Architecture

AI SRE Commander enforces defense-in-depth across the API, identity, database, and container boundaries.

### Security Defenses Implemented

```
[ Inbound Request ]
         │
         ▼
 1. Scoped CORS Allowlist (Explicit origins only)
         │
         ▼
 2. Fastify Rate Limiting (100 req/min per IP)
         │
         ▼
 3. Body Size Limit (1 MB payload restriction)
         │
         ▼
 4. Webhook HMAC-SHA256 Signature Verification (X-Hub-Signature-256)
         │
         ▼
 5. Microsoft Entra ID OIDC RS256 JWT Verification (Discovery JWKS)
         │
         ▼
 6. NFKC Prompt Injection Sanitizer & Secret Redactor
         │
         ▼
 7. Zod Runtime Schema Validation
         │
         ▼
 8. Deterministic Policy Gate (Risk-tiered approval boundaries)
         │
         ▼
 9. Scoped K8s RBAC Execution (Rollback-only ServiceAccount token)
         │
         ▼
10. SHA-256 Hash Chaining & Immutable WORM Storage
```

- **Prompt Injection Defense**: Multi-stage sanitizer neutralizing adversarial payloads in telemetry (delimiters like `SYSTEM PROMPT:`, `IGNORE PREVIOUS INSTRUCTIONS`, hidden unicode, base64-encoded instructions, and URL-encoded bypasses).
- **Secret Redactor**: Automatically scrubs AWS access keys (`AKIA...`), GitHub PATs (`ghp_...`), JWT tokens (`Bearer eyJ...`), private keys, and passwords from all log and telemetry streams before reaching the LLM.
- **Zero Public DB Exposure**: PostgreSQL Flexible Server configured with private network boundaries and SSL enforced (`sslmode=require`).
- **Idempotency Guarantees**: Remediations carry UUIDv4 idempotency keys verified against PostgreSQL before any mutating command reaches the Kubernetes API.

---

## 7. Getting Started & Local Verification

### Prerequisites

- **Node.js**: `>= 22.0.0`
- **npm**: `>= 10.0.0`
- **Access**: Kubernetes cluster (or local minikube/k3s) and PostgreSQL database.

### 1. Clone & Configure Environment

```bash
git clone https://github.com/siddiquiabdul007/ai-sre-commander.git
cd ai-sre-commander

# Copy template and supply credentials
cp .env.example .env
```

### 2. Install Dependencies & Build

```bash
# Install workspace dependencies
npm install

# Compile all monorepo packages and microservices
npm run build
```

### 3. Run Automated Test Suites

```bash
# Run unit tests (19/19 passing)
npm test

# Run integration tests (JWKS, Prometheus live, K8s execution)
npm run test:integration

# Run prompt injection security defense tests
node tests/security/prompt-injection.test.js

# Run the 20-step Flagship Golden Incident E2E test
npm run test:e2e
```

### 4. Launch Local Development Services

```bash
# Terminal 1: Launch API Gateway (Port 4000)
npm run dev:api

# Terminal 2: Launch Vite Web Console (Port 3000)
npm run dev:web
```

Open your browser to **`http://localhost:3000`** to access the SRE Control Console.

---

## 8. Repository Layout

```
ai-sre-commander/
├── apps/
│   ├── web/                         # React 19 + TypeScript SRE Control Console
│   └── api/                         # Fastify API Gateway with Entra ID & Rate Limiting
├── services/
│   ├── event-ingestion/             # Normalizes signals from K8s, Prometheus, GitHub
│   ├── incident-engine/             # 10-state incident lifecycle state machine
│   ├── correlation-engine/          # Temporal and causal graph correlation
│   ├── ai-orchestrator/             # Multi-agent coordination, prompt sanitization
│   ├── evidence-service/            # Structured evidence objects & contradiction tracking
│   ├── remediation-engine/          # Typed action planning and risk classification
│   ├── policy-engine/               # Safety rules & environment approval boundaries
│   ├── execution-service/           # Sandboxed Kubernetes API executor with idempotency
│   ├── verification-service/        # Post-action recovery verification via PromQL
│   ├── compliance-service/          # DORA, NIS2, and EU AI Act reporting engines
│   └── notification-service/        # Alert dispatch to Slack, Teams, and webhooks
├── agents/
│   ├── kubernetes/                  # Scoped K8s pod, deployment, and node inspector
│   ├── observability/               # PromQL metric queries and baseline deviation
│   ├── change-intelligence/         # Git commits, deployment diffs, and config shifts
│   └── verification/                # Live post-remediation health verification
├── packages/
│   ├── database/                    # Prisma ORM client and PostgreSQL repository
│   ├── event-schema/                # Unified Event Model & Zod validation schemas
│   ├── auth/                        # Microsoft Entra ID / OIDC RS256 JWKS validator
│   ├── telemetry/                   # Golden signals & Prometheus text exporter
│   ├── api-client/                  # Type-safe client for frontend and CLI
│   └── security/                    # Secret redactor, prompt injection defense, audit hasher
├── infrastructure/
│   ├── terraform/                   # Azure AKS, PostgreSQL, Storage, Key Vault
│   ├── helm/                        # Helm charts for Control Plane & checkout-api demo
│   └── policies/                    # Gatekeeper & Rego safety rules
└── tests/
    ├── unit/                        # Unit tests for domain logic and state transitions
    ├── integration/                 # Adapter tests (Entra ID, Prometheus, K8s, DB)
    ├── e2e/                         # 20-step Golden Incident end-to-end scenario
    └── security/                    # Prompt injection sanitization and RBAC tests
```

---

## 9. Verification & Audit Metrics

The entire control plane has been verified end-to-end against live infrastructure:

| Verification Suite | Target | Status | Passing Tests | Execution Time |
| :--- | :--- | :--- | :--- | :--- |
| **Unit Tests** | Domain Logic & Security Primitives | Passed | 19 / 19 | ~9.7s |
| **Prompt Injection** | Adversarial Telemetry Sanitization | Passed | 7 / 7 | ~0.4s |
| **Auth & JWKS** | Microsoft Entra ID Live Discovery | Passed | 5 / 5 | ~1.1s |
| **Prometheus Live** | In-Cluster PromQL Queries | Passed | 4 / 4 | ~0.8s |
| **K8s Execution** | Scoped ServiceAccount Rollback | Passed | 4 / 4 | ~1.9s |
| **Flagship Golden E2E** | 20-Step Live Disaster & Recovery | Passed | 20 / 20 | ~12.2s |

### Empirical Verification & Operational Proofs

The operational integrity of AI SRE Commander has been validated across real cloud infrastructure, regulatory reporting modules, and end-to-end failure drills:

#### 1. Live AKS Cluster Rollout & Pod Recovery Proof
![Live AKS Cluster Proof](docs/10_Live_AKS_Cluster_Proof.png)
*Live terminal output demonstrating Azure Kubernetes Service deployment rollout history on `checkout-api` (`v1.0.0` ➔ `v1.1.0` ➔ rollback to `v1.0.0`) and running pod states on `aks-aisre-prod` in `centralindia`.*

#### 2. Platform Health & Live Metric Telemetry
![Platform Health SLO Metrics](docs/11_Platform_Health_SLO_Metrics.png)
*Real-time terminal telemetry stream showing continuous Golden Signals, HTTP error rates, container memory working set bytes, and SLO metric calculations.*

#### 3. In-Cluster Prometheus PromQL Query Detail
![Platform Health Metrics Detail](docs/12_Platform_Health_Metrics_Detail.png)
*Raw PromQL metric execution against the in-cluster Prometheus server verifying real-time error rate spikes and latency distributions during incident progression.*

#### 4. Azure PostgreSQL Incident Persistence & Audit Records
![PostgreSQL Incidents and Audit Proof](docs/13_PostgreSQL_Incidents_Audit_Proof.png)
*Direct SQL query verification from Azure Database for PostgreSQL Flexible Server, demonstrating ACID-compliant persistence of incident states, event timelines, and operator audit entries.*

#### 5. NIS2 Article 23 & EU AI Act Article 71 Compliance Output
![NIS2 and EU AI Act Compliance](docs/14_NIS2_EU_AI_Act_Compliance_Reports.png)
*Automated generation of mandatory regulatory reports: NIS2 24-hour early warning notifications and EU AI Act high-risk AI system incident logs with cryptographic verification hashes.*

#### 6. DORA Article 19 Major ICT Incident Report Detail
![DORA Compliance Report Detail](docs/15_DORA_Compliance_Report_Detail.png)
*Complete structured DORA regulatory report including incident classification, economic impact assessment, affected financial services, root cause determination, and remediation timeline.*

#### 7. Comprehensive Automated Test Suite Execution
![Test Suite Execution Overview](docs/16_Test_Suite_Execution_Overview.png)
*Full test runner execution verifying unit tests, integration tests, security guardrails, and compliance modules with 100% pass rates across all workspaces.*

#### 8. Security Hardening & Adversarial Test Verification
![Security Integration Test Verification](docs/17_Security_Integration_Test_Verification.png)
*Automated verification of prompt injection sanitizers, secret redaction filters, rate limiters, and CORS security headers against malicious payloads.*

#### 9. Microsoft Entra ID OIDC Discovery & RS256 JWKS Verification
![Entra ID JWKS Verification](docs/18_Entra_ID_JWKS_RS256_Verification.png)
*Live test verifying dynamic cryptographic discovery and signature validation of 6 active RSA public keys from Microsoft Entra ID tenant endpoint.*

#### 10. Kubernetes Integration Guardrail Diagnostic
![K8s Integration Guardrail Diagnostic](docs/19_K8s_Integration_Guardrail_Diagnostic.png)
*Diagnostic test demonstrating fail-safe behavior: the control plane strictly refuses unverified fallbacks when scoped ServiceAccount tokens are missing, adhering to zero-trust principles.*

#### 11. Flagship 20-Step Live Golden Incident End-to-End Proof
![Flagship 20-Step Live Golden Incident](docs/20_Flagship_20_Step_Live_Golden_Incident.png)
*The crowning validation: automated live execution of the full 20-step incident lifecycle on real Azure AKS — from synthetic failure injection and Gemini RCA to operator approval, live K8s rollback, and WORM audit commitment.*

---

## 10. License & Author

**Author**: Abdul Ahad Siddiqui ([abdulahadsiddiqui888@gmail.com](mailto:abdulahadsiddiqui888@gmail.com))  
**Repository**: [github.com/siddiquiabdul007/ai-sre-commander](https://github.com/siddiquiabdul007/ai-sre-commander)  
**License**: [Apache-2.0](LICENSE)

*Architected for European Cloud Sovereignty, Enterprise Resilience, and Verifiable AI Safety.*
