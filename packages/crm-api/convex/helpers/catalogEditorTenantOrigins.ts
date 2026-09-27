/** Operator-owned origins. An absent registry retains the established hub only. */
export function validEditorSiteOrigin(site: unknown, origin: unknown): origin is string {
 if (typeof site !== 'string' || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(site) || site.length > 253 || typeof origin !== 'string') return false;
 try { const url = new URL(origin); return url.protocol === 'https:' && url.origin === origin && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password && !url.port && (url.hostname === site || url.hostname === `www.${site}`); } catch { return false; }
}
export function editorTenantOrigins(raw: string | undefined): ReadonlyMap<string, string> {
 if (raw === undefined) return new Map([['angelsrest.online', 'https://www.angelsrest.online']]);
 try {
  if (!raw || raw.length > 64 * 1024) return new Map();
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
  const entries = Object.entries(parsed);
  if (!entries.length || entries.length > 100 || entries.some(([site, origin]) => !validEditorSiteOrigin(site, origin))) return new Map();
  return new Map(entries.map(([site, origin]) => [site, String(origin)]));
 } catch { return new Map(); }
}

export const catalogEditorTenantOrigin = (site: string) => editorTenantOrigins(process.env.CATALOG_PRIVATE_EDITOR_TENANT_ORIGINS).get(site);
