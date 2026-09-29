# Azure Cloud Recreation & Load Testing Guide

> **Document Identifier**: `ENG-OPS-AZURE-RECREATE-2026-09`  
> **Version**: `1.0.0`  
> **Target Cloud**: Microsoft Azure (Region: `centralindia` / Primary EU Failover: `westeurope`)  
> **Purpose**: Complete reference guide and runbook to recreate all Azure cloud infrastructure, deploy live microservices, configure real-time traffic load generators, run drills, and tear down resources to eliminate billing.

---

## 1. Executive Summary & Cost Profile

All cloud resources for **AI SRE Commander** are isolated within a dedicated Azure Resource Group:
`rg-aisre-prod-centralindia`

When testing or demonstrations are completed, deleting this resource group stops all Azure billing immediately. This document preserves the exact specification and automated runbooks to recreate the exact environment in ~10 minutes.

### Resource Inventory & Cost-Effective SKUs

| Resource | Azure Name | SKU / Sizing | Purpose | Monthly Cost Est. |
|:---|:---|:---|:---|:---:|
| **Azure Kubernetes Service (AKS)** | `aks-aisre-prod` | 2x `Standard_B2s` (Linux) | Real workload runtime, Prometheus, and traffic load | ~$35/mo |
| **PostgreSQL Flexible Server** | `pg-aisre-prod-1iem4s` | `Standard_B1ms` (1 vCore, 2GB RAM, 32GB SSD) | ACID incident state, distributed locks, audit ledger | ~$14/mo |
| **Azure Storage Account** | `saaisre1iem4s` | Standard LRS | WORM immutable audit ledger container (`audit-evidence`) | ~$1/mo |
| **Azure Container Registry** | `acraisreprod1iem4s` | Basic | Container image hosting | ~$5/mo |
| **Azure Key Vault** | `kv-aisre-1iem4s` | Standard | Cryptographic keys and OIDC tenant secrets | <$1/mo |
| **Log Analytics Workspace** | `law-aisre-prod-1iem4s` | Per-GB (ContainerInsights) | In-cluster diagnostic logs | <$2/mo |
| **Virtual Network** | `vnet-aisre-prod` | `10.0.0.0/16` (aks-subnet: `10.0.1.0/24`) | Isolated private cluster networking | Free |

---

## 2. Infrastructure Recreation (Step-by-Step)

### Option A: Automated Provisioning via Terraform (Recommended)

