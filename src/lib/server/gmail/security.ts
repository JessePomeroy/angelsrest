import type { JsonWebKeyInput } from "node:crypto";
import { createPublicKey, verify } from "node:crypto";
import {
	decimalId,
	mailboxAddress,
} from "../../../../packages/crm-api/convex/helpers/gmail/policy";
import {
	array,
	object,
	providerJson,
	responseBytes,
	string,
} from "../../../../packages/crm-api/convex/helpers/gmail/protocol";

export async function boundedBody(request: Request, limit: number) {
	const declared = request.headers.get("content-length");
	if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
		throw new Error("Request exceeds the allowed size");
	return responseBytes(new Response(request.body), limit);
}
export function sameOrigin(request: Request, origin: string) {
	if (request.headers.get("origin") !== origin || new URL(request.url).origin !== origin)
		throw new Error("Same-origin request required");
}
export function returnPath(value: string, origin: string) {
	const url = new URL(value, origin);
	if (
		url.origin !== origin ||
		!["/admin/inquiries", "/admin/crm"].includes(url.pathname) ||
		url.hash ||
		value.length > 2000
	)
		return "/admin/inquiries";
	return url.pathname + url.search;
}
export function parseNotice(raw: unknown, subscription: string) {
	const envelope = object(raw),
		message = object(envelope.message);
	if (envelope.subscription !== subscription) throw new Error("Unexpected subscription");
	const id = string(message.messageId, 200),
		data = string(message.data, 8192);
	if (!/^[0-9]{1,100}$/.test(id) || !/^[A-Za-z0-9+/_=-]+$/.test(data))
		throw new Error("Invalid notice");
	// Numeric history identifiers are rewritten before parsing, on every supported Node runtime.
	const text = Buffer.from(data, "base64").toString("utf8");
	if (text.length > 4096) throw new Error("Invalid notice");
	return { id, text };
}
export function noticeData(raw: unknown) {
	const value = object(raw);
	if (Object.keys(value).sort().join(",") !== "emailAddress,historyId")
		throw new Error("Invalid Gmail notice");
	return {
		address: mailboxAddress(string(value.emailAddress)),
		historyId: decimalId(value.historyId),
	};
}
interface KeySet {
	fetchedAt: number;
	keys: { kid: string; key: JsonWebKeyInput["key"] }[];
}
/** Google keys are cached; a bounded refresh permits rotation without attacker-controlled URLs. */
export function createPushVerifier(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
	let cached: KeySet | null = null;
	return async (
		authorization: string | null,
		expected: { audience: string; serviceAccount: string },
	) => {
		if (!authorization?.startsWith("Bearer ") || authorization.length > 16_384)
			throw new Error("Invalid push authentication");
		const token = authorization.slice(7),
			parts = token.split(".");
		if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
			throw new Error("Invalid push authentication");
		const header = object(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
		if (
			header.alg !== "RS256" ||
			typeof header.kid !== "string" ||
			header.kid.length > 200 ||
			header.crit ||
			header.jku ||
			header.jwk ||
			header.x5u
		)
			throw new Error("Invalid push algorithm");
		if (
			!cached ||
			now() - cached.fetchedAt > 60 * 60_000 ||
			(!cached.keys.some((k) => k.kid === header.kid) && now() - cached.fetchedAt > 60_000)
		) {
			const raw = await providerJson(
				await fetcher("https://www.googleapis.com/oauth2/v3/certs", {
					redirect: "error",
					signal: AbortSignal.timeout(5000),
				}),
			);
			const keys = array(raw.keys, 10)
				.map(object)
				.map((key) => {
					if (key.kty !== "RSA" || key.use !== "sig" || key.alg !== "RS256")
						throw new Error("Invalid Google signing key");
					const jwk: JsonWebKeyInput["key"] = {
						kty: "RSA",
						n: string(key.n, 1024),
						e: string(key.e, 16),
					};
					return { kid: string(key.kid, 200), key: jwk };
				});
			cached = { fetchedAt: now(), keys };
		}
		const key = cached.keys.find((k) => k.kid === header.kid);
		if (
			!key ||
			!verify(
				"RSA-SHA256",
				Buffer.from(`${parts[0]}.${parts[1]}`),
				createPublicKey({ key: key.key, format: "jwk" }),
				Buffer.from(parts[2], "base64url"),
			)
		)
			throw new Error("Invalid push signature");
		const claims = object(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))),
			seconds = Math.floor(now() / 1000);
		if (
			!["accounts.google.com", "https://accounts.google.com"].includes(String(claims.iss)) ||
			claims.aud !== expected.audience ||
			claims.email !== expected.serviceAccount ||
			claims.email_verified !== true ||
			typeof claims.sub !== "string" ||
			!/^\d{1,40}$/.test(claims.sub) ||
			typeof claims.exp !== "number" ||
			!Number.isSafeInteger(claims.exp) ||
			claims.exp <= seconds - 30 ||
			typeof claims.iat !== "number" ||
			!Number.isSafeInteger(claims.iat) ||
			claims.iat > seconds + 30 ||
			claims.iat < seconds - 7200 ||
			claims.exp > seconds + 7200 ||
			(claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > seconds + 30))
		)
			throw new Error("Unexpected push identity");
	};
}
export const verifyPush = createPushVerifier();
