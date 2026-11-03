import { v } from "convex/values";
import { purposeScopedServerRolesAreDisjoint } from "../serverSecrets";

// A private storage marker lets bounded cleanup identify only connector-owned orphans.
export const gmailUploadType = (attachmentId: string) =>
	`application/x-angelsrest-gmail-upload; attachment=${attachmentId}`;
export const gmailScopes = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.send",
];
export const gmailPolicy = {
	fileBytes: 3 * 1024 * 1024,
	messageFileBytes: 6 * 1024 * 1024,
	files: 5,
	bodyCharacters: 32_000,
	messagePage: 25,
	staleAfterMs: 120_000,
	leaseMs: 90_000,
	retentionDays: 30,
	linkMessages: 200,
};
export const gmailWorkflow = v.union(
	v.literal("review"), v.literal("needs_reply"), v.literal("waiting"), v.literal("done"),
);
export const gmailRetentionMs = gmailPolicy.retentionDays * 24 * 60 * 60_000;
export function gmailExpiresAt(conversation: { _creationTime: number }) {
	return conversation._creationTime + gmailRetentionMs;
}
export const gmailFileType = v.union(
	v.literal("image/jpeg"),
	v.literal("image/png"),
	v.literal("image/webp"),
	v.literal("application/pdf"),
);
export const gmailAttachment = v.object({
	partId: v.string(),
	name: v.string(),
	type: v.string(),
	size: v.number(),
	providerAttachmentId: v.optional(v.string()),
	inlineData: v.optional(v.string()),
	blocked: v.optional(v.string()),
});
export const gmailImportedMessage = v.object({
	providerId: v.string(),
	threadId: v.string(),
	rfcId: v.string(),
	from: v.string(),
	to: v.array(v.string()),
	subject: v.string(),
	text: v.string(),
	sent: v.boolean(),
	date: v.number(),
	attachments: v.array(gmailAttachment),
	blocked: v.optional(v.string()),
});
export const gmailMessageRef = v.object({ id: v.string(), threadId: v.string() });
export function decimalId(value: unknown): string {
	if (typeof value === "number" && Number.isSafeInteger(value)) value = String(value);
	if (typeof value !== "string" || !/^[1-9]\d{0,39}$/.test(value))
		throw new Error("Invalid Gmail history identifier");
	return value;
}
export function compareHistory(a: string, b: string) {
	decimalId(a);
	decimalId(b);
	return a.length === b.length ? (a === b ? 0 : a > b ? 1 : -1) : a.length > b.length ? 1 : -1;
}
export function mailboxAddress(value: string) {
	const address = value.trim().toLowerCase();
	if (
		address.length > 254 ||
		!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(address)
	)
		throw new Error("A valid record email address is required");
	return address;
}
export function pilotAddressAllowed(kind: "MAILBOXES" | "RECIPIENTS", address: string) {
	try {
		const entries: unknown = JSON.parse(process.env[`GMAIL_PILOT_ALLOWED_${kind}`] ?? "null");
		if (!Array.isArray(entries) || !entries.length || entries.length > 25 ||
			!entries.every(value => typeof value === "string" && mailboxAddress(value) === value)) return false;
		return entries.includes(mailboxAddress(address));
	} catch { return false; }
}
export function requirePilotAddress(kind: "MAILBOXES" | "RECIPIENTS", address: string) {
	if (!pilotAddressAllowed(kind, address)) throw new Error("This mailbox or recipient is not on the approved Gmail pilot allowlist");
}
export function providerId(value: unknown): string {
	if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
		throw new Error("Invalid Gmail identifier");
	return value;
}
export function requireGmailServer(secret: string) {
	const expected = process.env.GMAIL_CONNECTOR_SECRET;
	if (
		!purposeScopedServerRolesAreDisjoint() ||
		!expected ||
		expected.length < 32 ||
		secret.length !== expected.length
	)
		throw new Error("Gmail connector is unavailable");
	let difference = 0;
	for (let i = 0; i < expected.length; i++)
		difference |= expected.charCodeAt(i) ^ secret.charCodeAt(i);
	if (difference) throw new Error("Gmail connector is unavailable");
	for (const key of [
		"WEBHOOK_SECRET",
		"ORDER_LOOKUP_SECRET",
		"INQUIRY_NOTIFICATION_RUNNER_SECRET",
	]) {
		if (process.env[key] === expected)
			throw new Error("Gmail requires a separate connector credential");
	}
}
export function filePolicy(name: string, type: string, size: number) {
	if (!name || name.length > 180 || /[\r\n\0/\\]/.test(name)) return "invalid filename";
	if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(type))
		return "unsupported file type";
	if (!Number.isSafeInteger(size) || size <= 0 || size > gmailPolicy.fileBytes)
		return "file exceeds 3 MiB or is empty";
	return null;
}
