import { createHash, randomBytes, randomUUID } from "node:crypto";
import { error, json, type RequestEvent, redirect } from "@sveltejs/kit";
import type { FunctionReturnType } from "convex/server";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { adminConfig } from "$lib/config/admin";
import { createAuthenticatedConvexClient, getConvex } from "$lib/server/convexClient";
import { getConvexUrl } from "$lib/server/runtimeConfig";
import { authorizeSiteAdminRequest } from "$lib/server/siteAdminAuthorization";
import {
	connectionError,
	safeConnectionError,
} from "../../../../packages/crm-api/convex/helpers/gmail/connection";
import {
	gmailPolicy,
	gmailUploadType,
} from "../../../../packages/crm-api/convex/helpers/gmail/policy";
import {
	gmailClient,
	gmailScopes,
	object,
	openToken,
	parseLosslessJson,
	responseBytes,
	sealToken,
	string,
	verifyFile,
} from "../../../../packages/crm-api/convex/helpers/gmail/protocol";
import type { GmailConnectionStage } from "../../../../packages/crm-api/src/gmailConnection";
import { gmailConfiguration, gmailConfigured } from "./config";
import {
	boundedBody,
	noticeData,
	parseNotice,
	returnPath,
	sameOrigin,
	verifyPush,
} from "./security";

