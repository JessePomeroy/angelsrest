import { error } from "@sveltejs/kit";
import { ConvexError } from "convex/values";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: { LUMAPRINTS_CLIENT_SETUP_ENABLED: "true" },
	auth: vi.fn(),
	client: vi.fn(),
	load: vi.fn(),
	save: vi.fn(),
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/adminAuth", () => ({ requireAuth: mocks.auth }));
vi.mock("$lib/server/convexClient", () => ({ createAuthenticatedConvexClient: mocks.client }));
vi.mock("$lib/server/lumaprintsSetup.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/lumaprintsSetup.server")>()),
	loadLumaPrintsSetup: mocks.load,
	verifyAndRegisterLumaPrintsConnection: mocks.save,
}));

import { actions, load } from "./+page.server";

function event({
	authorized = true,
	origin = "https://hub.example",
	body = "connectionRef=lp_client_original&accountOwnershipConfirmed=on&billingConfirmed=on",
	siteUrl = "client.example",
} = {}) {
	const parent: Parameters<typeof load>[0]["parent"] = vi.fn().mockResolvedValue({
		adminSession: { status: authorized ? "authorized" : "unauthorized" },
	});
	const setHeaders: Parameters<typeof load>[0]["setHeaders"] = vi.fn();
	return {
		params: { siteUrl },
		cookies: {},
		setHeaders,
		parent,
		request: new Request(
			`https://hub.example/admin/platform/lumaprints/${encodeURIComponent(siteUrl)}?/connect`,
			{
				method: "POST",
				headers: { origin, "content-type": "application/x-www-form-urlencoded" },
				body,
			},
		),
	} as Parameters<typeof load>[0];
}
const save = (input = event()) => actions.connect(input as Parameters<typeof actions.connect>[0]);

beforeEach(() => {
	vi.resetAllMocks();
	mocks.env.LUMAPRINTS_CLIENT_SETUP_ENABLED = "true";
	mocks.auth.mockResolvedValue("verified-token");
	mocks.client.mockReturnValue({ fixtureClient: true });
	mocks.load.mockResolvedValue({
		status: "available",
		siteUrl: "client.example",
		clientName: "Client",
		choices: [],
		connection: null,
	});
	mocks.save.mockResolvedValue({ connectionRef: "lp_client_original" });
});

it("does not fetch sensitive setup data for an unauthorized admin session", async () => {
	expect(await load(event({ authorized: false }))).toMatchObject({
		supplierSetup: { status: "unauthorized", choices: [] },
	});
	expect(mocks.auth).not.toHaveBeenCalled();
	expect(mocks.client).not.toHaveBeenCalled();
	expect(mocks.load).not.toHaveBeenCalled();
});

it("keeps the disabled page independent of backend adoption", async () => {
	mocks.env.LUMAPRINTS_CLIENT_SETUP_ENABLED = "false";
	expect(await load(event())).toMatchObject({ supplierSetup: { status: "disabled", choices: [] } });
	expect(mocks.client).not.toHaveBeenCalled();
	expect(mocks.load).not.toHaveBeenCalled();
});

it("uses a fresh authenticated client and private response headers", async () => {
	const input = event();
	expect(await load(input)).toMatchObject({ supplierSetup: { status: "available" } });
	expect(mocks.client).toHaveBeenCalledWith("verified-token");
	expect(input.setHeaders).toHaveBeenCalledWith(
		expect.objectContaining({
			"cache-control": "private, no-store",
			"referrer-policy": "no-referrer",
			"x-robots-tag": "noindex, nofollow",
		}),
	);
});

it("does not expose choices when the authoritative creator check rejects access", async () => {
	mocks.load.mockRejectedValue(new ConvexError("LUMAPRINTS_SETUP_FORBIDDEN"));
	expect(await load(event())).toMatchObject({
		supplierSetup: { status: "unauthorized", choices: [], connection: null },
	});
});

it("rejects malformed setup routes as a bad request", async () => {
	await expect(load(event({ siteUrl: "https://elsewhere.example" }))).rejects.toMatchObject({
		status: 400,
	});
	expect(mocks.load).not.toHaveBeenCalled();
});

it("rejects an expired session before reading or saving the form", async () => {
	mocks.auth.mockImplementation(() => error(401, "expired"));
	const input = event();
	expect(await save(input)).toMatchObject({
		status: 401,
		data: { message: expect.stringContaining("session expired") },
	});
	expect(input.request.bodyUsed).toBe(false);
	expect(mocks.save).not.toHaveBeenCalled();
});

it("rejects cross-origin actions before consuming the body", async () => {
	const input = event({ origin: "https://elsewhere.example" });
	expect(await save(input)).toMatchObject({ status: 403 });
	expect(input.request.bodyUsed).toBe(false);
	expect(mocks.save).not.toHaveBeenCalled();
});

it.each([
	"connectionRef=lp_client_original&clientId=another-client",
	"connectionRef=lp_client_original&tenantId=another-tenant",
	"connectionRef=lp_client_original&apiKey=private-value",
	"connectionRef=lp_client_original&connectionRef=lp_other_original",
	"billingConfirmed=on&billingConfirmed=off",
])("rejects unsupported or duplicated form fields: %s", async (body) => {
	expect(await save(event({ body }))).toMatchObject({ status: 400 });
	expect(mocks.save).not.toHaveBeenCalled();
});

it("bounds the form body before saving", async () => {
	expect(await save(event({ body: `connectionRef=${"x".repeat(4097)}` }))).toMatchObject({
		status: 413,
	});
	expect(mocks.save).not.toHaveBeenCalled();
});

it("passes only the route's client identity and explicit confirmations to verification", async () => {
	expect(await save()).toEqual({ saved: true });
	expect(mocks.save).toHaveBeenCalledWith(
		{ fixtureClient: true },
		{
			siteUrl: "client.example",
			connectionRef: "lp_client_original",
			accountOwnershipConfirmed: true,
			billingConfirmed: true,
		},
	);
});

it("keeps private provider errors out of the action response", async () => {
	mocks.save.mockRejectedValue(new Error("DO_NOT_EXPOSE_PROVIDER_DETAILS"));
	const response = await save();
	expect(response).toMatchObject({ status: 503 });
	expect(JSON.stringify(response)).not.toContain("DO_NOT_EXPOSE");
});
