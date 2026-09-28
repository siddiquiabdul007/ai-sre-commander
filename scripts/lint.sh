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

echo "=== [CI Gate 4] Trust Boundary Type-Safety Gate (R9) ==="
# Check that no 'catch (.*: any)' exists in execution-service, policy-engine, remediation-engine
if grep -rnE "catch\s*\([a-zA-Z0-9_]+\s*:\s*any\)" services/execution-service/src/ services/policy-engine/src/ services/remediation-engine/src/; then
  echo "FAIL: AT-TYPE-01: Prohibited 'catch (error: any)' found at service boundary! Use 'catch (error: unknown)' + asError()."
  exit 1
fi

echo "✓ All static safety invariant and trust boundary checks passed."
echo "=== CI Quality Gates Successfully Completed ==="