const cookie = "gmail-mailbox-consent";
const linkCookie = "gmail-linked-consent";
const privacy = {
	"cache-control": "private, no-store",
	"x-robots-tag": "noindex, nofollow, noarchive",
	"referrer-policy": "no-referrer",
};
function consentState(saved: string | undefined, purpose: string, key: string) {
	try {
		if (!saved) throw new Error();
		const state = object(JSON.parse(openToken(saved, purpose, key)));
		if (typeof state.expiresAt !== "number" || state.expiresAt < Date.now()) throw new Error();
		return state;
	} catch {
		throw connectionError("intent_expired", "intent");
	}
}
function failedConnection(failure: unknown, stage: GmailConnectionStage, returnTo: string) {
	const safe = safeConnectionError(failure, stage).data;
	const reference = randomUUID();
	// Never pass the caught error, URL, cookies, tokens, or provider response to the logger.
	console.warn("Gmail connection failed", { reference, code: safe.code, stage: safe.stage });
	return { connected: false, code: safe.code, reference, returnTo };
}
async function authorized(event: RequestEvent, post = false) {
	const access = await authorizeSiteAdminRequest(event.request);
	if (!access) error(403, "Site administrator access is required");
	const configuration = gmailConfiguration();
	if (post) {
		try {
			sameOrigin(event.request, configuration.origin);
		} catch {
			error(403, "Same-origin request required");
		}
	}
	return { configuration, client: createAuthenticatedConvexClient(access.convexToken) };
}
function id<T extends "gmailAttachments" | "gmailConversations" | "gmailConnectStates">(
	value: unknown,
): Id<T> {
	if (typeof value !== "string" || !/^[a-z0-9]{16,80}$/.test(value))
		error(400, "Invalid conversation reference");
	return value as Id<T>;
}
export async function status(event: RequestEvent) {
	const access = await authorizeSiteAdminRequest(event.request);
	if (!access) error(403, "Site administrator access is required");
	const configured = gmailConfigured();
	const connection = configured
		? await createAuthenticatedConvexClient(access.convexToken).query(
				api.gmailConversations.connection,
				{ siteUrl: adminConfig.siteUrl },
			)
		: null;
	return json({ configured, mailbox: connection?.mailbox ?? null }, { headers: privacy });
}
export async function linkIntent(event: RequestEvent) {
	const { configuration: c, client } = await authorized(event, true);
	const form = object(JSON.parse((await boundedBody(event.request, 4096)).toString("utf8")));
	const destination = returnPath(
		typeof form.returnTo === "string" ? form.returnTo : "/admin/inquiries",
		c.origin,
	);
	const nonce = randomBytes(32).toString("base64url");
	const stateId = await client.mutation(api.gmailConversations.beginConnect, {
		siteUrl: adminConfig.siteUrl,
		nonce,
	});
	event.cookies.set(
		linkCookie,
		sealToken(
			JSON.stringify({ stateId, nonce, destination, expiresAt: Date.now() + 600_000 }),
			`linked-oauth:${c.origin}`,
			c.cookieKey,
		),
		{
			path: "/api/admin/gmail/complete-linked",
			httpOnly: true,
			secure: new URL(c.origin).protocol === "https:",
			sameSite: "lax",
			maxAge: 600,
		},
	);
	return json(
		{
			callbackURL: `${c.origin}/admin/google-connection`,
			errorCallbackURL: `${c.origin}/admin/google-connection?google_link=error`,
		},
		{ headers: privacy },
	);
}
export async function completeLinked(event: RequestEvent) {
	const { configuration: c, client } = await authorized(event, true);
	const saved = event.cookies.get(linkCookie);
	event.cookies.delete(linkCookie, { path: "/api/admin/gmail/complete-linked" });
	let destination = "/admin/inquiries";
	let stage: GmailConnectionStage = "intent";
	try {
		const state = consentState(saved, `linked-oauth:${c.origin}`, c.cookieKey);
		destination = returnPath(string(state.destination), c.origin);
		const siteUrl = await client.mutation(api.gmailConversations.consumeConnect, {
			id: id<"gmailConnectStates">(state.stateId),
			nonce: string(state.nonce),
		});
		stage = "refresh";
		const result = await client.action(api.gmailAuthLink.complete, { siteUrl });
		if (!result.connected) throw connectionError("missing_permissions", "refresh");
		const target = new URL(destination, c.origin);
		target.searchParams.set("gmail", "connected");
		return json(
			{ connected: result.connected, returnTo: target.pathname + target.search },
			{ headers: privacy },
		);
	} catch (failure) {
		const result = failedConnection(failure, stage, destination);
		return json(result, {
			status:
				result.code === "server_failure" ? 503 : result.code === "connection_busy" ? 409 : 400,
			headers: privacy,
		});
	}
}
export async function connect(event: RequestEvent) {
	event.setHeaders(privacy);
	const { configuration: c, client } = await authorized(event, true);
	const form = new URLSearchParams((await boundedBody(event.request, 4096)).toString("utf8"));
	const destination = returnPath(form.get("returnTo") ?? "/admin/inquiries", c.origin);
	const nonce = randomBytes(32).toString("base64url"),
		verifier = randomBytes(32).toString("base64url");
	const stateId = await client.mutation(api.gmailConversations.beginConnect, {
		siteUrl: adminConfig.siteUrl,
		nonce,
	});
	const state = { stateId, nonce, verifier, destination, expiresAt: Date.now() + 10 * 60_000 };
	event.cookies.set(cookie, sealToken(JSON.stringify(state), `oauth:${c.origin}`, c.cookieKey), {
		path: "/api/admin/gmail/callback",
		httpOnly: true,
		secure: new URL(c.origin).protocol === "https:",
		sameSite: "lax",
		maxAge: 600,
	});
	const query = new URLSearchParams({
		client_id: c.clientId,
		redirect_uri: c.callback,
		response_type: "code",
		scope: gmailScopes.join(" "),
		state: nonce,
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
		access_type: "offline",
		prompt: "consent",
		include_granted_scopes: "false",
	});
	redirect(303, `https://accounts.google.com/o/oauth2/v2/auth?${query}`);
}
export async function callback(event: RequestEvent) {
	event.setHeaders(privacy);
	const { configuration: c, client } = await authorized(event);
	const saved = event.cookies.get(cookie);
	event.cookies.delete(cookie, { path: "/api/admin/gmail/callback" });
	let destination = "/admin/inquiries";
	let stage: GmailConnectionStage = "intent";
	try {
		const state = consentState(saved, `oauth:${c.origin}`, c.cookieKey);
		destination = returnPath(string(state.destination), c.origin);
		if (
			typeof state.expiresAt !== "number" ||
			state.expiresAt < Date.now() ||
			event.url.searchParams.getAll("state").length !== 1 ||
			event.url.searchParams.get("state") !== state.nonce
		)
			throw connectionError("intent_expired", "intent");
		const siteUrl = await client.mutation(api.gmailConversations.consumeConnect, {
			id: id<"gmailConnectStates">(state.stateId),
			nonce: string(state.nonce),
		});
		stage = "consent";
		if (event.url.searchParams.has("error"))
			throw connectionError(
				event.url.searchParams.get("error") === "access_denied"
					? "consent_declined"
					: "server_failure",
				"consent",
			);
		if (event.url.searchParams.getAll("code").length !== 1)
			throw connectionError("intent_expired", "intent");
		const code = event.url.searchParams.get("code");
		if (!code || code.length > 4096) throw connectionError("intent_expired", "intent");
		stage = "exchange";
		await getConvex().action(api.gmailNode.connect, {
			secret: c.secret,
			siteUrl,
			code,
			verifier: string(state.verifier),
			redirectUri: c.callback,
		});
	} catch (failure) {
		const result = failedConnection(failure, stage, destination);
		const target = new URL("/admin/google-connection", c.origin);
		target.searchParams.set("gmail_error", result.code);
		target.searchParams.set("gmail_ref", result.reference);
		target.searchParams.set("returnTo", destination);
		redirect(303, target.pathname + target.search);
	}
	const target = new URL(destination, c.origin);
	target.searchParams.set("gmail", "connected");
	redirect(303, target.pathname + target.search);
}
export async function push(event: RequestEvent) {
	try {
		const c = gmailConfiguration();
		await verifyPush(event.request.headers.get("authorization"), {
			audience: c.audience,
			serviceAccount: c.serviceAccount,
		});
		const envelope = parseNotice(
			parseLosslessJson((await boundedBody(event.request, 16_384)).toString("utf8")),
			c.subscription,
		);
		const notice = noticeData(parseLosslessJson(envelope.text));
		const complete = await getConvex().action(api.gmailNode.push, {
			secret: c.secret,
			...notice,
			pubsubId: envelope.id,
		});
		return new Response(null, {
			status: complete ? 204 : 503,
			headers: { ...privacy, ...(complete ? {} : { "retry-after": "5" }) },
		});
	} catch {
		return new Response("Gmail notice could not be accepted", { status: 503, headers: privacy });
	}
}
export async function upload(event: RequestEvent) {
	const { configuration: c, client } = await authorized(event, true);
	let selected: Id<"gmailAttachments"> | undefined;
	try {
		const bytes = await boundedBody(event.request, gmailPolicy.fileBytes + 65_536);
		const form = await new Response(Uint8Array.from(bytes).buffer, {
			headers: { "content-type": event.request.headers.get("content-type") ?? "" },
		}).formData();
		if (
			[...form.keys()].some((k) => !["file", "attachmentId"].includes(k)) ||
			form.getAll("file").length !== 1 ||
			form.getAll("attachmentId").length !== 1
		)
			error(400, "Choose one attachment");
		const file = form.get("file"),
			attachmentId = id<"gmailAttachments">(form.get("attachmentId"));
		if (!(file instanceof File)) error(400, "Choose one attachment");
		const declaration = await client.query(api.gmailConversations.uploadAccess, { attachmentId });
		selected = attachmentId;
		const content = new Uint8Array(await file.arrayBuffer());
		verifyFile(content, file.type, file.size);
		if (
			file.name !== declaration.name ||
			file.type !== declaration.type ||
			file.size !== declaration.size ||
			createHash("sha256").update(content).digest("hex") !== declaration.sha256
		)
			throw new Error("Reselect the original attachment");
		const uploadUrl = await getConvex().mutation(api.gmailState.uploadGrant, {
			secret: c.secret,
			attachmentId,
		});
		if (new URL(uploadUrl).origin !== getConvexUrl())
			throw new Error("Invalid private upload origin");
		const result = await fetch(uploadUrl, {
			method: "POST",
			body: file,
			headers: { "content-type": gmailUploadType(attachmentId) },
			redirect: "error",
			signal: AbortSignal.timeout(20_000),
		});
		if (!result.ok) throw new Error("Private upload failed");
		const uploaded = object(JSON.parse((await responseBytes(result, 2048)).toString("utf8")));
		if (typeof uploaded.storageId !== "string") throw new Error("Missing private upload result");
		if (
			!(await getConvex().mutation(api.gmailState.completeUpload, {
				secret: c.secret,
				attachmentId,
				storageId: uploaded.storageId as Id<"_storage">,
			}))
		)
			throw new Error("Upload verification failed");
		return json({ ready: true }, { headers: privacy });
	} catch {
		if (selected) {
			try {
				await getConvex().mutation(api.gmailState.failUpload, {
					secret: c.secret,
					attachmentId: selected,
				});
			} catch {
				/* Reservation remains pending and blocks sending until recovered. */
			}
		}
		return json(
			{
				error:
					"Attachment upload failed. Your reply was not sent; select the original file again or remove it.",
			},
			{ status: 400, headers: privacy },
		);
	}
}
export async function attachment(event: RequestEvent) {
	const { configuration: c, client } = await authorized(event);
	try {
		const attachmentId = id<"gmailAttachments">(event.params.attachmentId);
		const grant = await client.query(api.gmailConversations.attachmentAccess, { attachmentId });
		const transport = await getConvex().query(api.gmailState.fileTransport, {
			secret: c.secret,
			attachmentId,
		});
		let bytes: Uint8Array;
		if (transport.storageUrl) {
			if (new URL(transport.storageUrl).origin !== getConvexUrl())
				throw new Error("Invalid private file origin");
			const response = await fetch(transport.storageUrl, {
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
			});
			if (!response.ok) throw new Error("Private file unavailable");
			bytes = await responseBytes(response, gmailPolicy.fileBytes);
		} else if (transport.file.inlineData)
			bytes = Buffer.from(transport.file.inlineData, "base64url");
		else {
			if (!transport.providerMessageId || !transport.file.providerAttachmentId)
				throw new Error("Attachment unavailable");
			const session = await getConvex().action(api.gmailNode.transport, {
				secret: c.secret,
				mailboxId: grant.mailboxId,
			});
			const result = await gmailClient(session.accessToken)(
				`/messages/${encodeURIComponent(transport.providerMessageId)}/attachments/${encodeURIComponent(transport.file.providerAttachmentId)}`,
			);
			bytes = Buffer.from(
				string(result.data, Math.ceil((gmailPolicy.fileBytes * 4) / 3) + 4),
				"base64url",
			);
		}
		verifyFile(bytes, grant.type, grant.size);
		if (
			transport.file.sha256 &&
			createHash("sha256").update(bytes).digest("hex") !== transport.file.sha256
		)
			throw new Error("Attachment fingerprint changed");
		return new Response(Uint8Array.from(bytes).buffer, {
			headers: {
				...privacy,
				"content-type": grant.type,
				"content-length": String(bytes.byteLength),
				"x-content-type-options": "nosniff",
				"content-security-policy": "default-src 'none'; sandbox",
				"content-disposition": `${event.url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(grant.name).replace(/'/g, "%27")}`,
			},
		});
	} catch {
		return new Response(
			"This attachment is unavailable. Reconnect Gmail or try again from the conversation.",
			{ status: 404, headers: privacy },
		);
	}
}
export async function disconnect(event: RequestEvent) {
	const { configuration: c, client } = await authorized(event, true);
	// Stored membership is checked again by the authenticated status read.
	await client.query(api.gmailConversations.connection, { siteUrl: adminConfig.siteUrl });
	const result = await getConvex().action(api.gmailNode.stopSynchronization, {
		secret: c.secret,
		siteUrl: adminConfig.siteUrl,
	});
	return json(result, { headers: privacy });
}

