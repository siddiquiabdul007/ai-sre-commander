/**
 * Stage 7 Verification Test: Entra ID Real JWKS JWT Validation & Role Mapping
 * 
 * PRD v2.0 §3.5 Acceptance Criteria:
 * - Real RS256 cryptographic JWT verification via 'jose'
 * - Role mapping from Entra ID claims (roles, groups)
 * - Cryptographic rejection of tampered tokens
 * - Rejection of expired tokens
 * - Rejection of wrong-audience tokens
 * - AUTH_MODE=live enforcement
 * 
 * Run: node tests/integration/auth-jwks.test.js
 */

import { OIDCValidator } from '@ai-sre/auth';
import { generateKeyPair, SignJWT, exportJWK } from 'jose';

async function runTest() {
  console.log('=== Stage 7 Verification: Entra ID Real JWKS & Cryptographic JWT Validation ===\n');

  let passed = 0;
  let failed = 0;

  // 1. Generate an RS256 keypair representing Entra ID signing key
  const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'entra-key-2026-01';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  // Custom key resolver that returns our test public key
  const customKeyResolver = async () => publicKey;

  const config = {
    clientId: 'ai-sre-commander',
    issuer: 'https://login.microsoftonline.com/tenant-123/v2.0',
    getKey: customKeyResolver,
    mode: 'live'
  };

  // Test 1: Valid RS256 Token
  console.log('--- Test 1: Valid RS256 Signed JWT with Entra ID Claims ---');
  try {
    const validJwt = await new SignJWT({
      oid: 'usr-aad-8899',
      preferred_username: 'alex.rivera@enterprise.eu',
      name: 'Alex Rivera',
      tid: 'tenant-123',
      roles: ['SRE-Lead', 'Platform-Admin']
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'entra-key-2026-01' })
      .setIssuedAt()
      .setIssuer('https://login.microsoftonline.com/tenant-123/v2.0')
      .setAudience('ai-sre-commander')
      .setExpirationTime('1h')
      .sign(privateKey);

    const user = await OIDCValidator.validateTokenLive(`Bearer ${validJwt}`, config);

    console.log(`✓ Token verified cryptographically via RS256:`);
    console.log(`  User: ${user.name} <${user.email}> (id: ${user.id})`);
    console.log(`  Roles mapped: ${user.roles.join(', ')}`);
    console.log(`  Tenant: ${user.tenantId}`);

    if (user.roles.includes('sre') && user.roles.includes('platform_admin')) {
      passed++;
    } else {
      console.error('✗ Roles not mapped correctly');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Valid token failed: ${err.message}`);
    failed++;
  }

  // Test 2: Tampered Token Signature
  console.log('\n--- Test 2: Cryptographic Rejection of Tampered Token ---');
  try {
    const validJwt = await new SignJWT({
      oid: 'usr-tamper',
      preferred_username: 'attacker@evil.com',
      roles: ['platform_admin']
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer('https://login.microsoftonline.com/tenant-123/v2.0')
      .setAudience('ai-sre-commander')
      .setExpirationTime('1h')
      .sign(privateKey);

    // Tamper with the token body (flip characters in payload)
    const parts = validJwt.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({
      oid: 'usr-attacker',
      preferred_username: 'superadmin@evil.com',
      roles: ['platform_admin']
    })).toString('base64url');

    const tamperedJwt = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    let caught = false;
    try {
      await OIDCValidator.validateTokenLive(`Bearer ${tamperedJwt}`, config);
    } catch (err) {
      caught = true;
      console.log(`✓ Tampered signature rejected: ${err.message}`);
    }

    if (caught) {
      passed++;
    } else {
      console.error('✗ Tampered token was accepted!');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Test error: ${err.message}`);
    failed++;
  }

  // Test 3: Expired Token
  console.log('\n--- Test 3: Rejection of Expired Token ---');
  try {
    const expiredJwt = await new SignJWT({
      oid: 'usr-expired',
      preferred_username: 'old.session@enterprise.eu'
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2 hours ago
      .setIssuer('https://login.microsoftonline.com/tenant-123/v2.0')
      .setAudience('ai-sre-commander')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1 hour ago
      .sign(privateKey);

    let caught = false;
    try {
      await OIDCValidator.validateTokenLive(`Bearer ${expiredJwt}`, config);
    } catch (err) {
      caught = true;
      console.log(`✓ Expired token rejected: ${err.message}`);
    }

    if (caught) {
      passed++;
    } else {
      console.error('✗ Expired token was accepted!');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Test error: ${err.message}`);
    failed++;
  }

  // Test 4: Wrong Audience
  console.log('\n--- Test 4: Rejection of Wrong Audience ---');
  try {
    const wrongAudJwt = await new SignJWT({
      oid: 'usr-wrong-aud',
      preferred_username: 'user@other-app.eu'
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer('https://login.microsoftonline.com/tenant-123/v2.0')
      .setAudience('another-service-not-sre') // WRONG AUDIENCE
      .setExpirationTime('1h')
      .sign(privateKey);

    let caught = false;
    try {
      await OIDCValidator.validateTokenLive(`Bearer ${wrongAudJwt}`, config);
    } catch (err) {
      caught = true;
      console.log(`✓ Wrong audience rejected: ${err.message}`);
    }

    if (caught) {
      passed++;
    } else {
      console.error('✗ Wrong audience token was accepted!');
      failed++;
    }
  } catch (err) {
    console.error(`✗ Test error: ${err.message}`);
    failed++;
  }

  // Test 5: Role Mapping Translation
  console.log('\n--- Test 5: Entra ID Group/Role Translation ---');
  const roleTestCases = [
    { input: ['SecOps-Compliance-Auditor'], expected: 'auditor' },
    { input: ['Backend-Developers'], expected: 'developer' },
    { input: ['Read-Only-Dashboard-Viewer'], expected: 'viewer' },
    { input: ['Global-SRE-Operator'], expected: 'sre' }
  ];

  let roleMappingSuccess = true;
  for (const tc of roleTestCases) {
    const mapped = OIDCValidator.mapEntraRoles(tc.input);
    if (!mapped.includes(tc.expected)) {
      console.error(`✗ Mapping failed for ${tc.input}: expected ${tc.expected}, got ${mapped.join(',')}`);
      roleMappingSuccess = false;
    } else {
      console.log(`  ✓ ${tc.input[0]} -> [${mapped.join(', ')}]`);
    }
  }

  if (roleMappingSuccess) {
    console.log('✓ All Entra ID roles translated correctly to domain permissions');
    passed++;
  } else {
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
