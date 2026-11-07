/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import betterAuthTest from "@convex-dev/better-auth/test";
import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import type { Cookies } from "@sveltejs/kit";
import { parseSetCookieHeader } from "better-auth/cookies";
import { hashPassword } from "better-auth/crypto";
import { convexTest } from "convex-test";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { createAuth } from "./auth";
import schema from "./schema";

vi.hoisted(() => {
	// Better Auth captures NODE_ENV on import; test mode bypasses origin checks.
	vi.stubEnv("NODE_ENV", "production");
	vi.stubEnv("TEST", "false");
	vi.stubEnv("SITE_URL", "https://angelsrest.online");
	vi.stubEnv("CONVEX_SITE_URL", "https://fixture.convex.site");
	vi.stubEnv("AUTH_GOOGLE_ID", "fixture-google-id");
	vi.stubEnv("AUTH_GOOGLE_SECRET", "fixture-google-secret");
	vi.stubEnv("BETTER_AUTH_SECRET", "fixture-session-secret-at-least-32-characters");
	vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "");
	vi.stubEnv("BETTER_AUTH_ALLOWED_HOSTS", "");
});

const modules = import.meta.glob("./**/*.ts");
const site = "https://angelsrest.online";
const issuer = "https://fixture.convex.site";
const email = "session-fixture@example.invalid";
const password = "Fictional-session-password-42!";
const googleSubject = "fictional-google-subject";
let fixtureSequence = 0;

beforeEach(() => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected external request"));
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => vi.unstubAllEnvs());

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeBase64Url(value: string) {
	return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
		char.charCodeAt(0),
	);
}

function encodeBase64Url(value: unknown) {
	return btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function fixture() {
	const clientIp = `192.0.2.${++fixtureSequence}`;
	const t = convexTest(schema, modules);
	betterAuthTest.register(t);
	const passwordHash = await hashPassword(password);
	const { user, sessionCookie, jwtCookie } = await t.run(async (ctx) => {
		const auth = createAuth(ctx);
		const context = await auth.$context;
		expect(context.skipOriginCheck).toBe(false);
		const user = await context.internalAdapter.createUser({
			name: "Session fixture",
			email,
			emailVerified: true,
		});
		await context.internalAdapter.createAccount({
			userId: user.id,
			accountId: user.id,
			providerId: "credential",
			password: passwordHash,
		});
		await context.internalAdapter.createAccount({
			userId: user.id,
			accountId: googleSubject,
			providerId: "google",
		});
		return {
			user,
			sessionCookie: context.authCookies.sessionToken.name,
			jwtCookie: context.createAuthCookie("convex_jwt").name,
		};
	});
	const cookies = new Map<string, string>();
	const cookieView: Cookies = {
		get: (name) => cookies.get(name),
		getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
		set: () => {
			throw new Error("Token extraction must not mutate cookies");
		},
		delete: () => {
			throw new Error("Token extraction must not mutate cookies");
		},
		serialize: () => {
			throw new Error("Token extraction must not serialize cookies");
		},
	};
	async function request(path: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers);
		headers.set("x-forwarded-for", clientIp);
		if (!headers.has("origin")) headers.set("origin", site);
		if (cookies.size)
			headers.set(
				"cookie",
				[...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; "),
			);
		const response = await t.fetch(`/api/auth${path}`, { ...init, headers });
		for (const raw of response.headers.getSetCookie()) {
			for (const [name, cookie] of parseSetCookieHeader(raw)) {
				if (cookie["max-age"] === 0) cookies.delete(name);
				else cookies.set(name, cookie.value);
			}
		}
		return response;
	}
	return { user, sessionCookie, jwtCookie, cookies, cookieView, request };
}

async function verifyToken(
	token: string,
	jwksResponse: Response,
	userId: string,
	sessionId: string,
) {
	expect(jwksResponse.status).toBe(200);
	const jwks: unknown = await jwksResponse.json();
	const [headerPart, payloadPart, signaturePart, extra] = token.split(".");
	if (!headerPart || !payloadPart || !signaturePart || extra)
		throw new Error("Invalid JWT structure");
	const header: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(headerPart)));
	const claims: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart)));
	if (!isRecord(header) || !isRecord(claims) || !isRecord(jwks) || !Array.isArray(jwks.keys))
		throw new Error("Invalid JWT/JWKS projection");
	expect(header.alg).toBe("RS256");
	if (typeof header.kid !== "string") throw new Error("Missing JWT key identifier");
	const jwk: unknown = jwks.keys.find((key: unknown) => isRecord(key) && key.kid === header.kid);
	if (!isRecord(jwk) || jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string")
		throw new Error("Missing RSA public key");
	const key = await crypto.subtle.importKey(
		"jwk",
		{ kty: "RSA", n: jwk.n, e: jwk.e },
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"],
	);
	const signature = decodeBase64Url(signaturePart);
	expect(
		await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			key,
			signature,
			new TextEncoder().encode(`${headerPart}.${payloadPart}`),
		),
	).toBe(true);
	const tampered = `${headerPart}.${encodeBase64Url({ ...claims, email: "tampered@example.invalid" })}`;
	expect(
		await crypto.subtle.verify(
			"RSASSA-PKCS1-v1_5",
			key,
			signature,
			new TextEncoder().encode(tampered),
		),
	).toBe(false);
	expect(claims).toMatchObject({
		iss: issuer,
		aud: "convex",
		sub: userId,
		sessionId,
		email,
		email_verified: true,
		better_auth_email_verified: true,
		name: "Session fixture",
	});
	expect(claims.iat).toBeTypeOf("number");
	expect(claims.exp).toBeTypeOf("number");
	if (typeof claims.iat !== "number" || typeof claims.exp !== "number")
		throw new Error("Missing JWT lifetime");
	expect(claims.exp - claims.iat).toBe(900);
	expect(claims.iat).toBeLessThanOrEqual(Date.now() / 1000 + 1);
	expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
}