export async function threads(event: RequestEvent) {
	const { client } = await authorized(event, true);
	try {
		const body = object(JSON.parse((await boundedBody(event.request, 16_384)).toString("utf8")));
		if (Boolean(body.inquiryId) === Boolean(body.clientId))
			error(400, "Choose one destination record");
		const record = body.inquiryId
			? { inquiryId: recordId("inquiries", body.inquiryId) }
			: { clientId: recordId("photographyClients", body.clientId) };
		if (body.operation === "search")
			return json(
				await client.action(api.gmailNode.searchThreads, {
					...record,
					search: string(body.search, 120),
				}),
				{ headers: privacy },
			);
		if (body.operation === "preview")
			return json(
				await client.action(api.gmailNode.previewThread, {
					...record,
					threadId: string(body.threadId, 200),
				}),
				{ headers: privacy },
			);
		if (body.operation === "confirm")
			return json(
				{
					conversationId: await client.action(api.gmailNode.confirmThread, {
						...record,
						token: string(body.token, 8192),
					}),
				},
				{ headers: privacy },
			);
		return json({ error: "Choose search, preview, or confirm" }, { status: 400, headers: privacy });
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : "";
		const reason = message.includes("already linked to a different record")
			? "This thread is already linked to another record. Its association was not changed."
			: message.includes("exceeds the recovery limit")
				? "This thread exceeds the 200-message selection limit. No partial association was created."
				: message.includes("This thread changed")
					? "This thread changed after the preview. Preview it again before linking."
					: "The selection could not be completed. Check the Gmail connection and destination, then search and preview again. Nothing was sent.";
		return json({ error: reason }, { status: 400, headers: privacy });
	}
}
function recordId<T extends "inquiries" | "photographyClients">(_table: T, value: unknown): Id<T> {
	if (typeof value !== "string" || !/^[a-z0-9]{16,80}$/.test(value))
		error(400, "Invalid destination record");
	return value as Id<T>;
}

