const DOMAIN_NAME =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The tenant key stays stable; the operator owns its canonical browser origin. */
export function validEditorSiteOrigin(site: unknown, origin: unknown): origin is string {
	if (typeof site !== "string" || !DOMAIN_NAME.test(site) || typeof origin !== "string")
		return false;
	try {
		const url = new URL(origin);
		return (
			url.protocol === "https:" &&
			url.origin === origin &&
			url.pathname === "/" &&
			!url.search &&
			!url.hash &&
			!url.username &&
			!url.password &&
			!url.port &&
			DOMAIN_NAME.test(url.hostname)
		);
	} catch {
		return false;
	}
}

/** Only this server-owned registry can admit a custom domain for a tenant. */
export function editorTenantOrigins(raw: string | undefined): ReadonlyMap<string, string> {
	if (raw === undefined) return new Map([["angelsrest.online", "https://www.angelsrest.online"]]);
	try {
		if (!raw || raw.length > 64 * 1024) return new Map();
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
		const entries = Object.entries(parsed);
		if (!entries.length || entries.length > 100) return new Map();
		const origins = new Map<string, string>();
		const assignedOrigins = new Set<string>();
		for (const [site, origin] of entries) {
			if (!validEditorSiteOrigin(site, origin) || assignedOrigins.has(origin)) return new Map();
			origins.set(site, origin);
			assignedOrigins.add(origin);
		}
		return origins;
	} catch {
		return new Map();
	}
}

export const catalogEditorTenantOrigin = (site: string) =>
	editorTenantOrigins(process.env.CATALOG_PRIVATE_EDITOR_TENANT_ORIGINS).get(site);
