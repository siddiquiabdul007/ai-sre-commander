import { z } from 'zod';

export const UserRoleEnum = z.enum([
  'viewer',
  'developer',
  'sre',
  'platform_admin',
  'auditor'
]);
export type UserRole = z.infer<typeof UserRoleEnum>;

export const PermissionEnum = z.enum([
  'incident:read',
  'incident:create',
  'incident:investigate',
  'remediation:propose',
  'remediation:approve_low',
  'remediation:approve_high',
  'remediation:execute',
  'policy:read',
  'policy:write',
  'audit:read',
  'audit:export',
  'slo:manage'
]);
export type Permission = z.infer<typeof PermissionEnum>;

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  viewer: [
    'incident:read',
    'policy:read'
  ],
  developer: [
    'incident:read',
    'incident:investigate',
    'remediation:propose',
    'policy:read'
  ],
  sre: [
    'incident:read',
    'incident:create',
    'incident:investigate',
    'remediation:propose',
    'remediation:approve_low',
    'remediation:approve_high',
    'remediation:execute',
    'policy:read',
    'audit:read',
    'slo:manage'
  ],
  platform_admin: [
    'incident:read',
    'incident:create',
    'incident:investigate',
    'remediation:propose',
    'remediation:approve_low',
    'remediation:approve_high',
    'remediation:execute',
    'policy:read',
    'policy:write',
    'audit:read',
    'audit:export',
    'slo:manage'
  ],
  auditor: [
    'incident:read',
    'policy:read',
    'audit:read',
    'audit:export'
  ]
};

export function hasPermission(role: UserRole, requiredPermission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(requiredPermission);
}

export function canApproveRisk(role: UserRole, risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): boolean {
  if (risk === 'LOW') {
    return hasPermission(role, 'remediation:approve_low');
  }
  if (risk === 'MEDIUM' || risk === 'HIGH') {
    return hasPermission(role, 'remediation:approve_high');
  }
  if (risk === 'CRITICAL') {
    return role === 'platform_admin';
  }
  return false;
}
