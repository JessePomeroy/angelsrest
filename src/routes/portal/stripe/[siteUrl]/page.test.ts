import { error } from "@sveltejs/kit";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: { STRIPE_CONNECT_ONBOARDING_ENABLED: "true" },
	auth: vi.fn(),
	identity: vi.fn(),
	query: vi.fn(),
	mutation: vi.fn(),
	status: vi.fn(),
	start: vi.fn(),
	refresh: vi.fn(),
	stripe: vi.fn(),
	client: vi.fn(),
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/adminAuth", () => ({
	requireAuth: mocks.auth,
	requireAuthWithIdentity: mocks.identity,
}));
vi.mock("$lib/server/convexClient", () => ({ createAuthenticatedConvexClient: mocks.client }));
vi.mock("$lib/server/runtimeConfig", () => ({ getPublicSiteOrigin: () => "https://hub.example" }));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: mocks.stripe }));
vi.mock("$lib/server/stripeConnectStore", () => ({
	createStripeConnectStore: () => ({ findClient: mocks.query }),
}));
vi.mock("$lib/server/stripeConnectOnboarding", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/stripeConnectOnboarding")>()),
	readStripeConnectStatus: mocks.status,
	createStripeConnectOnboardingSession: mocks.start,
	refreshStripeConnectOnboardingSession: mocks.refresh,
}));

import { GET as callback } from "../../../api/stripe-connect/callback/+server";
import { GET as refresh } from "../../../api/stripe-connect/onboard/refresh/+server";
import { actions, load } from "./+page.server";

function event(path = "/portal/stripe/client.example", origin = "https://hub.example") {
	return {
		params: { siteUrl: "client.example" },
		cookies: {},
		url: new URL(path, "https://hub.example"),
		request: new Request(`https://hub.example${path}`, {
			method: "POST",
			headers: { origin },
			body: "accountId=acct_forged&redirect=https://attacker.example",
		}),
	} as Parameters<typeof load>[0];
}
const start = (input = event()) => actions.start(input as Parameters<typeof actions.start>[0]);

