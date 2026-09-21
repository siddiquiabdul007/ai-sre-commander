#!/bin/bash
# cluster-setup.sh — One-time bootstrap for the AKS sandbox cluster
# PRD v2.0 §3.2: Sandboxed, resettable demo cluster
#
# This script:
# 1. Gets AKS credentials
# 2. Creates the sre-demo namespace
# 3. Installs Prometheus via Helm (kube-prometheus-stack)
# 4. Creates scoped service accounts (read-only + execution)
# 5. Deploys checkout-api v1.0.0 (healthy baseline)

set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-aisre-prod-centralindia}"
CLUSTER_NAME="${CLUSTER_NAME:-aks-aisre-prod}"
NAMESPACE="${K8S_NAMESPACE:-sre-demo}"

echo "=== AI SRE Commander — Cluster Setup ==="
echo "Resource Group: $RESOURCE_GROUP"
echo "Cluster: $CLUSTER_NAME"
echo "Namespace: $NAMESPACE"
echo ""

# 1. Get AKS credentials
echo "[1/5] Getting AKS credentials..."
az aks get-credentials --resource-group "$RESOURCE_GROUP" --name "$CLUSTER_NAME" --overwrite-existing
kubectl cluster-info
echo ""

# 2. Create namespace
echo "[2/5] Creating namespace '$NAMESPACE'..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
echo ""

# 3. Install Prometheus (lightweight — just what we need for metrics scraping)
echo "[3/5] Installing Prometheus via Helm..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo update
helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --set grafana.enabled=false \
  --set alertmanager.enabled=true \
  --set prometheus.prometheusSpec.retention=2d \
  --set prometheus.prometheusSpec.resources.requests.memory=256Mi \
  --set prometheus.prometheusSpec.resources.requests.cpu=100m \
  --set prometheus.prometheusSpec.resources.limits.memory=512Mi \
  --set prometheus.prometheusSpec.resources.limits.cpu=500m \
  --wait --timeout 5m
echo ""

# 4. Create service accounts with scoped RBAC
echo "[4/5] Creating service accounts with RBAC..."

# Read-only service account for investigation agents
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sre-reader
  namespace: $NAMESPACE
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sre-reader-role
  namespace: $NAMESPACE
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "events", "services", "configmaps", "endpoints"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sre-reader-binding
  namespace: $NAMESPACE
subjects:
  - kind: ServiceAccount
    name: sre-reader
    namespace: $NAMESPACE
roleRef:
  kind: Role
  name: sre-reader-role
  apiGroup: rbac.authorization.k8s.io
EOF

# Execution service account — narrowly scoped for rollback/restart
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sre-executor
  namespace: $NAMESPACE
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sre-executor-role
  namespace: $NAMESPACE
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "delete"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch", "update"]
  - apiGroups: ["apps"]
    resources: ["deployments/rollback"]
    verbs: ["create"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sre-executor-binding
  namespace: $NAMESPACE
subjects:
  - kind: ServiceAccount
    name: sre-executor
    namespace: $NAMESPACE
roleRef:
  kind: Role
  name: sre-executor-role
  apiGroup: rbac.authorization.k8s.io
EOF
echo ""

# 5. Deploy checkout-api v1.0.0 (healthy baseline)
echo "[5/5] Deploying checkout-api v1.0.0 (healthy baseline)..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout-api
  namespace: $NAMESPACE
  labels:
    app: checkout-api
    version: v1.0.0
  annotations:
    kubernetes.io/change-cause: "Initial healthy deployment v1.0.0"
spec:
  replicas: 2
  selector:
    matchLabels:
      app: checkout-api
  template:
    metadata:
      labels:
        app: checkout-api
        version: v1.0.0
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
    spec:
      containers:
        - name: checkout-api
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
              name: http
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 3
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: checkout-api
  namespace: $NAMESPACE
  labels:
    app: checkout-api
spec:
  selector:
    app: checkout-api
  ports:
    - port: 80
      targetPort: 80
      name: http
  type: ClusterIP
EOF

echo ""
echo "Waiting for checkout-api pods to be ready..."
kubectl rollout status deployment/checkout-api -n "$NAMESPACE" --timeout=120s
echo ""

# Print verification
echo "=== Setup Complete ==="
echo ""
kubectl get nodes
echo ""
kubectl get pods -n "$NAMESPACE"
echo ""
kubectl get pods -n monitoring | head -10
echo ""
echo "Prometheus URL: http://$(kubectl get svc -n monitoring prometheus-kube-prometheus-prometheus -o jsonpath='{.spec.clusterIP}'):9090"
echo ""
echo "Done! Cluster is ready for AI SRE Commander."
