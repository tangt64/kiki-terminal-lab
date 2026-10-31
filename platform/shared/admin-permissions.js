// Console admission is not authority to mutate accounts or read deployment secrets.
export const ADMIN_PERMISSIONS = new Set(['admin:access','admin:all','admin:users','admin:cloud','admin:platform','admin:ops','admin:templates','admin:marketing','admin:messages','admin:monitor']);

export function normalizePermissions(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { value = []; }
  }
  return [...new Set((Array.isArray(value) ? value : []).map(item => String(item).trim().toLowerCase()).filter(item => ADMIN_PERMISSIONS.has(item)))];
}
export function isAdministratorRole(role) { return ['admin','administrator','관리자'].includes(String(role || '').trim().toLowerCase()); }
export function userPermissions(user) { return normalizePermissions(user?.adminPermissions ?? user?.admin_permissions ?? user?.adminPermissionsJson ?? user?.admin_permissions_json); }
export function isFullAdministrator(user) { return isAdministratorRole(user?.role) || userPermissions(user).includes('admin:all'); }
export function hasAdminPermission(user, permission) { return isFullAdministrator(user) || userPermissions(user).includes(permission); }
export function isPrivilegedAccount(user) { return isAdministratorRole(user?.role) || userPermissions(user).length > 0; }

const DOMAIN_RULES = [
  [/^\/(?:api\/)?admin\/(?:users|password-reset-pins)(?:\/|$)/, 'admin:users'],
  [/^\/api\/admin\/(?:cloud-console|self-service[^/]*|load-balancers?|zun[^/]*|magnum[^/]*|trove[^/]*|internal-image[^/]*|image-mirror[^/]*|resource-deletion-jobs|custom-lab-requests)(?:\/|$)/, 'admin:cloud'],
  [/^\/api\/admin\/(?:instance-monitor|security-inspection|access-logs|access-stats)(?:\/|$)/, 'admin:monitor'],
  [/^\/api\/admin\/(?:platform-status|terms|notices|llm[^/]*)(?:\/|$)/, 'admin:platform'],
  [/^\/api\/admin\/(?:heat-templates|application-yamls|cloud-init-templates)(?:\/|$)/, 'admin:templates'],
  [/^\/api\/admin\/(?:invites|lucky-draw|coupons|marketing[^/]*|landing[^/]*|mail[^/]*|public-quote-inquiries)(?:\/|$)/, 'admin:marketing'],
  [/^\/api\/admin\/(?:messages|consulting-requests|qna)(?:\/|$)/, 'admin:messages'],
  [/^\/api\/admin\/(?:cicd|service-validation[^/]*|openstack-cleanup|traffic-debug|logs|audit-logs|api-status|diagnostics|preflight)(?:\/|$)/, 'admin:ops'],
];
export function requiredAdminPermission(method, pathname) {
  const path = String(pathname || '').split('?')[0];
  // Backups contain account/credential state and can replace the entire database.
  if (/^\/api\/admin\/backups(?:\/|$)/.test(path)) return 'admin:all';
  if (['GET','HEAD'].includes(String(method).toUpperCase()) && path === '/api/admin/users') return 'admin:access';
  return DOMAIN_RULES.find(([pattern]) => pattern.test(path))?.[1] || 'admin:all';
}
export function canManageAccount(actor, target, patch = {}) {
  if (isFullAdministrator(actor)) return true;
  return hasAdminPermission(actor, 'admin:users')
    && !isPrivilegedAccount(target)
    && !isAdministratorRole(patch.role)
    && patch.adminPermissions === undefined;
}
