import type { FunctionReturnType } from "convex/server";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import {
	createStripeConnectOnboardingSession,
	normalizeStripeConnectError,
	normalizeStripeConnectSiteUrl,
	readStripeConnectReadiness,
	readStripeConnectStatus,
	refreshStripeConnectOnboardingSession,
	type StripeConnectStore,
} from "$lib/server/stripeConnectOnboarding";

const PLATFORM = "acct_platform1234567890";
const ACCOUNT = "acct_client12345678901";
const OTHER_ACCOUNT = "acct_other123456789012";
const CLIENT = "client-demo" as Id<"platformClients">;
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const NOW = 1_800_000_000_000;

function setup() {
	const prepared: FunctionReturnType<typeof api.platform.beginStripeConnectAccount> = {
		clientId: CLIENT,
		tenantId: TENANT,
		stripeConnectedAccountId: null,
		attempt: {
			id: "creation-attempt-1",
			model: "full-v1",
			startedAt: NOW,
			email: "owner@example.com",
			siteUrl: "client.example",
			platformAccountId: PLATFORM,
			livemode: false,
		},
	};
	const account: Stripe.Account = {
		id: ACCOUNT,
		object: "account",
		email: "owner@example.com",
		type: "standard",
		controller: {
			type: "application",
			fees: { payer: "account" },
			losses: { payments: "stripe" },
			requirement_collection: "stripe",
			stripe_dashboard: { type: "full" },
		},
		metadata: {
			platformClientId: CLIENT,
			commerceTenantId: TENANT,
			stripeConnectAttemptId: prepared.attempt.id,
		},
		charges_enabled: false,
		payouts_enabled: false,
		details_submitted: false,
		requirements: {
			disabled_reason: null,
			alternatives: [],
			current_deadline: null,
			currently_due: [],
			errors: [],
			eventually_due: [],
			past_due: [],
			pending_verification: [],
		},
	};
	const create = vi.fn().mockResolvedValue(account);
	const retrieve = vi.fn(async (id?: string | Stripe.RequestOptions) =>
		typeof id === "string" ? account : { id: PLATFORM },
	);
	const balance = vi.fn().mockResolvedValue({ livemode: false });
	const link = vi.fn().mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
	const stripe = {
		accounts: { create, retrieve },
		balance: { retrieve: balance },
		accountLinks: { create: link },
	} as unknown as Stripe;
	const store = {
		findClient: vi.fn(async () => ({ ...prepared, siteUrl: "client.example" })),
		readStatus: vi.fn<StripeConnectStore["readStatus"]>().mockResolvedValue(null),
		beginAttempt: vi.fn(async () => structuredClone(prepared)),
		bindAccount: vi.fn(async (args) => {
			if (
				prepared.stripeConnectedAccountId &&
				prepared.stripeConnectedAccountId !== args.stripeConnectedAccountId
			)
				throw new Error("binding conflict");
			prepared.stripeConnectedAccountId = args.stripeConnectedAccountId;
		}),
	} satisfies StripeConnectStore;
	const options = {
		siteUrl: "client.example",
		platformOrigin: "https://hub.example",
		stripe,
		store,
		now: () => NOW,
	};
	return { prepared, account, create, retrieve, balance, link, store, options };
}

