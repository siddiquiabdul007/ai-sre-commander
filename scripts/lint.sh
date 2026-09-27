#!/usr/bin/env bash
set -euo pipefail

echo "=== [CI Gate 1] TypeScript Static Typecheck ==="
npx tsc --noEmit
echo "✓ Root & backend TypeScript static analysis passed."

echo "=== [CI Gate 2] Web Console Typecheck & Production Build ==="
npm run build --workspace=apps/web
echo "✓ Frontend typecheck and build passed."

echo "=== [CI Gate 3] Static Analysis & Safety Invariants ==="
# Check that no hardcoded rollback fallback images exist in execution service
if grep -rn "nginx:1.20" services/execution-service/src/; then
  echo "FAIL: Forbidden hardcoded rollback image fallback found!"
  exit 1
fi

# Check that IncidentRepository does not silently use in-memory store without DB warning
if ! grep -rn "PrismaIncidentRepository" services/incident-engine/src/repository.ts > /dev/null; then
  echo "FAIL: IncidentRepository lacks Prisma backing!"
  exit 1
fi

echo "✓ All static safety invariant checks passed."
echo "=== CI Quality Gates Successfully Completed ==="
