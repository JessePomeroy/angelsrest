export const PLATFORM_CLIENT_SITE_IN_USE = "PLATFORM_CLIENT_SITE_IN_USE";
export const PLATFORM_CLIENT_LOGIN_UNVERIFIED = "PLATFORM_CLIENT_LOGIN_UNVERIFIED";

/** Shared input rules for operator-created platform clients, including the Hub form. */
export function normalizePlatformClientInput(input: {
	name: string;
	email: string;
	siteUrl: string;
	adminEmails: string[];
}) {
	const name = input.name.trim();
	if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
		throw new Error("Enter a business name between 1 and 120 characters.");
	}
	function email(value: string) {
		const normalized = value.trim().toLowerCase();
		if (normalized.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalized)) {
			throw new Error("Enter a valid email address.");
		}
		return normalized;
	}
	const rawSite = input.siteUrl.trim();
	let url: URL;
	try {
		url = new URL(rawSite.includes("://") ? rawSite : `https://${rawSite}`);
	} catch {
		throw new Error("Enter the client's website hostname, such as studio.example.");
	}
	const siteUrl = url.hostname.toLowerCase().replace(/^www\./, "");
	const labels = siteUrl.split(".");
	if (
		!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port
		|| url.pathname !== "/" || url.search || url.hash || siteUrl.length > 253
		|| labels.length < 2 || labels.every(label => /^\d+$/.test(label))
		|| labels.some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
	) {
		throw new Error("Use a website hostname without a page path, port, query or login details.");
	}
	if (input.adminEmails.length > 20) throw new Error("Use at most 20 admin email addresses.");
	return {
		name,
		email: email(input.email),
		siteUrl,
		adminEmails: Array.from(new Set(input.adminEmails.map(email))),
	};
}
