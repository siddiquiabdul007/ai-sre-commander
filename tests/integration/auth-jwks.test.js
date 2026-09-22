/**
 * Stage 7 Verification Test: Entra ID Real JWKS JWT Validation & Role Mapping
 * 
 * PRD v3.0 §3.5 Acceptance Criteria:
 * - Real RS256 cryptographic JWT verification against live Microsoft Entra ID JWKS endpoint
 * - No in-memory RSA keypair mocks
 * - Verification of real Entra ID JWKS endpoint health and keys
 * - Verification of live token issued by Microsoft Entra ID
 * - Cryptographic rejection of tampered tokens against Microsoft JWKS
 * - Rejection of garbage/missing tokens
 * - Role mapping from Entra ID claims to application roles
 * 
 * Run: node tests/integration/auth-jwks.test.js
 */

import 'dotenv/config';
import { OIDCValidator } from '@ai-sre/auth';
import { execSync } from 'node:child_process';

async function runTest() {
  console.log('=== Stage 7 Verification: Entra ID Real JWKS & Cryptographic JWT Validation ===\n');

  let passed = 0;
  let failed = 0;

  const tenantId = process.env.ENTRA_TENANT_ID || 'd43b9062-c9ab-4d7d-98e9-605b4e69c8b3';
  const clientId = process.env.ENTRA_CLIENT_ID || '46cec45b-968b-42eb-ad50-4176cca056f3';
  const jwksUri = process.env.ENTRA_JWKS_URI || `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

  console.log(`Tenant ID: ${tenantId}`);
  console.log(`Client ID: ${clientId}`);
  console.log(`JWKS URI: ${jwksUri}\n`);

  // Test 1: Live JWKS Endpoint Health Check
  console.log('--- Test 1: Microsoft Entra ID JWKS Endpoint Live Discovery ---');
  try {
    const health = await OIDCValidator.checkJwksHealth(jwksUri);
    if (health.healthy && health.keyCount > 0) {
      console.log(`✓ Live JWKS endpoint reached: discovered ${health.keyCount} active Microsoft RS256 signing keys`);
      passed++;
    } else {
      console.error(`✗ Failed to discover keys from live JWKS endpoint: ${jwksUri}`);
      failed++;
    }
  } catch (err) {
    console.error(`✗ JWKS discovery error: ${err.message}`);
    failed++;
  }

  // Test 2: Live Real Microsoft Entra ID Token Verification
  console.log('\n--- Test 2: Live Microsoft Entra ID RS256 Token Verification ---');
  let liveToken = '';
  try {
    liveToken = execSync(
      `az account get-access-token --tenant "${tenantId}" --query accessToken -o tsv`,
      { encoding: 'utf-8' }
    ).trim();

    const user = await OIDCValidator.validateTokenLive(`Bearer ${liveToken}`, {
      tenantId,
      clientId,
      jwksUri
    });

    console.log(`✓ Live token cryptographically verified against Microsoft JWKS:`);
    console.log(`  User: ${user.name} <${user.email}> (id: ${user.id})`);
    console.log(`  Tenant: ${user.tenantId}`);
    console.log(`  Mapped Roles: ${user.roles.join(', ')}`);
    console.log(`  Token Issuer: ${user.tokenIssuer}`);

    if (user.tenantId === tenantId && user.roles.length > 0) {
      passed++;
    } else {
      console.error('✗ Claim verification failed');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Live token verification failed: ${err.message}`);
    failed++;
  }

  // Test 3: Tampered Token Signature Rejection
  console.log('\n--- Test 3: Cryptographic Rejection of Tampered Token ---');
  try {
    if (!liveToken) throw new Error('No live token available to tamper with');

    const parts = liveToken.split('.');
    // Tamper with payload by modifying a byte
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const modifiedPayload = payloadJson.replace(/"oid":\s*"[^"]+"/, '"oid":"attacker-malicious-id"');
    const tamperedPayloadB64 = Buffer.from(modifiedPayload).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

    let rejected = false;
    try {
      await OIDCValidator.validateTokenLive(`Bearer ${tamperedToken}`, {
        tenantId,
        clientId,
        jwksUri
      });
    } catch (err) {
      rejected = true;
      console.log(`✓ Tampered token rejected: ${err.message}`);
    }

    if (rejected) {
      passed++;
    } else {
      console.error('✗ Tampered token was incorrectly accepted!');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Tamper test failed: ${err.message}`);
    failed++;
  }

  // Test 4: Missing & Malformed Token Rejection
  console.log('\n--- Test 4: Rejection of Missing and Malformed Authorization Headers ---');
  try {
    let missingHeaderCaught = false;
    try {
      await OIDCValidator.validateTokenLive(undefined);
    } catch (err) {
      missingHeaderCaught = true;
      console.log(`✓ Missing header rejected: ${err.message}`);
    }

    let malformedHeaderCaught = false;
    try {
      await OIDCValidator.validateTokenLive('NotBearer abc123def456');
    } catch (err) {
      malformedHeaderCaught = true;
      console.log(`✓ Malformed header rejected: ${err.message}`);
    }

    let garbageTokenCaught = false;
    try {
      await OIDCValidator.validateTokenLive('Bearer garbage.jwt.token');
    } catch (err) {
      garbageTokenCaught = true;
      console.log(`✓ Garbage token rejected: ${err.message}`);
    }

    if (missingHeaderCaught && malformedHeaderCaught && garbageTokenCaught) {
      passed++;
    } else {
      console.error('✗ Missing/malformed rejection failed');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Malformed header test failed: ${err.message}`);
    failed++;
  }

  // Test 5: Role Mapping Verification
  console.log('\n--- Test 5: Role Mapping Determinism ---');
  try {
    const adminRoles = OIDCValidator.mapEntraRoles(['Platform-Admin']);
    const sreRoles = OIDCValidator.mapEntraRoles(['SRE-Operator']);
    const devRoles = OIDCValidator.mapEntraRoles(['Developer']);
    const auditRoles = OIDCValidator.mapEntraRoles(['Compliance-Auditor']);

    const adminOk = adminRoles.includes('platform_admin') && adminRoles.includes('sre');
    const sreOk = sreRoles.includes('sre');
    const devOk = devRoles.includes('developer');
    const auditOk = auditRoles.includes('auditor');

    if (adminOk && sreOk && devOk && auditOk) {
      console.log(`✓ Roles mapped properly across all security personas`);
      passed++;
    } else {
      console.error('✗ Role mapping logic failed');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Role mapping test failed: ${err.message}`);
    failed++;
  }

  // Summary
  console.log('\n========================================');
  console.log(`Stage 7 Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