test.each([
	"password",
	"google",
])("registered %s login establishes a session before issuing its Convex JWT", async (method) => {
	const f = await fixture();
	f.cookies.set(f.jwtCookie, "previous-session-jwt");
	let login: Response;
	if (method === "password") {
		login = await f.request("/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password }),
		});
		expect(login.status).toBe(200);
	} else {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url !== "https://oauth2.googleapis.com/token")
				throw new Error("Unexpected external request");
			// The controlled token endpoint is the provider boundary; no Google validation is claimed.
			const idToken = `${encodeBase64Url({ alg: "RS256", typ: "JWT" })}.${encodeBase64Url({ sub: googleSubject, email, email_verified: true, name: "Session fixture", aud: "fixture-google-id", iss: "https://accounts.google.com", exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture-signature`;
			return Response.json({
				access_token: "fixture-access-token",
				token_type: "Bearer",
				expires_in: 3600,
				id_token: idToken,
			});
		});
		const started = await f.request("/sign-in/social", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				provider: "google",
				callbackURL: `${site}/admin`,
				disableRedirect: true,
			}),
		});
		expect(started.status).toBe(200);
		const body: unknown = await started.json();
		if (!isRecord(body) || typeof body.url !== "string") throw new Error("Missing OAuth URL");
		const state = new URL(body.url).searchParams.get("state");
		if (!state) throw new Error("Missing OAuth state");
		login = await f.request(
			`/callback/google?code=fixture-code&state=${encodeURIComponent(state)}`,
		);
		expect(login.status).toBe(302);
		expect(login.headers.get("location")).toBe(`${site}/admin`);
		expect(fetch).toHaveBeenCalledOnce();
	}
	const jwtSetCookies = login.headers
		.getSetCookie()
		.flatMap((raw) => [...parseSetCookieHeader(raw)])
		.filter(([name]) => name === f.jwtCookie);
	expect(jwtSetCookies).toHaveLength(1);
	expect(jwtSetCookies[0][1]).toMatchObject({
		value: "",
		"max-age": 0,
		secure: true,
		httponly: true,
	});
	expect(f.cookies.has(f.sessionCookie)).toBe(true);
	expect(f.cookies.has(f.jwtCookie)).toBe(false);
	expect(getToken(f.cookieView)).toBeUndefined();

	const session = await f.request("/get-session");
	expect(session.status).toBe(200);
	const established: unknown = await session.json();
	if (
		!isRecord(established) ||
		!isRecord(established.session) ||
		typeof established.session.id !== "string"
	)
		throw new Error("Missing established session");
	expect(established).toMatchObject({ user: { id: f.user.id, email } });
	const jwt = f.cookies.get(f.jwtCookie);
	if (!jwt) throw new Error("Missing established-session JWT");
	expect(getToken(f.cookieView)).toBe(jwt);
	await verifyToken(jwt, await f.request("/convex/jwks"), f.user.id, established.session.id);

	f.cookies.delete(f.jwtCookie);
	const tokenResponse = await f.request("/convex/token");
	expect(tokenResponse.status).toBe(200);
	const issued: unknown = await tokenResponse.json();
	if (!isRecord(issued) || typeof issued.token !== "string")
		throw new Error("Missing Convex token");
	expect(f.cookies.get(f.jwtCookie)).toBe(issued.token);
	expect(getToken(f.cookieView)).toBe(issued.token);
	await verifyToken(
		issued.token,
		await f.request("/convex/jwks"),
		f.user.id,
		established.session.id,
	);

	const signedOut = await f.request("/sign-out", { method: "POST" });
	expect(signedOut.status).toBe(200);
	expect(f.cookies.has(f.sessionCookie)).toBe(false);
	expect(f.cookies.has(f.jwtCookie)).toBe(false);
	expect(getToken(f.cookieView)).toBeUndefined();
	f.cookies.set(f.jwtCookie, jwt);
	const afterSignOut = await f.request("/get-session");
	expect(await afterSignOut.json()).toBeNull();
	expect(f.cookies.has(f.jwtCookie)).toBe(false);
	expect(getToken(f.cookieView)).toBeUndefined();
	expect((await f.request("/convex/token")).status).toBe(401);
});