describe("Stripe Connect account foundation", () => {
	it("creates the agreed account with frozen tenant identity and an idempotency key", async () => {
		const s = setup();
		const result = await createStripeConnectOnboardingSession(s.options);
		expect(s.create).toHaveBeenCalledWith(
			{
				controller: {
					fees: { payer: "account" },
					losses: { payments: "stripe" },
					requirement_collection: "stripe",
					stripe_dashboard: { type: "full" },
				},
				email: "owner@example.com",
				metadata: {
					siteUrl: "client.example",
					platformClientId: CLIENT,
					commerceTenantId: TENANT,
					stripeConnectAttemptId: "creation-attempt-1",
				},
			},
			{
				idempotencyKey: `stripe-connect:full-v1:${CLIENT}:creation-attempt-1`,
				timeout: 10_000,
				maxNetworkRetries: 0,
			},
		);
		expect(s.store.bindAccount).toHaveBeenCalledWith({
			clientId: CLIENT,
			attemptId: "creation-attempt-1",
			platformAccountId: PLATFORM,
			livemode: false,
			stripeConnectedAccountId: ACCOUNT,
		});
		expect(result).toMatchObject({ accountId: ACCOUNT, readiness: { status: "setup_required" } });
		expect(s.link).toHaveBeenCalledWith(
			{
				account: ACCOUNT,
				type: "account_onboarding",
				refresh_url:
					"https://hub.example/api/stripe-connect/onboard/refresh?siteUrl=client.example",
				return_url: "https://hub.example/api/stripe-connect/callback?siteUrl=client.example",
			},
			{ timeout: 10_000, maxNetworkRetries: 0 },
		);
	});

	it("concurrent requests converge on one idempotent provider account", async () => {
		const s = setup();
		const accounts = new Map<string, Stripe.Account>();
		s.create.mockImplementation(async (_params, options) => {
			if (!accounts.has(options.idempotencyKey)) accounts.set(options.idempotencyKey, s.account);
			return accounts.get(options.idempotencyKey);
		});
		const results = await Promise.all([
			createStripeConnectOnboardingSession(s.options),
			createStripeConnectOnboardingSession(s.options),
		]);
		expect(accounts.size).toBe(1);
		expect(results.map((result) => result.accountId)).toEqual([ACCOUNT, ACCOUNT]);
		expect(s.prepared.stripeConnectedAccountId).toBe(ACCOUNT);
	});

	it("retries the same frozen request after a binding failure and withholds the link", async () => {
		const s = setup();
		s.store.bindAccount.mockRejectedValueOnce(new Error("database unavailable"));
		await expect(createStripeConnectOnboardingSession(s.options)).rejects.toThrow(
			"database unavailable",
		);
		expect(s.link).not.toHaveBeenCalled();
		await createStripeConnectOnboardingSession(s.options);
		expect(s.create.mock.calls[1]).toEqual(s.create.mock.calls[0]);
	});

	it("resumes the bound account after link generation fails", async () => {
		const s = setup();
		s.link.mockRejectedValueOnce(new Error("link unavailable"));
		await expect(createStripeConnectOnboardingSession(s.options)).rejects.toThrow(
			"link unavailable",
		);
		await createStripeConnectOnboardingSession(s.options);
		expect(s.create).toHaveBeenCalledOnce();
		expect(s.retrieve).toHaveBeenCalledWith(ACCOUNT, { timeout: 10_000, maxNetworkRetries: 0 });
	});

	it("stops uncertain account creation before Stripe can forget the idempotency key", async () => {
		const s = setup();
		s.options.now = () => NOW + 23 * 60 * 60 * 1000;
		await expect(createStripeConnectOnboardingSession(s.options)).rejects.toMatchObject({
			status: 409,
		});
		expect(s.create).not.toHaveBeenCalled();
		expect(s.link).not.toHaveBeenCalled();
	});

	it("resumes a bound account after the retry window", async () => {
		const s = setup();
		s.prepared.stripeConnectedAccountId = ACCOUNT;
		s.options.now = () => NOW + 30 * 24 * 60 * 60 * 1000;
		await createStripeConnectOnboardingSession(s.options);
		expect(s.create).not.toHaveBeenCalled();
	});

	it("tolerates small clock differences between the hub and Convex", async () => {
		const s = setup();
		s.options.now = () => NOW - 1_000;
		await createStripeConnectOnboardingSession(s.options);
		expect(s.create).toHaveBeenCalledOnce();
	});

	it("authorizes before contacting Stripe and persists before creating an account", async () => {
		const s = setup();
		s.store.findClient.mockRejectedValueOnce(new Error("Not authorized"));
		await expect(createStripeConnectOnboardingSession(s.options)).rejects.toThrow("Not authorized");
		expect(s.retrieve).not.toHaveBeenCalled();
		expect(s.balance).not.toHaveBeenCalled();
		s.store.beginAttempt.mockRejectedValueOnce(new Error("database unavailable"));
		await expect(createStripeConnectOnboardingSession(s.options)).rejects.toThrow(
			"database unavailable",
		);
		expect(s.create).not.toHaveBeenCalled();
	});

	it.each(["platform", "mode"])("rejects a different Stripe %s", async (kind) => {
		const s = setup();
		if (kind === "platform") s.prepared.attempt.platformAccountId = OTHER_ACCOUNT;
		else s.prepared.attempt.livemode = true;
		await expect(createStripeConnectOnboardingSession(s.options)).rejects.toMatchObject({
			status: 409,
		});
		expect(s.create).not.toHaveBeenCalled();
		expect(s.store.bindAccount).not.toHaveBeenCalled();
	});

	it.each([
		"dashboard",
		"losses",
		"fees",
		"owner",
		"tenant",
		"attempt",
		"account",
	])("rejects a mismatched %s before issuing a link", async (field) => {
		const s = setup();
		s.prepared.stripeConnectedAccountId = ACCOUNT;
		const controller = s.account.controller;
		const metadata = s.account.metadata;
		if (!controller?.stripe_dashboard || !controller.losses || !controller.fees || !metadata) {
			throw new Error("Incomplete account fixture");
		}
		switch (field) {
			case "dashboard":
				controller.stripe_dashboard.type = "express";
				break;
			case "losses":
				controller.losses.payments = "application";
				break;
			case "fees":
				controller.fees.payer = "application";
				break;
			case "owner":
				metadata.platformClientId = "other-client";
				break;
			case "tenant":
				metadata.commerceTenantId = "other-tenant";
				break;
			case "attempt":
				metadata.stripeConnectAttemptId = "other-attempt";
				break;
			case "account":
				s.account.id = OTHER_ACCOUNT;
				break;
		}
		await expect(createStripeConnectOnboardingSession(s.options)).rejects.toMatchObject({
			status: 409,
		});
		expect(s.store.bindAccount).not.toHaveBeenCalled();
		expect(s.link).not.toHaveBeenCalled();
	});

	it("refreshes a verified account without beginning another attempt", async () => {
		const s = setup();
		s.prepared.stripeConnectedAccountId = ACCOUNT;
		await refreshStripeConnectOnboardingSession(s.options);
		expect(s.create).not.toHaveBeenCalled();
		expect(s.store.beginAttempt).not.toHaveBeenCalled();
		expect(s.link).toHaveBeenCalledOnce();
	});

	it("does not create an account during refresh", async () => {
		const s = setup();
		await expect(refreshStripeConnectOnboardingSession(s.options)).rejects.toMatchObject({
			status: 404,
		});
		expect(s.retrieve).not.toHaveBeenCalled();
		expect(s.create).not.toHaveBeenCalled();
	});

	it.each([
		createStripeConnectOnboardingSession,
		refreshStripeConnectOnboardingSession,
	])("refuses disconnected accounts before any provider action: %s", async (onboard) => {
		const s = setup();
		s.prepared.stripeConnectedAccountId = ACCOUNT;
		s.store.readStatus.mockResolvedValue({
			accountId: ACCOUNT,
			state: { kind: "disconnected", eventId: "evt_disconnect", disconnectedAt: NOW },
		});
		await expect(onboard(s.options)).rejects.toMatchObject({ status: 409 });
		expect(s.retrieve).not.toHaveBeenCalled();
		expect(s.create).not.toHaveBeenCalled();
		expect(s.link).not.toHaveBeenCalled();
	});

	it.each([
		"disconnected",
		"revoked",
	])("withholds a temporary link if access is %s while Stripe issues it", async (condition) => {
		const s = setup();
		s.prepared.stripeConnectedAccountId = ACCOUNT;
		s.link.mockImplementationOnce(async () => {
			if (condition === "disconnected")
				s.store.readStatus.mockResolvedValue({
					accountId: ACCOUNT,
					state: { kind: "disconnected", eventId: "evt_disconnect", disconnectedAt: NOW },
				});
			else s.store.readStatus.mockRejectedValue(new Error("forbidden"));
			return { url: "https://connect.stripe.test/private-link" };
		});
		await expect(refreshStripeConnectOnboardingSession(s.options)).rejects.toThrow();
		expect(s.link).toHaveBeenCalledOnce();
	});

	it.each([
		null,
		{},
		17,
		"",
		"https://client.example/path",
		"https://client.example?x=1",
	])("rejects invalid input before authorization/provider requests: %j", async (siteUrl) => {
		const s = setup();
		await expect(
			createStripeConnectOnboardingSession({ ...s.options, siteUrl }),
		).rejects.toMatchObject({ status: 400 });
		expect(s.store.findClient).not.toHaveBeenCalled();
	});

	it("normalizes site input and retains actionable Connect setup errors", () => {
		expect(normalizeStripeConnectSiteUrl(" https://www.CLIENT.example/ ")).toBe("client.example");
		expect(
			normalizeStripeConnectError(new Error("You must have signed up for Connect")),
		).toMatchObject({
			status: 400,
			message: expect.stringContaining("Stripe Connect is not enabled"),
		});
	});

	it("reads fresh status without creating, binding, or issuing account links", async () => {
		const s = setup();
		expect(await readStripeConnectStatus(s.options)).toEqual({
			siteUrl: "client.example",
			accountId: null,
			readiness: null,
		});
		expect(s.retrieve).not.toHaveBeenCalled();
		s.prepared.stripeConnectedAccountId = ACCOUNT;
		expect(await readStripeConnectStatus(s.options)).toMatchObject({
			accountId: ACCOUNT,
			readiness: { status: "setup_required" },
		});
		s.account.charges_enabled = true;
		s.account.payouts_enabled = true;
		expect(await readStripeConnectStatus(s.options)).toMatchObject({
			readiness: { status: "ready" },
		});
		expect(s.create).not.toHaveBeenCalled();
		expect(s.store.beginAttempt).not.toHaveBeenCalled();
		expect(s.store.bindAccount).not.toHaveBeenCalled();
		expect(s.link).not.toHaveBeenCalled();
	});

	it("does not expose provider status without current tenant access and matching ownership", async () => {
		const s = setup();
		s.prepared.stripeConnectedAccountId = ACCOUNT;
		s.store.findClient.mockRejectedValueOnce(new Error("forbidden"));
		await expect(readStripeConnectStatus(s.options)).rejects.toThrow("forbidden");
		expect(s.retrieve).not.toHaveBeenCalled();
		s.prepared.attempt.livemode = true;
		await expect(readStripeConnectStatus(s.options)).rejects.toMatchObject({ status: 409 });
		s.prepared.attempt.livemode = false;
		s.account.metadata = { platformClientId: "other" };
		await expect(readStripeConnectStatus(s.options)).rejects.toMatchObject({ status: 409 });
	});

	it("does not display Stripe's raw errors or account information", () => {
		expect(
			normalizeStripeConnectError(
				Object.assign(new Error("Invalid API Key: private-value"), {
					type: "StripeAuthenticationError",
					statusCode: 401,
				}),
			),
		).toMatchObject({
			status: 502,
			message: "Stripe could not complete this request. Please try again or contact Angels Rest.",
		});
	});

	it("distinguishes incomplete, verifying, restricted, and ready accounts", () => {
		const s = setup();
		if (!s.account.requirements) throw new Error("Incomplete account fixture");
		expect(readStripeConnectReadiness(s.account).status).toBe("setup_required");
		s.account.details_submitted = true;
		expect(readStripeConnectReadiness(s.account).status).toBe("pending_verification");
		s.account.requirements.currently_due = ["business_profile.url"];
		expect(readStripeConnectReadiness(s.account).status).toBe("setup_required");
		s.account.requirements.currently_due = [];
		s.account.requirements.disabled_reason = "requirements.past_due";
		expect(readStripeConnectReadiness(s.account).status).toBe("restricted");
		s.account.requirements.disabled_reason = null;
		s.account.charges_enabled = true;
		expect(readStripeConnectReadiness(s.account)).toMatchObject({
			status: "pending_verification",
			payoutsEnabled: false,
		});
		s.account.payouts_enabled = true;
		expect(readStripeConnectReadiness(s.account).status).toBe("ready");
	});
});
