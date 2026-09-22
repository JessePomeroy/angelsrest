import type { PlatformClient } from "@jessepomeroy/admin";
import type { StripeConnectReadiness } from "../../../src/lib/stripeConnectSetup";

export interface PracticeClient extends PlatformClient {
	role: "client";
	adminEmails: string[];
	stripeConnectedAccountId?: string;
	stripeStatus?: StripeConnectReadiness["status"];
	supplierConnected?: boolean;
}
interface PracticeState { clients: PracticeClient[]; signedInEmail: string | null }
function isPracticeClient(value: unknown): value is PracticeClient {
	if (!value || typeof value !== "object") return false;
	return "_id" in value && typeof value._id === "string" && value._id.startsWith("practice-")
		&& "_creationTime" in value && typeof value._creationTime === "number" && Number.isFinite(value._creationTime)
		&& "name" in value && typeof value.name === "string"
		&& "siteUrl" in value && typeof value.siteUrl === "string" && value.siteUrl.endsWith(".example")
		&& "email" in value && typeof value.email === "string" && value.email.endsWith(".example")
		&& "adminEmails" in value && Array.isArray(value.adminEmails) && value.adminEmails.every(email => typeof email === "string")
		&& "tier" in value && (value.tier === "basic" || value.tier === "full")
		&& "subscriptionStatus" in value && value.subscriptionStatus === "none"
		&& "role" in value && value.role === "client"
		&& (!("stripeConnectedAccountId" in value) || typeof value.stripeConnectedAccountId === "string")
		&& (!("stripeStatus" in value) || ["ready", "setup_required", "pending_verification", "restricted"].some(status => status === value.stripeStatus))
		&& (!("supplierConnected" in value) || typeof value.supplierConnected === "boolean");
}
const storageKey = "angelsrest-onboarding-rehearsal-v1";
function initial(): PracticeState {
	try {
		const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
		if (saved && typeof saved === "object" && "clients" in saved && Array.isArray(saved.clients)
			&& saved.clients.every(isPracticeClient)) {
			return { clients: saved.clients, signedInEmail: "signedInEmail" in saved && typeof saved.signedInEmail === "string" ? saved.signedInEmail : null };
		}
	} catch { /* An invalid or expired practice session starts empty. */ }
	return { clients: [], signedInEmail: null };
}
export const practice = $state(initial());
export function persist() {
	sessionStorage.setItem(storageKey, JSON.stringify({ clients: practice.clients, signedInEmail: practice.signedInEmail }));
}
export function reset() { sessionStorage.removeItem(storageKey); window.location.assign("/admin/platform"); }
export const page = $state({ url: new URL(window.location.href), state: {} });
export const navigating = $state({ to: null });
export function currentClient() {
	const site = decodeURIComponent(page.url.pathname.split("/").at(-1) ?? "");
	return practice.clients.find(client => client.siteUrl === site);
}
export function localNavigate(path: string) {
	const target = new URL(path, window.location.origin);
	if (target.origin !== window.location.origin) throw new Error("The rehearsal stays on this preview.");
	window.location.assign(target.pathname + target.search);
}