test.each([
	[site, "angelsrest.online", "https://attacker.example", `${site}/api/auth/callback/google`],
	[
		"https://custom.example",
		"custom.example",
		"https://attacker.example",
		"https://custom.example/api/auth/callback/google",
	],
	[site, "untrusted.example", "https://attacker.example", `${site}/api/auth/callback/google`],
])("registered OAuth preserves only a trusted callback origin (%s, forwarded %s)", async (origin, forwardedHost, spoofedOrigin, callback) => {
	vi.stubEnv("BETTER_AUTH_ALLOWED_HOSTS", "custom.example");
	try {
		const f = await fixture();
		const response = await f.request("/sign-in/social", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin,
				host: new URL(spoofedOrigin).host,
				"x-forwarded-host": new URL(spoofedOrigin).host,
				"x-forwarded-proto": "https",
				"x-better-auth-forwarded-host": forwardedHost,
				"x-better-auth-forwarded-proto": "https",
			},
			body: JSON.stringify({
				provider: "google",
				callbackURL: `${origin}/admin`,
				disableRedirect: true,
			}),
		});
		expect(response.status).toBe(200);
		const body: unknown = await response.json();
		if (!isRecord(body) || typeof body.url !== "string") throw new Error("Missing OAuth URL");
		expect(new URL(body.url).searchParams.get("redirect_uri")).toBe(callback);
		const denied = await f.request("/sign-in/social", {
			method: "POST",
			headers: { "content-type": "application/json", origin: spoofedOrigin },
			body: JSON.stringify({
				provider: "google",
				callbackURL: `${site}/admin`,
				disableRedirect: true,
			}),
		});
		expect(denied.status).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		vi.stubEnv("BETTER_AUTH_ALLOWED_HOSTS", "");
	}
});