The repository contains complete Terraform definitions under [`infrastructure/terraform`](file:///Users/ahad/EU%20SAAS/ai-sre-commander/infrastructure/terraform):

```bash
# 1. Authenticate with Azure CLI
az login

# 2. Navigate to Terraform workspace
cd infrastructure/terraform

# 3. Initialize and apply configuration
terraform init
terraform apply -auto-approve

# 4. Extract generated connection strings and endpoints
terraform output
```

### Option B: Quick CLI Provisioning Script

If you prefer using the Azure CLI directly without Terraform:

```bash
# Set variables
export RG="rg-aisre-prod-centralindia"
export LOC="centralindia"
export SUFFIX="1iem4s"
export AKS_NAME="aks-aisre-prod"
export PG_SERVER="pg-aisre-prod-${SUFFIX}"
export SA_NAME="saaisre${SUFFIX}"
export DB_USER="sreadmin"
export DB_PASS="SreSecurePass2026!"

# 1. Create Resource Group
az group create --name "$RG" --location "$LOC"

# 2. Create Storage Account with WORM container
az storage account create --name "$SA_NAME" --resource-group "$RG" --location "$LOC" --sku Standard_LRS --kind StorageV2
export STORAGE_KEY=$(az storage account keys list -g "$RG" -n "$SA_NAME" --query "[0].value" -o tsv)
az storage container create --name "audit-evidence" --account-name "$SA_NAME" --account-key "$STORAGE_KEY"

# 3. Create Azure PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group "$RG" \
  --name "$PG_SERVER" \
  --location "$LOC" \
  --admin-user "$DB_USER" \
  --admin-password "$DB_PASS" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --yes

# Allow Azure services and local dev IP access to PostgreSQL
az postgres flexible-server firewall-rule create \
  --resource-group "$RG" \
  --name "$PG_SERVER" \
  --rule-name "AllowAllAzureIPs" \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0

az postgres flexible-server firewall-rule create \
  --resource-group "$RG" \
  --name "$PG_SERVER" \
  --rule-name "AllowLocalDev" \
  --start-ip-address 0.0.0.0 --end-ip-address 255.255.255.255

# Create database
az postgres flexible-server db create \
  --resource-group "$RG" \
  --server-name "$PG_SERVER" \
  --database-name "aisre_prod"

# 4. Create Cost-Effective AKS Cluster
az aks create \
  --resource-group "$RG" \
  --name "$AKS_NAME" \
  --node-count 2 \
  --node-vm-size Standard_B2s \
  --os-sku Ubuntu \
  --enable-managed-identity \
  --generate-ssh-keys \
  --yes
```

---

## 3. Kubernetes Cluster Bootstrap & Telemetry Setup

Once the AKS cluster is provisioned, execute [`scripts/cluster-setup.sh`](file:///Users/ahad/EU%20SAAS/ai-sre-commander/scripts/cluster-setup.sh):

```bash
# 1. Fetch AKS credentials
az aks get-credentials --resource-group rg-aisre-prod-centralindia --name aks-aisre-prod --overwrite-existing

# 2. Run the automated bootstrap script
bash scripts/cluster-setup.sh
```

### What `cluster-setup.sh` Configures:
1. **Namespace**: Creates `sre-demo` and `monitoring`.
2. **Prometheus Stack**: Installs Prometheus via Helm (`kube-prometheus-stack`) in `monitoring` with 2-day metrics retention.
3. **Scoped ServiceAccounts**:
   * `sre-reader`: Read-only access to Pods, Deployments, ReplicaSets, Logs, Events, and Services.
   * `sre-executor`: Narrowly scoped execution role permitting patch/delete on Deployments and Pods only.
4. **ServiceAccount Token Generation**: Exports long-lived JWT tokens into `sre-reader-token` and `sre-executor-token` secrets.

---

## 4. Deploying Live Workloads & Real In-Cluster Load Generator

Deploy the complete microservice and load generator manifest:
[`infrastructure/kubernetes/real-workload.yaml`](file:///Users/ahad/EU%20SAAS/ai-sre-commander/infrastructure/kubernetes/real-workload.yaml)

```bash
kubectl apply -f infrastructure/kubernetes/real-workload.yaml
```

### 1. `checkout-api` Microservice
* Running in `sre-demo` namespace with 2 replicas.
* Endpoints:
  * `/health`: Returns JSON status (`UP`, current version, memory RSS).
  * `/metrics`: Exposes Prometheus scrapable metrics (`http_requests_total`, `process_resident_memory_bytes`, `nodejs_heap_size_used_bytes`).
  * `/api/checkout`: Business transaction handler with dynamic chaos mode switch.
  * `/api/chaos/inject`: Dynamic failure injection (e.g. `memory_leak`, `error_spike`).
  * `/api/chaos/reset`: Dynamic recovery reset.

### 2. `traffic-generator` Real In-Cluster Load Generator
* Runs continuously as a separate in-cluster Deployment.
* Continuously issues HTTP POST requests against `http://checkout-api.sre-demo.svc.cluster.local/api/checkout`.
* Emits real-time traffic statistics every 5 seconds in its pod logs:
  ```
  [LiveTraffic] Total: 50 | 200 OK: 50 | 5xx Errors: 0 (0.0%) | Avg Latency: 1ms
  ```

### How to Tune Traffic Load:
To change the traffic generation rate or concurrency:
```bash
# Increase traffic to 50 Requests Per Second (RPS)
kubectl set env deployment/traffic-generator -n sre-demo RPS=50

# Scale load generator to 3 worker pods (150 RPS total)
kubectl scale deployment/traffic-generator -n sre-demo --replicas=3

# View live traffic logs
kubectl logs -n sre-demo deployment/traffic-generator -f
```

---

## 5. Local Environment Configuration (`.env`)

Update your local `.env` file with the newly provisioned credentials:

```ini
# Environment
NODE_ENV=production
PORT=4000
VITE_API_URL=http://localhost:4000

# Azure Database
DATABASE_URL="postgresql://sreadmin:SreSecurePass2026!@pg-aisre-prod-1iem4s.postgres.database.azure.com:5432/aisre_prod?sslmode=require"

# Azure Blob WORM Storage
AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=saaisre1iem4s;AccountKey=<STORAGE_KEY>;EndpointSuffix=core.windows.net"
AZURE_STORAGE_CONTAINER="audit-evidence"

# Prometheus
PROMETHEUS_URL="http://localhost:9090"

# Kubernetes Scoped Tokens (Extracted from cluster)
K8S_CLUSTER_URL="https://<YOUR_AKS_FQDN>:443"
K8S_NAMESPACE="sre-demo"
K8S_READER_TOKEN="<EXTRACTED_SRE_READER_TOKEN>"
K8S_EXECUTOR_TOKEN="<EXTRACTED_SRE_EXECUTOR_TOKEN>"

# Google Gemini API
GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
```

### Apply Database Schema:
```bash
npx prisma db push --schema=packages/database/prisma/schema.prisma
```

---

## 6. Running Live Tests & Drills

### 1. Start Prometheus Port-Forward (Background)
```bash
kubectl port-forward svc/prometheus-kube-prometheus-prometheus -n monitoring 9090:9090 &
```

### 2. Execute End-to-End Live Fault & Recovery Drill
Execute the automated drill:
```bash
node --env-file=.env scripts/run-live-azure-drill.js
```

**What the Drill Validates**:
1. Confirms real baseline traffic from `traffic-generator` (0% errors).
2. Injects real 5xx fault into `checkout-api` on AKS (`APP_VERSION=v1.1.0-buggy`).
3. Observes real failure spike (~70–80% 5xx errors) on the traffic stream.
4. Gathers live telemetry from AKS pod cgroups and Prometheus metrics.
5. Invokes Google Gemini 3.1 Flash-Lite for causal root cause analysis.
6. Evaluates deterministic policy and validates SRE Lead RS256 authorization.
7. Executes real Kubernetes rollback via scoped `sre-executor` ServiceAccount.
8. Monitors live traffic generator until errors drop back to **0.0% (100% 200 OK)**.
9. Publishes postmortem and records WORM audit ledger in Azure Blob Storage.

### 3. Acceptance Safety Suite
```bash
node --env-file=.env --test tests/integration/residual-safety.test.js
```

---

## 7. Decommissioning & Stopping Azure Billing

When you are done testing, run this single command to delete all created resources and completely stop billing:

```bash
az group delete --name rg-aisre-prod-centralindia --yes --no-wait
```

### What this Deletes:
* The AKS cluster and all node VMs (stops VM compute billing).
* The AKS managed resource group `MC_rg-aisre-prod-centralindia_aks-aisre-prod_centralindia` (automatically cleaned up by Azure).
* The Azure PostgreSQL Flexible Server instance.
* The Azure Storage Account.
* The Container Registry, Key Vault, and Log Analytics Workspace.
