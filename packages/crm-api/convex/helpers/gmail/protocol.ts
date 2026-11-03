"use node";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Infer } from "convex/values";
import {
	decimalId,
	filePolicy,
	type gmailImportedMessage,
	gmailPolicy,
	mailboxAddress,
	providerId,
} from "./policy";

export { gmailScopes } from "./policy";
export function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid provider response");
	return value as Record<string, unknown>;
}
export function string(value: unknown, limit = 2048): string {
	if (typeof value !== "string" || value.length > limit)
		throw new Error("Invalid provider response");
	return value;
}
export function array(value: unknown, limit: number): unknown[] {
	if (!Array.isArray(value) || value.length > limit)
		throw new Error("Provider result exceeds the recovery limit");
	return value;
}
/** Tokenize strings first, so integer preservation cannot rewrite quoted email content. */
export function parseLosslessJson(text: string): unknown {
	return JSON.parse(
		text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (token) => {
			if (token.startsWith('"') || !/^-?\d+$/.test(token)) return token;
			return Number.isSafeInteger(Number(token)) ? token : JSON.stringify(token);
		}),
	);
}
export class GmailError extends Error {
	constructor(readonly status: number) {
		super(`Gmail request failed (${status})`);
	}
}
export async function responseBytes(response: Response, limit: number) {
	if (!response.body) throw new Error("Empty provider response");
	const reader = response.body.getReader(),
		chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new Error("Response exceeds the file limit");
			}
			chunks.push(part.value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks);
}
export async function providerJson(response: Response) {
	if (!response.ok) {
		await response.body?.cancel();
		throw new GmailError(response.status);
	}
	return object(
		parseLosslessJson((await responseBytes(response, 8 * 1024 * 1024)).toString("utf8")),
	);
}
export function gmailClient(accessToken: string, fetcher: typeof fetch = fetch) {
	return async (path: string, body?: Record<string, unknown>) => {
		if (!path.startsWith("/") || path.includes("..") || path.includes("#") || /[\r\n]/.test(path))
			throw new Error("Invalid Gmail path");
		const response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
			method: body ? "POST" : "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
		if (path === "/stop" && response.status === 204) return {};
		return providerJson(response);
	};
}
function encryptionKey(encoded: string) {
	if (!/^[A-Za-z0-9_-]{43}$/.test(encoded))
		throw new Error("Gmail token encryption is not configured");
	const key = Buffer.from(encoded, "base64url");
	if (key.length !== 32) throw new Error("Invalid Gmail encryption key");
	return key;
}
export function sealToken(value: string, siteUrl: string, key: string) {
	const nonce = randomBytes(12),
		cipher = createCipheriv("aes-256-gcm", encryptionKey(key), nonce);
	cipher.setAAD(Buffer.from(`gmail:v1:${siteUrl}`));
	const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	return [
		"v1",
		nonce.toString("base64url"),
		encrypted.toString("base64url"),
		cipher.getAuthTag().toString("base64url"),
	].join(".");
}
export function openToken(value: string, siteUrl: string, key: string) {
	const [version, nonce, encrypted, tag, extra] = value.split(".");
	if (version !== "v1" || !nonce || !encrypted || !tag || extra) throw new Error("Reconnect Gmail");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		encryptionKey(key),
		Buffer.from(nonce, "base64url"),
	);
	decipher.setAAD(Buffer.from(`gmail:v1:${siteUrl}`));
	decipher.setAuthTag(Buffer.from(tag, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(encrypted, "base64url")),
		decipher.final(),
	]).toString("utf8");
}
export async function oauthToken(
	fields: Record<string, string>,
	clientId: string,
	clientSecret: string,
	fetcher: typeof fetch = fetch,
) {
	return providerJson(
		await fetcher("https://oauth2.googleapis.com/token", {
			method: "POST",
			body: new URLSearchParams({ ...fields, client_id: clientId, client_secret: clientSecret }),
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		}),
	);
}
function header(message: Record<string, unknown>, name: string) {
	const payload = object(message.payload),
		headers = array(payload.headers ?? [], 200)
			.map(object)
			.filter((h) => typeof h.name === "string" && h.name.toLowerCase() === name.toLowerCase());
	if (headers.length > 1) throw new Error("Ambiguous message headers");
	return headers[0] ? string(headers[0].value, 8192) : "";
}
export function decodeHeader(value: string) {
	return value.replace(
		/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
		(_word, charset: string, encoding: string, data: string) => {
			if (!["utf-8", "utf8", "us-ascii", "iso-8859-1"].includes(charset.toLowerCase()))
				return "[unsupported header encoding]";
			const bytes =
				encoding.toLowerCase() === "b"
					? Buffer.from(data, "base64")
					: Buffer.from(
							data
								.replace(/_/g, " ")
								.replace(/=([a-f0-9]{2})/gi, (_match, hex: string) =>
									String.fromCharCode(parseInt(hex, 16)),
								),
							"latin1",
						);
			return new TextDecoder(charset === "utf8" ? "utf-8" : charset).decode(bytes);
		},
	);
}
export function addressList(value: string) {
	if (!value) return [];
	const parts: string[] = [];
	let quoted = false,
		escaped = false,
		angle = false,
		start = 0;
	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (quoted && char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') quoted = !quoted;
		if (!quoted && char === "<") angle = true;
		if (!quoted && char === ">") angle = false;
		if (!quoted && !angle && char === ",") {
			parts.push(value.slice(start, i));
			start = i + 1;
		}
	}
	if (quoted || angle || escaped) throw new Error("Unsupported address header");
	parts.push(value.slice(start));
	return parts.map((raw) => {
		const match = raw.trim().match(/^(?:[^<>\r\n]*<([^<>]+)>|([^<>\s]+@[^<>\s]+))$/);
		if (!match) throw new Error("Unsupported address header");
		return mailboxAddress(match[1] ?? match[2]);
	});
}
/** Metadata only: previews never retain message bodies or import a native draft. */
export function threadPreview(raw: unknown, expected: { threadId: string; recipient: string; mailbox: string }) {
	const thread = object(raw);
	if (providerId(thread.id) !== expected.threadId) throw new Error("Gmail returned a different thread");
	const messages = array(thread.messages ?? [], gmailPolicy.linkMessages)
		.map(object).filter(m => !array(m.labelIds ?? [], 100).includes("DRAFT"));
	if (!messages.length) throw new Error("This thread has no committed messages to link");
	const participants = new Set<string>();
	let blocked = false;
	const rows = messages.map(m => {
		const normalized = normalizeMessage(m, expected);
		blocked ||= Boolean(normalized.blocked);
		try {
			for (const name of ["From", "To", "Cc", "Bcc"])
				for (const address of addressList(header(m, name))) participants.add(address);
		} catch { blocked = true; }
		return { id: normalized.providerId, date: normalized.date, subject: normalized.subject,
			from: normalized.from, to: normalized.to, sent: normalized.sent,
			blocked: normalized.blocked ?? null };
	}).sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
	const subject = rows[rows.length - 1].subject;
	if (!subject || /[\r\n\0]/.test(subject)) blocked = true;
	return { threadId: expected.threadId, subject, participants: [...participants].sort(),
		messageCount: rows.length, rows, blocked };
}
export function normalizeMessage(
	raw: unknown,
	expected: { threadId: string; recipient: string; mailbox: string },
): Infer<typeof gmailImportedMessage> {
	const m = object(raw),
		id = providerId(m.id),
		threadId = providerId(m.threadId);
	if (threadId !== expected.threadId) throw new Error("Gmail returned a different thread");
	const labels = array(m.labelIds ?? [], 100),
		sent = labels.includes("SENT");
	const date = Number(m.internalDate);
	if (!Number.isSafeInteger(date) || date < 0 || date > Date.now() + 300_000)
		throw new Error("Invalid Gmail timestamp");
	const base = { providerId: id, threadId, date, sent };
	let from: string[], to: string[], cc: string[];
	try {
		from = addressList(header(m, "From"));
		to = addressList(header(m, "To"));
		cc = addressList(header(m, "Cc"));
		if (
			from.length !== 1 ||
			!to.length ||
			header(m, "Bcc") ||
			[...from, ...to, ...cc].some((a) => a !== expected.mailbox && a !== expected.recipient) ||
			(sent
				? from[0] !== expected.mailbox || !to.includes(expected.recipient)
				: from[0] !== expected.recipient || !to.includes(expected.mailbox))
		)
			throw new Error("Unexpected participants");
	} catch {
		return {
			...base,
			rfcId: "",
			from: "",
			to: [],
			subject: "Message withheld",
			text: "This message has unexpected participants or ambiguous headers. Review it in Gmail.",
			attachments: [],
			blocked: "A message was withheld because its participants did not match this record",
		};
	}
	let rfcId: string, subject: string;
	try {
		rfcId = header(m, "Message-ID");
		subject = decodeHeader(header(m, "Subject")).slice(0, 200);
	} catch {
		return {
			...base,
			rfcId: "",
			from: from[0],
			to,
			subject: "Message withheld",
			text: "Message headers were ambiguous. Review it in Gmail.",
			attachments: [],
			blocked: "Ambiguous message headers",
		};
	}
	const attachments: Infer<typeof gmailImportedMessage>["attachments"] = [];
	let text = "",
		visited = 0,
		attachmentBytes = 0,
		inlineCharacters = 0;
	function walk(rawPart: unknown, depth: number) {
		const part = object(rawPart);
		if (++visited > 200 || depth > 20) throw new Error("MIME structure exceeds safe limits");
		const body = object(part.body ?? {}),
			name = typeof part.filename === "string" ? part.filename.slice(0, 180) : "";
		const type =
			typeof part.mimeType === "string" ? part.mimeType.toLowerCase() : "application/octet-stream";
		if (name) {
			const size = typeof body.size === "number" ? body.size : -1;
			attachmentBytes += Math.max(0, size);
			let blocked = filePolicy(name, type, size) ?? undefined;
			if (attachments.length >= gmailPolicy.files || attachmentBytes > gmailPolicy.messageFileBytes)
				blocked = "message attachment limit exceeded";
			const attachmentId =
				typeof body.attachmentId === "string" && /^[A-Za-z0-9_-]{1,2048}$/.test(body.attachmentId)
					? body.attachmentId
					: undefined;
			// Keep a whole imported batch below Convex argument and document limits.
			const data =
				!attachmentId &&
				typeof body.data === "string" &&
				inlineCharacters + body.data.length <= 64_000
					? body.data
					: undefined;
			if (data) inlineCharacters += data.length;
			if (!attachmentId && !data)
				blocked ??= "attachment is unavailable or exceeds the inline limit";
			if (attachments.length < 20)
				attachments.push({
					partId: string(part.partId ?? String(visited), 200),
					name,
					type,
					size: Math.max(0, size),
					...(blocked ? { blocked } : {}),
					...(!blocked && attachmentId ? { providerAttachmentId: attachmentId } : {}),
					...(!blocked && data ? { inlineData: data } : {}),
				});
		} else if (type === "text/plain" && typeof body.data === "string") {
			if (body.data.length > 256_000) text += "[Text part exceeds the display limit]";
			else text += `${Buffer.from(body.data, "base64url").toString("utf8")}\n`;
		}
		for (const child of array(part.parts ?? [], 200)) walk(child, depth + 1);
	}
	try {
		walk(m.payload, 0);
	} catch {
		return {
			...base,
			rfcId,
			from: from[0],
			to,
			subject,
			text: "Message MIME structure exceeds the safe display limit. Review it in Gmail.",
			attachments: [],
			blocked: "Message could not be safely displayed",
		};
	}
	return {
		...base,
		rfcId: /^<[^<>\s\r\n]{1,250}@[^<>\s\r\n]{1,250}>$/.test(rfcId) ? rfcId : "",
		from: from[0],
		to,
		subject,
		text: text
			? text.slice(0, gmailPolicy.bodyCharacters) +
				(text.length > gmailPolicy.bodyCharacters
					? "\n[Message truncated for display; view the complete message in Gmail]"
					: "")
			: "[No plain-text part. Open this message in Gmail to view its HTML version.]",
		attachments,
	};
}
export function verifyFile(bytes: Uint8Array, type: string, size: number) {
	if (bytes.byteLength !== size || size > gmailPolicy.fileBytes)
		throw new Error("Attachment size verification failed");
	const b = Buffer.from(bytes);
	const valid =
		type === "image/png"
			? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
			: type === "image/jpeg"
				? b[0] === 255 && b[1] === 216 && b[2] === 255
				: type === "image/webp"
					? b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP"
					: type === "application/pdf" && b.subarray(0, 5).toString() === "%PDF-";
	if (!valid) throw new Error("Attachment content does not match its supported type");
}
export function composeReply(
	a: {
		rfcId: string;
		recipient: string;
		subject: string;
		text: string;
		parentRfcId?: string;
		threadId?: string;
	},
	sender: string,
	files: { name: string; type: string; bytes: Uint8Array }[],
) {
	mailboxAddress(sender);
	mailboxAddress(a.recipient);
	if (
		/[\r\n\0]/.test(a.subject) ||
		a.subject.length > 200 ||
		!/^<[^<>\s]+@[^<>\s]+>$/.test(a.rfcId) ||
		(a.threadId && !a.parentRfcId) ||
		(a.parentRfcId && !/^<[^<>\s]+@[^<>\s]+>$/.test(a.parentRfcId))
	)
		throw new Error("Invalid reply headers");
	const boundary = `ar-${randomBytes(18).toString("hex")}`;
	const encode = (bytes: Uint8Array) =>
		Buffer.from(bytes)
			.toString("base64")
			.match(/.{1,76}/g)
			?.join("\r\n") ?? "";
	const lines = [
		`From: ${sender}`,
		`To: ${a.recipient}`,
		`Subject: =?UTF-8?B?${Buffer.from(a.subject).toString("base64")}?=`,
		`Message-ID: ${a.rfcId}`,
		`Date: ${new Date().toUTCString()}`,
		"MIME-Version: 1.0",
		...(a.parentRfcId ? [`In-Reply-To: ${a.parentRfcId}`, `References: ${a.parentRfcId}`] : []),
		`Content-Type: multipart/mixed; boundary="${boundary}"`,
		"",
		`--${boundary}`,
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
		"",
		encode(Buffer.from(a.text)),
	];
	let total = 0;
	if (files.length > gmailPolicy.files) throw new Error("Too many attachments");
	for (const f of files) {
		if (filePolicy(f.name, f.type, f.bytes.byteLength))
			throw new Error("Attachment violates file policy");
		verifyFile(f.bytes, f.type, f.bytes.byteLength);
		total += f.bytes.byteLength;
		if (total > gmailPolicy.messageFileBytes) throw new Error("Reply exceeds attachment limits");
		// Gmail prefers a plain filename when both forms exist, so emit only one.
		const filename = /^[\x20-\x7e]+$/.test(f.name)
			? `filename="${f.name.replace(/"/g, '\\"')}"`
			: `filename*=UTF-8''${encodeURIComponent(f.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
		lines.push(
			`--${boundary}`,
			`Content-Type: ${f.type}`,
			`Content-Disposition: attachment; ${filename}`,
			"Content-Transfer-Encoding: base64",
			"",
			encode(f.bytes),
		);
	}
	lines.push(`--${boundary}--`, "");
	return Buffer.from(lines.join("\r\n")).toString("base64url");
}
export function historyPage(raw: Record<string, unknown>) {
	const refs = new Map<string, { id: string; threadId: string }>();
	for (const row of array(raw.history ?? [], 100)) {
		const h = object(row);
		for (const item of array(h.messages ?? [], 2000)) {
			const m = object(item);
			const ref = { id: providerId(m.id), threadId: providerId(m.threadId) };
			refs.set(ref.id, ref);
		}
		for (const key of ["messagesAdded", "labelsAdded", "labelsRemoved"])
			for (const item of array(h[key] ?? [], 2000)) {
				const m = object(object(item).message);
				const ref = { id: providerId(m.id), threadId: providerId(m.threadId) };
				refs.set(ref.id, ref);
			}
	}
	if (refs.size > 2000) throw new Error("History page exceeds the bounded recovery limit");
	return {
		refs: [...refs.values()],
		endHistoryId: decimalId(raw.historyId),
		...(raw.nextPageToken ? { nextPageToken: string(raw.nextPageToken) } : {}),
		done: !raw.nextPageToken,
	};
}