describe("client Stripe setup boundary", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.env.STRIPE_CONNECT_ONBOARDING_ENABLED = "true";
		mocks.auth.mockResolvedValue("verified-session");
		mocks.identity.mockResolvedValue({
			token: "verified-session",
			identity: { email: "client@example.invalid" },
		});
		mocks.client.mockReturnValue({ mutation: mocks.mutation });
		mocks.mutation.mockResolvedValue({ authorized: true });
		mocks.query.mockResolvedValue({ siteUrl: "client.example", stripeConnectedAccountId: null });
		mocks.status.mockResolvedValue({ siteUrl: "client.example", accountId: null, readiness: null });
		mocks.start.mockResolvedValue({ url: "https://connect.stripe.test/private-link" });
		mocks.refresh.mockResolvedValue({ url: "https://connect.stripe.test/refreshed" });
	});

	it("renders sign-in without client/provider access, including a forged return marker", async () => {
		mocks.identity.mockImplementation(() => error(401, "unauthenticated"));
		expect(await load(event("/portal/stripe/client.example?returned=1"))).toMatchObject({
			sessionStatus: "signed_out",
			readiness: null,
			returned: true,
		});
		expect(mocks.query).not.toHaveBeenCalled();
		expect(mocks.stripe).not.toHaveBeenCalled();
	});

	it("uses a fresh authenticated client and requires site membership before Stripe access", async () => {
		mocks.query.mockRejectedValue(new ConvexError("STRIPE_CONNECT_FORBIDDEN"));
		expect(await load(event())).toMatchObject({
			sessionStatus: "unauthorized",
			accountId: null,
			readiness: null,
		});
		expect(mocks.client).toHaveBeenCalledWith("verified-session");
		expect(mocks.stripe).not.toHaveBeenCalled();
		expect(mocks.status).not.toHaveBeenCalled();
	});

	it("a failed invitation claim never bypasses the authoritative target check", async () => {
		mocks.mutation.mockRejectedValue(new Error("not invited"));
		mocks.query.mockRejectedValue(new ConvexError("STRIPE_CONNECT_FORBIDDEN"));
		expect(await load(event())).toMatchObject({ sessionStatus: "unauthorized" });
		expect(mocks.status).not.toHaveBeenCalled();
	});

	it("disabled setup makes no Stripe requests and cannot start", async () => {
		mocks.env.STRIPE_CONNECT_ONBOARDING_ENABLED = "false";
		expect(await load(event())).toMatchObject({
			sessionStatus: "authorized",
			onboardingEnabled: false,
			readiness: null,
		});
		expect(await start()).toMatchObject({ status: 503 });
		expect(mocks.stripe).not.toHaveBeenCalled();
		expect(mocks.start).not.toHaveBeenCalled();
	});

	it("return visits use provider status without creating an account or a link", async () => {
		mocks.status.mockResolvedValue({
			siteUrl: "client.example",
			accountId: "acct_client",
			readiness: {
				status: "pending_verification",
				chargesEnabled: true,
				payoutsEnabled: false,
				detailsSubmitted: true,
			},
		});
		expect(await load(event("/portal/stripe/client.example?returned=1"))).toMatchObject({
			sessionStatus: "authorized",
			readiness: { status: "pending_verification", payoutsEnabled: false },
			returned: true,
		});
		expect(mocks.status).toHaveBeenCalledOnce();
		expect(mocks.start).not.toHaveBeenCalled();
		expect(mocks.refresh).not.toHaveBeenCalled();
	});

	it("shows a recoverable provider failure without exposing exception details", async () => {
		mocks.status.mockRejectedValue(new Error("private upstream details"));
		const data = await load(event());
		expect(data).toMatchObject({ sessionStatus: "unavailable", readiness: null });
		expect(JSON.stringify(data)).not.toContain("private upstream details");
	});

	it("uses only the route tenant and configured hub redirect origin when starting", async () => {
		await expect(start()).rejects.toMatchObject({
			status: 303,
			location: "https://connect.stripe.test/private-link",
		});
		expect(mocks.start.mock.calls[0][0]).toEqual({
			siteUrl: "client.example",
			platformOrigin: "https://hub.example",
			stripe: undefined,
			store: { findClient: mocks.query },
		});
	});

	it("handles session expiry and cross-origin form submissions before provider access", async () => {
		mocks.auth.mockImplementationOnce(() => error(401, "expired"));
		expect(await start()).toMatchObject({
			status: 401,
			data: { message: expect.stringContaining("session expired") },
		});
		expect(await start(event(undefined, "https://attacker.example"))).toMatchObject({
			status: 403,
		});
		expect(mocks.start).not.toHaveBeenCalled();
		expect(mocks.stripe).not.toHaveBeenCalled();
	});

	it("refresh redirects an expired session to the stable client sign-in page", async () => {
		mocks.auth.mockImplementation(() => error(401, "expired"));
		await expect(
			refresh(event("/api/stripe-connect/onboard/refresh?siteUrl=client.example")),
		).rejects.toMatchObject({ status: 303, location: "/portal/stripe/client.example" });
		expect(mocks.refresh).not.toHaveBeenCalled();
		expect(mocks.stripe).not.toHaveBeenCalled();
	});

	it("refresh stays gated and delegates authenticated membership verification", async () => {
		const input = event("/api/stripe-connect/onboard/refresh?siteUrl=client.example");
		mocks.env.STRIPE_CONNECT_ONBOARDING_ENABLED = "false";
		await expect(refresh(input)).rejects.toMatchObject({ status: 503 });
		expect(mocks.refresh).not.toHaveBeenCalled();
		mocks.env.STRIPE_CONNECT_ONBOARDING_ENABLED = "true";
		mocks.refresh.mockRejectedValueOnce(new ConvexError("STRIPE_CONNECT_FORBIDDEN"));
		await expect(refresh(input)).rejects.toMatchObject({ status: 403 });
		const response = await refresh(input);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://connect.stripe.test/refreshed");
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(mocks.start).not.toHaveBeenCalled();
	});

	it("callback only redirects to an encoded local setup path, never declaring success", () => {
		expect(() =>
			callback(
				event(
					"/api/stripe-connect/callback?siteUrl=client.example&redirect=https://attacker.example",
				),
			),
		).toThrow(
			expect.objectContaining({
				status: 303,
				location: "/portal/stripe/client.example?returned=1",
			}),
		);
		expect(() =>
			callback(event("/api/stripe-connect/callback?siteUrl=https://attacker.example/path")),
		).toThrow(expect.objectContaining({ status: 400 }));
		expect(mocks.stripe).not.toHaveBeenCalled();
	});
});
