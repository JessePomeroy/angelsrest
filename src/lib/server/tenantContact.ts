import { createHash, timingSafeEqual } from "node:crypto";
import { error, json } from "@sveltejs/kit";

type Notification = { from: string; to: string; brand: string; apiKey: string };
type Tenant = {
	notification: Notification;
	siteUrl: string;
	origin: string;
	secrets: string[];
	turnstileSecret: string;
};
type Inquiry = { siteUrl: string; name: string; email: string; subject?: string; message: string };

export function inquiryTenants(raw: string | undefined, webhookSecret: string) {
	if (!webhookSecret || !raw || Buffer.byteLength(raw) > 65_536)
		throw new Error("Inquiry intake is not configured");
	const entries: unknown = JSON.parse(raw);
	if (!entries || typeof entries !== "object" || Array.isArray(entries))
		throw new Error("Invalid inquiry registry");
	const tenants: Tenant[] = [];
	const seen = new Set<string>();
	for (const [siteUrl, value] of Object.entries(entries)) {
		if (
			!/^[a-z0-9.-]{1,253}$/.test(siteUrl) ||
			!value ||
			typeof value !== "object" ||
			Array.isArray(value)
		)
			throw new Error("Invalid inquiry tenant");
		const fields = new Map<string, unknown>(Object.entries(value));
		const notification = fields.get("notification");
		const origin = fields.get("origin"),
			secrets = fields.get("secrets"),
			turnstileSecret = fields.get("turnstileSecret");
		if (
			typeof origin !== "string" ||
			typeof turnstileSecret !== "string" ||
			!turnstileSecret.trim() ||
			!Array.isArray(secrets) ||
			!secrets.length ||
			secrets.length > 2
		)
			throw new Error("Invalid inquiry tenant");
		const url = new URL(origin);
		if (
			url.origin !== origin ||
			url.protocol !== "https:" ||
			url.port ||
			url.username ||
			url.password
		)
			throw new Error("Invalid inquiry origin");
		if (!notification || typeof notification !== "object" || Array.isArray(notification))
			throw new Error("Missing inquiry notification");
		const notice = new Map<string, unknown>(Object.entries(notification));
		const from = notice.get("from"),
			to = notice.get("to"),
			brand = notice.get("brand"),
			apiKey = notice.get("apiKey");
		const email = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
		if (
			typeof from !== "string" ||
			typeof to !== "string" ||
			!email.test(from) ||
			!email.test(to) ||
			from.split("@")[1] !== url.hostname ||
			typeof brand !== "string" ||
			!brand.trim() ||
			brand.length > 100 ||
			/[\r\n]/.test(brand) ||
			typeof apiKey !== "string" ||
			!/^re_\S{10,509}$/.test(apiKey)
		)
			throw new Error("Invalid inquiry notification");
		const keys: string[] = [];
		for (const secret of secrets) {
			if (
				typeof secret !== "string" ||
				secret !== secret.trim() ||
				secret.length < 32 ||
				secret.length > 512 ||
				secret === webhookSecret ||
				seen.has(secret)
			)
				throw new Error("Invalid inquiry credential");
			keys.push(secret);
			seen.add(secret);
		}
		tenants.push({
			siteUrl,
			origin,
			secrets: keys,
			turnstileSecret,
			notification: { from, to, brand, apiKey },
		});
	}
	if (!tenants.length || tenants.length > 100) throw new Error("Invalid inquiry tenant count");
	return tenants;
}

export function createTenantContact(deps: {
	registry: () => string | undefined;
	webhookSecret: () => string;
	active: (siteUrl: string) => Promise<boolean>;
	save: (inquiry: Inquiry) => Promise<unknown>;
	notify: (inquiry: Inquiry, notification: Notification, inquiryId: unknown) => Promise<unknown>;
	notificationFailed: () => void;
	fetch?: typeof fetch;
}) {
	const bursts = new Map<string, { start: number; count: number }>();
	return async (request: Request) => {
		let tenants: Tenant[];
		try {
			tenants = inquiryTenants(deps.registry(), deps.webhookSecret());
		} catch {
			error(503, "Inquiry intake is unavailable.");
		}
		const authorization = request.headers.get("authorization") ?? "";
		if (!authorization.startsWith("Bearer ") || authorization.length > 520)
			error(403, "Invalid intake credential.");
		const digest = (value: string) => createHash("sha256").update(value).digest();
		const supplied = digest(authorization.slice(7));
		const tenant = tenants.find((entry) =>
			entry.secrets.some((secret) => timingSafeEqual(digest(secret), supplied)),
		);
		if (!tenant) error(403, "Invalid intake credential.");
		const now = Date.now();
		for (const [key, burst] of bursts) if (now - burst.start >= 60_000) bursts.delete(key);
		const burst = bursts.get(tenant.siteUrl) ?? { start: now, count: 0 };
		if (++burst.count > 30) error(429, "Please try again later.");
		bursts.set(tenant.siteUrl, burst);
		if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
			error(415, "Send JSON.");
		const reader = request.body?.getReader();
		if (!reader) error(400, "Missing request.");
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 24_000) {
				await reader.cancel();
				error(413, "Request too large.");
			}
			chunks.push(value);
		}
		let body: unknown;
		try {
			body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			error(400, "Invalid JSON.");
		}
		if (!body || typeof body !== "object" || Array.isArray(body)) error(400, "Invalid inquiry.");
		const fields = new Map<string, unknown>(Object.entries(body));
		if (
			[...fields.keys()].some(
				(key) => !["name", "email", "subject", "message", "token"].includes(key),
			)
		)
			error(400, "Invalid inquiry.");
		function text(key: string, max: number, required = true) {
			const value = fields.get(key);
			if (typeof value !== "string" || value.length > max || (required && !value.trim()))
				error(400, "Invalid inquiry.");
			return value.trim();
		}
		const name = text("name", 200),
			email = text("email", 254),
			subject = text("subject", 200, false),
			message = text("message", 5000),
			token = text("token", 2048);
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(name + email + subject))
			error(400, "Invalid inquiry.");
		let verified: unknown;
		try {
			const response = await (deps.fetch ?? fetch)(
				"https://challenges.cloudflare.com/turnstile/v0/siteverify",
				{
					method: "POST",
					redirect: "error",
					signal: AbortSignal.timeout(5000),
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ secret: tenant.turnstileSecret, response: token }),
				},
			);
			if (!response.ok) error(503, "Verification is unavailable.");
			verified = await response.json();
		} catch {
			error(503, "Verification is unavailable.");
		}
		if (
			!verified ||
			typeof verified !== "object" ||
			!("success" in verified) ||
			verified.success !== true ||
			!("hostname" in verified) ||
			verified.hostname !== new URL(tenant.origin).hostname ||
			!("action" in verified) ||
			verified.action !== "contact"
		)
			error(403, "Verification failed.");
		const inquiry = {
			siteUrl: tenant.siteUrl,
			name,
			email,
			subject: subject || undefined,
			message,
		};
		let inquiryId: unknown;
		try {
			if (!(await deps.active(tenant.siteUrl))) error(503, "Intake is unavailable.");
			inquiryId = await deps.save(inquiry);
		} catch {
			error(503, "Your message could not be confirmed.");
		}
		try {
			await deps.notify(inquiry, tenant.notification, inquiryId);
		} catch {
			deps.notificationFailed();
		}
		return json({ success: true }, { headers: { "cache-control": "private, no-store" } });
	};
}
