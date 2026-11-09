import { cookiesFromRequest } from "@jessepomeroy/admin/server";
import type { Cookies, RequestEvent } from "@sveltejs/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as sendContract } from "../contracts/[id]/send/+server";
import { POST as sendInvoice } from "../invoicing/[id]/send/+server";
import { POST as createPortal } from "../portal/+server";
import { POST as sendQuote } from "../quotes/[id]/send/+server";

const state = vi.hoisted(() => ({
	member: true,
	features: ["invoicing", "quotes", "contracts", "crm"],
	identityValid: true,
	backendUnavailable: false,
	calls: [] as { path: string; token: string | null; args: unknown[] }[],
}));

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_CONVEX_URL: "https://fixture.convex.cloud",
		PUBLIC_CONVEX_SITE_URL: "https://fixture.convex.site",
	},
}));
vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("@mmailaender/convex-better-auth-svelte/sveltekit", () => ({
	getToken: (cookies: Cookies) => cookies.get("fixture-session"),
}));

const routes = [
	[
		"invoicing/synthetic/send",
		(token?: string) => invoke(sendInvoice, "invoicing/synthetic/send", token),
	],
	["quotes/synthetic/send", (token?: string) => invoke(sendQuote, "quotes/synthetic/send", token)],
	[
		"contracts/synthetic/send",
		(token?: string) => invoke(sendContract, "contracts/synthetic/send", token),
	],
	["portal", (token?: string) => invoke(createPortal, "portal", token)],
] as const;

function invoke<T extends RequestEvent>(
	handler: (event: T) => Response | Promise<Response>,
	path: string,
	token?: string,
	body = {},
) {
	const request = new Request(`https://fixture.example/api/admin/${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(token ? { cookie: `fixture-session=${token}` } : {}),
		},
		body: JSON.stringify(body),
	});
	return handler({
		request,
		cookies: cookiesFromRequest(request),
		params: { id: "synthetic" },
		url: new URL(request.url),
	} as T);
}

function convexResult(path: string, token: string | null) {
	switch (path) {
		case "adminAuth:whoami":
			return state.identityValid ? { email: `${token}@example.test`, subject: token } : null;
		case "adminAuth:claimAdminAccess":
			return { claimed: true };
		case "adminAuth:checkAdminAccess":
			return { authorized: state.member, enabledFeatures: state.features };
		case "portal:createToken":
			return "synthetic-portal-token";
		default:
			throw new Error(`Unexpected protected operation: ${path}`);
	}
}

beforeEach(() => {
	state.member = true;
	state.features = ["invoicing", "quotes", "contracts", "crm"];
	state.identityValid = true;
	state.backendUnavailable = false;
	state.calls = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toMatch(/^https:\/\/fixture\.convex\.cloud\/api\/(query|mutation)$/);
			const body: unknown = JSON.parse(String(init?.body));
			if (
				!body ||
				typeof body !== "object" ||
				!("path" in body) ||
				typeof body.path !== "string" ||
				!("args" in body) ||
				!Array.isArray(body.args)
			) {
				throw new Error("Unexpected Convex request");
			}
			const token = new Headers(init?.headers).get("authorization");
			state.calls.push({ path: body.path, token, args: body.args });
			if (state.backendUnavailable) throw new Error("Synthetic backend failure");
			const value = convexResult(body.path, token);
			return Response.json({ status: "success", value });
		}),
	);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(routes)("shared %s authorization", (_path, run) => {
	it("denies missing sessions before backend access", async () => {
		await expect(run()).rejects.toMatchObject({ status: 401 });
		expect(state.calls).toEqual([]);
	});
	it("denies an invalid identity before membership or protected operations", async () => {
		state.identityValid = false;
		await expect(run("stale")).rejects.toMatchObject({ status: 401 });
		expect(state.calls.map((call) => call.path)).toEqual(["adminAuth:whoami"]);
	});
	it("denies nonmembers before protected operations", async () => {
		state.member = false;
		await expect(run("nonmember")).rejects.toMatchObject({ status: 401 });
		expect(state.calls.map((call) => call.path)).toEqual([
			"adminAuth:whoami",
			"adminAuth:claimAdminAccess",
			"adminAuth:checkAdminAccess",
		]);
	});
	it("authorizes once before validating the protected request body", async () => {
		await expect(run("owner")).rejects.toMatchObject({ status: 400 });
		expect(state.calls.map((call) => call.path)).toEqual([
			"adminAuth:whoami",
			"adminAuth:claimAdminAccess",
			"adminAuth:checkAdminAccess",
		]);
	});
});

it("checks document feature access before processing the request", async () => {
	state.features = ["crm"];
	await expect(invoke(sendInvoice, "invoicing/synthetic/send", "owner")).rejects.toMatchObject({
		status: 401,
	});
	expect(state.calls).toHaveLength(3);
});

it("fails closed when the identity backend is unavailable", async () => {
	state.backendUnavailable = true;
	await expect(invoke(createPortal, "portal", "owner")).rejects.toMatchObject({ status: 401 });
	expect(state.calls.map((call) => call.path)).toEqual(["adminAuth:whoami"]);
});

it("keeps concurrent portal writes bound to their own validated sessions and site", async () => {
	const body = { type: "invoice", documentId: "synthetic-invoice", clientId: "synthetic-client" };
	const responses = await Promise.all(
		["first", "second"].map((token) => invoke(createPortal, "portal", token, body)),
	);
	expect(responses.map((response) => response.status)).toEqual([200, 200]);
	for (const token of ["Bearer first", "Bearer second"]) {
		const calls = state.calls.filter((call) => call.token === token);
		expect(calls.map((call) => call.path)).toEqual([
			"adminAuth:whoami",
			"adminAuth:claimAdminAccess",
			"adminAuth:checkAdminAccess",
			"portal:createToken",
		]);
		expect(calls[2].args[0]).toEqual({
			email: `${token}@example.test`,
			siteUrl: "angelsrest.online",
		});
		expect(calls[3].args[0]).toMatchObject({ siteUrl: "angelsrest.online", ...body });
	}
});
