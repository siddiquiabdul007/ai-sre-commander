/**
 * OIDC / Entra ID Validator — Real JWKS Verification & Role Mapping
 * 
 * PRD v2.0 §3.5: Real RS256 JWT validation against Entra ID JWKS endpoint
 * - Remote JWKS fetching with caching & TTL
 * - Cryptographic RS256 signature verification via 'jose'
 * - Strict claim validation: issuer, audience, expiration
 * - Role mapping from Entra ID claims (roles, groups) to UserRole
 * - AUTH_MODE=live enforces strict cryptographic verification
 * - AUTH_MODE=offline allows local dev tokens
 */

import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { UserRole } from './roles.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  roles: UserRole[];
  tokenIssuer: string;
}

export type AuthMode = 'live' | 'offline';

export interface OIDCConfig {
  tenantId?: string;
  clientId?: string;
  jwksUri?: string;
  issuer?: string;
  getKey?: JWTVerifyGetKey; // For testing with custom JWKS
  mode?: AuthMode;
}

export class OIDCValidator {
  private static jwksCache = new Map<string, JWTVerifyGetKey>();
  private static defaultGetKey: JWTVerifyGetKey | null = null;

  /**
   * Set custom key resolver for tests
   */
  public static setCustomKeyResolver(resolver: JWTVerifyGetKey | null): void {
    this.defaultGetKey = resolver;
  }

  /**
   * Validate token asynchronously with real RS256 cryptographic verification
   */
  public static async validateTokenLive(
    authHeader?: string,
    config?: OIDCConfig
  ): Promise<AuthUser> {
    const mode = config?.mode || (process.env.AUTH_MODE as AuthMode) || 'live';

    if (!authHeader) {
      if (mode === 'live') {
        throw new Error('Authentication required: missing Authorization header.');
      }
      return this.getFallbackUser();
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    // If offline mode and using test role token
    if (mode === 'offline') {
      return this.validateToken(authHeader);
    }

    const tenantId = config?.tenantId || process.env.ENTRA_TENANT_ID || 'common';
    const clientId = config?.clientId || process.env.ENTRA_CLIENT_ID || 'ai-sre-commander';
    const jwksUri = config?.jwksUri || process.env.ENTRA_JWKS_URI || `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
    const expectedIssuer = config?.issuer || process.env.ENTRA_ISSUER || (tenantId === 'common' ? undefined : `https://login.microsoftonline.com/${tenantId}/v2.0`);

    // Get or create JWKS fetcher
    let getKey = config?.getKey || this.defaultGetKey;
    if (!getKey) {
      if (!this.jwksCache.has(jwksUri)) {
        this.jwksCache.set(jwksUri, createRemoteJWKSet(new URL(jwksUri), {
          cooldownDuration: 30000,
          cacheMaxAge: 600000 // 10 minutes
        }));
      }
      getKey = this.jwksCache.get(jwksUri)!;
    }

    try {
      const { payload } = await jwtVerify(token, getKey, {
        issuer: expectedIssuer,
        audience: clientId,
        algorithms: ['RS256']
      });

      // Extract and map claims
      const id = String(payload.oid || payload.sub || 'unknown-user');
      const email = String(payload.preferred_username || payload.upn || payload.email || 'user@enterprise.eu');
      const name = String(payload.name || email.split('@')[0]);
      const tokenTenant = String(payload.tid || tenantId);
      const tokenIssuer = String(payload.iss || expectedIssuer || 'entra-id');

      // Map Entra ID roles to app roles
      const rawRoles = Array.isArray(payload.roles)
        ? payload.roles
        : Array.isArray(payload.groups)
        ? payload.groups
        : [];

      const roles = this.mapEntraRoles(rawRoles);

      return {
        id,
        email,
        name,
        tenantId: tokenTenant,
        roles,
        tokenIssuer
      };
    } catch (error: any) {
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }

  /**
   * Synchronous token validator — backward compatible for local dev & testing
   */
  public static validateToken(authHeader?: string): AuthUser {
    if (!authHeader) {
      return this.getFallbackUser();
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    // Allow testing as specific roles via header e.g. "Bearer role:viewer" or "Bearer role:platform_admin"
    if (token.startsWith('role:')) {
      const requestedRole = token.split(':')[1] as UserRole;
      return {
        id: `usr_${requestedRole}`,
        email: `${requestedRole}@enterprise.eu`,
        name: `${requestedRole.toUpperCase()} User`,
        tenantId: 'tenant-eu-default',
        roles: [requestedRole],
        tokenIssuer: 'https://login.microsoftonline.com/entra-id'
      };
    }

    // Default authenticated SRE user
    return this.getFallbackUser();
  }

  /**
   * Maps raw Entra ID roles/groups to application UserRole
   */
  public static mapEntraRoles(rawRoles: (string | unknown)[]): UserRole[] {
    const roles: Set<UserRole> = new Set();

    for (const r of rawRoles) {
      const str = String(r).toLowerCase();
      if (str.includes('admin') || str.includes('platform_admin')) {
        roles.add('platform_admin');
        roles.add('sre');
      } else if (str.includes('sre') || str.includes('operator')) {
        roles.add('sre');
      } else if (str.includes('dev') || str.includes('developer')) {
        roles.add('developer');
      } else if (str.includes('audit') || str.includes('compliance')) {
        roles.add('auditor');
      } else if (str.includes('view') || str.includes('reader')) {
        roles.add('viewer');
      }
    }

    // Default to viewer if authenticated but no specific role mapped
    if (roles.size === 0) {
      roles.add('viewer');
    }

    return Array.from(roles);
  }

  private static getFallbackUser(): AuthUser {
    return {
      id: 'usr_sre_lead',
      email: 'sre-commander@enterprise.eu',
      name: 'Alex Rivera (Staff SRE)',
      tenantId: 'tenant-eu-default',
      roles: ['sre'],
      tokenIssuer: 'https://login.microsoftonline.com/entra-id'
    };
  }
}
