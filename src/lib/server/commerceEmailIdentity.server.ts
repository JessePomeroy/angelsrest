import { env } from "$env/dynamic/private";
import { SITE_DOMAIN } from "$lib/config/site";
import type { CommerceNotificationProfile } from "$lib/server/commerceTenant";
import {
	COMMERCE_TENANT_ID_PATTERN,
	normalizeCommerceTenantSiteUrl,
} from "$lib/server/stripeConnect";

type Identity = {
	tenantId: string;
	siteUrl: string;
	verifiedDomain: string;
	fromName: string;
	fromEmail: string;
	replyTo: string;
	notificationEmail: string;
};
function unavailable(): never {
	throw new Error("Client commerce email identity is unavailable");
}
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function domain(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= 253 &&
		value === value.toLowerCase() &&
		/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
	);
}
function mailbox(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 254) return false;
	const pieces = value.split("@");
	return (
		pieces.length === 2 &&
		pieces[0].length <= 64 &&
		/^[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/.test(pieces[0]) &&
		domain(pieces[1])
	);
}
function identity(value: unknown): value is Identity {
	return (
		object(value) &&
		Object.keys(value).length === 7 &&
		typeof value.tenantId === "string" &&
		COMMERCE_TENANT_ID_PATTERN.test(value.tenantId) &&
		domain(value.siteUrl) &&
		normalizeCommerceTenantSiteUrl(value.siteUrl) === value.siteUrl &&
		value.siteUrl !== SITE_DOMAIN &&
		domain(value.verifiedDomain) &&
		(value.verifiedDomain === value.siteUrl ||
			value.verifiedDomain.endsWith(`.${value.siteUrl}`)) &&
		typeof value.fromName === "string" &&
		value.fromName.trim() === value.fromName &&
		value.fromName.length > 0 &&
		value.fromName.length <= 100 &&
		!/[<>"\\]/.test(value.fromName) &&
		!Array.from(value.fromName).some(
			(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		) &&
		mailbox(value.fromEmail) &&
		value.fromEmail.split("@")[1] === value.verifiedDomain &&
		mailbox(value.replyTo) &&
		mailbox(value.notificationEmail)
	);
}
function registry() {
	const raw = env.CLIENT_COMMERCE_EMAIL_IDENTITIES;
	if (!raw || Buffer.byteLength(raw, "utf8") > 65_536) unavailable();
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		unavailable();
	}
	if (
		!object(parsed) ||
		Object.keys(parsed).length !== 2 ||
		parsed.version !== 1 ||
		!Array.isArray(parsed.clients) ||
		parsed.clients.length > 100
	)
		unavailable();
	const entries: Identity[] = [];
	const tenants = new Set<string>();
	const sites = new Set<string>();
	const domains = new Set<string>();
	for (const entry of parsed.clients) {
		if (
			!identity(entry) ||
			tenants.has(entry.tenantId) ||
			sites.has(entry.siteUrl) ||
			domains.has(entry.verifiedDomain)
		)
			unavailable();
		tenants.add(entry.tenantId);
		sites.add(entry.siteUrl);
		domains.add(entry.verifiedDomain);
		entries.push(entry);
	}
	return entries;
}

/** Called only with a server-resolved commerce profile, immediately before email composition. */
export function resolveCommerceEmailIdentity(profile: CommerceNotificationProfile, suffix = "") {
	const siteUrl = normalizeCommerceTenantSiteUrl(profile.siteUrl);
	if (siteUrl === SITE_DOMAIN || env.CLIENT_COMMERCE_EMAIL_ENABLED !== "true") {
		const displayName = profile.siteName.replace(/[\r\n<>]/g, " ").trim() || "Angel's Rest";
		return {
			headers: {
				from:
					siteUrl === SITE_DOMAIN
						? `Angel's Rest${suffix} <orders@angelsrest.online>`
						: `${displayName}${suffix} via Angel's Rest <orders@angelsrest.online>`,
			},
			notificationEmail: profile.adminEmail,
		};
	}
	const selected = registry().find((entry) => entry.tenantId === profile.tenantId);
	if (!selected || selected.siteUrl !== siteUrl) unavailable();
	return {
		headers: {
			from: `"${selected.fromName}${suffix}" <${selected.fromEmail}>`,
			replyTo: selected.replyTo,
		},
		notificationEmail: selected.notificationEmail,
	};
}