/** Portable text/metadata export. Attachment bytes use the separately authorized file reads. */
export async function exportConversation(event: RequestEvent) {
	const { client } = await authorized(event);
	try {
		const conversationId = id<"gmailConversations">(event.params.conversationId);
		const initial = await client.query(api.gmailConversations.exportContext, { conversationId });
		const sections: Record<"messages" | "attachments" | "attempts", unknown[]> = {
			messages: [],
			attachments: [],
			attempts: [],
		};
		let bytes = Buffer.byteLength(JSON.stringify(initial));
		for (const section of ["messages", "attachments", "attempts"] as const) {
			let cursor: string | null = null;
			for (let batch = 0; ; batch++) {
				if (batch >= 100) throw new Error("Export exceeds the bounded download limit");
				const page: FunctionReturnType<typeof api.gmailConversations.exportPage> =
					await client.query(api.gmailConversations.exportPage, {
						conversationId,
						section,
						paginationOpts: { cursor, numItems: 25 },
					});
				bytes += Buffer.byteLength(JSON.stringify(page.page));
				if (bytes > 4 * 1024 * 1024) throw new Error("Export exceeds the bounded download limit");
				sections[section].push(...page.page);
				if (page.isDone) break;
				cursor = page.continueCursor;
			}
		}
		const current = await client.query(api.gmailConversations.exportContext, { conversationId });
		if (
			current.conversation.revision !== initial.conversation.revision ||
			current.draft?.revision !== initial.draft?.revision
		)
			throw new Error("Conversation changed during export");
		return json(
			{
				format: "angelsrest-gmail-conversation-v1",
				exportedAt: new Date().toISOString(),
				scope:
					"Imported plain-text messages, current administrator's draft and private send text, shared send evidence, and authorized attachment metadata. Download attachment files separately from the conversation; bytes and credentials are not included.",
				...initial,
				...sections,
			},
			{
				headers: {
					...privacy,
					"content-disposition": 'attachment; filename="gmail-conversation.json"',
				},
			},
		);
	} catch {
		return json(
			{
				error:
					"Export could not complete. The record may have changed or exceeded the 4 MiB metadata limit. Retry after synchronization, or use the authorized paginated export for a larger record. No partial export was produced.",
			},
			{ status: 409, headers: privacy },
		);
	}
}
