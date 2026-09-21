#!/bin/bash
# cluster-reset.sh — Idempotent reset of the demo namespace
# PRD v2.0 §4: "Build the reset mechanism before wiring the execution adapter"
#
# This script:
# 1. Deletes the sre-demo namespace (if exists)
# 2. Recreates it
# 3. Redeploys checkout-api v1.0.0 (healthy baseline)
# 4. Waits for pods ready
# 5. Prints verification output

set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-sre-demo}"

echo "=== AI SRE Commander — Cluster Reset ==="
echo "Namespace: $NAMESPACE"
echo ""

# 1. Delete namespace (idempotent)
echo "[1/4] Deleting namespace '$NAMESPACE' (if exists)..."
kubectl delete namespace "$NAMESPACE" --ignore-not-found --wait=true --timeout=60s
echo ""

# 2. Recreate namespace
echo "[2/4] Creating fresh namespace '$NAMESPACE'..."
kubectl create namespace "$NAMESPACE"
echo ""

# 3. Recreate RBAC
echo "[3/4] Recreating service accounts and RBAC..."
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sre-reader
  namespace: $NAMESPACE
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sre-executor
  namespace: $NAMESPACE
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sre-reader-role
  namespace: $NAMESPACE
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "events", "services", "configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
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

# 4. Deploy checkout-api v1.0.0 (healthy)
echo "[4/4] Deploying checkout-api v1.0.0 (healthy baseline)..."
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
    kubernetes.io/change-cause: "Reset: healthy deployment v1.0.0"
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
echo "Waiting for pods to be ready..."
kubectl rollout status deployment/checkout-api -n "$NAMESPACE" --timeout=120s
echo ""

# Verification
echo "=== Reset Complete ==="
kubectl get pods -n "$NAMESPACE"
kubectl get svc -n "$NAMESPACE"
echo ""
echo "checkout-api rollout history:"
kubectl rollout history deployment/checkout-api -n "$NAMESPACE"
echo ""
echo "Cluster reset to clean baseline. Ready for demo."
