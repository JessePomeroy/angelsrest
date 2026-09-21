import type { ConvexHttpClient } from "convex/browser";
import { type FunctionReturnType, getFunctionName } from "convex/server";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import {
	verifyClientCheckoutReadiness,
	verifyClientPaymentReadiness,
} from "$lib/server/clientPaymentReadiness.server";
import { getConvex } from "$lib/server/convexClient";
import { createLumaPrintsClient } from "$lib/server/lumaprints";
import { resolveLumaPrintsWebhookConfiguration } from "$lib/server/lumaprintsConnections";

vi.mock("$lib/server/convexClient", () => ({ getConvex: vi.fn() }));
vi.mock("$lib/server/webhookSecret", () => ({ getWebhookSecret: () => "synthetic-hub-secret" }));
vi.mock("$lib/server/lumaprints", () => ({ createLumaPrintsClient: vi.fn() }));
vi.mock("$lib/server/lumaprintsConnections", () => ({
	resolveLumaPrintsWebhookConfiguration: vi.fn(),
}));

const ACCOUNT = "acct_client12345678901";
const PLATFORM = "acct_platform1234567890";
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const CLIENT = "client-demo" as Id<"platformClients">;
const SITE = "client.example";
type Projection = FunctionReturnType<typeof api.platform.getClientPaymentTarget>;
const supplier = {
	version: 1,
	connectionRef: "lp_client_example",
	tenantId: TENANT,
	storeId: 101,
	environment: "sandbox",
} as const;

function setup() {
	const projection: Projection = {
		target: {
			clientId: CLIENT,
			siteUrl: SITE,
			tenantId: TENANT,
			stripeConnectedAccountId: ACCOUNT,
			attempt: {
				id: "attempt-1",
				model: "full-v1",
				email: "owner@example.invalid",
				siteUrl: SITE,
				startedAt: 42,
				platformAccountId: PLATFORM,
				livemode: false,
			},
		},
		status: null,
	};
	const account: Stripe.Account = {
		id: ACCOUNT,
		email: "owner@example.invalid",
		object: "account",
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
			stripeConnectAttemptId: "attempt-1",
		},
		charges_enabled: true,
		payouts_enabled: true,
		details_submitted: true,
	};
	const retrieve = vi.fn(async (id?: string | Stripe.RequestOptions) =>
		typeof id === "string" ? account : { id: PLATFORM },
	);
	const balance = vi.fn().mockResolvedValue({ livemode: false });
	const stripe = { accounts: { retrieve }, balance: { retrieve: balance } } as unknown as Stripe;
	const query = vi.fn(async () => projection);
	const mutation = vi.fn(
		async (
			reference: Parameters<ConvexHttpClient["mutation"]>[0],
			args: Record<string, unknown>,
		) => {
			if (getFunctionName(reference) === "platform:beginStripeConnectStatusRefresh") {
				if (projection.status?.state.kind === "disconnected") return { kind: "disconnected" };
				projection.status = {
					accountId: ACCOUNT,
					state: { kind: "checking", startedAt: Date.now() },
				};
				return { kind: "checking", refreshToken: "claim-1" };
			}
			if (getFunctionName(reference) === "platform:finishStripeConnectStatusRefresh") {
				// Mirror the projection only; backend claim/concurrency behavior is covered by real Convex tests.
				projection.status = {
					accountId: ACCOUNT,
					state: {
						...(args.result as Extract<
							NonNullable<Projection["status"]>["state"],
							{ kind: "observed" | "unavailable" }
						>),
						checkedAt: Date.now(),
					},
				};
				return { applied: true };
			}
			throw new Error("Unexpected mutation");
		},
	);
	const convex = { query, mutation } as unknown as ConvexHttpClient;
	vi.mocked(getConvex).mockReturnValue(convex);
	const verifyStoreAccess = vi.fn().mockResolvedValue(undefined);
	vi.mocked(createLumaPrintsClient).mockReturnValue({ verifyStoreAccess } as unknown as ReturnType<
		typeof createLumaPrintsClient
	>);
	return {
		projection,
		account,
		retrieve,
		balance,
		query,
		mutation,
		verifyStoreAccess,
		options: { siteUrl: SITE, tenantId: TENANT, accountId: ACCOUNT, stripe },
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("fresh client payment and supplier checks", () => {
	it("claims before bounded provider reads and uses only committed readiness", async () => {
		const s = setup();
		await expect(verifyClientPaymentReadiness(s.options)).resolves.toEqual({ livemode: false });
		expect(s.query).toHaveBeenCalledWith(api.platform.getClientPaymentTarget, {
			siteUrl: SITE,
			tenantId: TENANT,
			accountId: ACCOUNT,
			webhookSecret: "synthetic-hub-secret",
		});
		expect(s.mutation).toHaveBeenCalledBefore(s.retrieve);
		expect(s.retrieve).toHaveBeenCalledWith(ACCOUNT, { timeout: 10_000, maxNetworkRetries: 0 });
		expect(s.balance).toHaveBeenCalledWith({ timeout: 10_000, maxNetworkRetries: 0 });
	});

	it.each([
		"controller",
		"platform",
		"mode",
		"tenant",
		"account",
		"restricted",
		"payouts",
		"provider",
	])("refuses %s drift without disclosing provider details", async (failure) => {
		const s = setup();
		if (failure === "controller")
			s.account.controller = {
				...s.account.controller,
				type: "application",
				losses: { payments: "application" },
			};
		if (failure === "platform")
			s.projection.target.attempt.platformAccountId = "acct_other12345678901";
		if (failure === "mode") s.balance.mockResolvedValue({ livemode: true });
		if (failure === "tenant")
			s.account.metadata = { ...s.account.metadata, commerceTenantId: "other-tenant" };
		if (failure === "account") s.account.id = "acct_other12345678901";
		if (failure === "restricted") s.account.charges_enabled = false;
		if (failure === "payouts") s.account.payouts_enabled = false;
		if (failure === "provider")
			s.retrieve.mockRejectedValue(new Error("sensitive-provider-detail"));
		await expect(verifyClientPaymentReadiness(s.options)).rejects.toThrow(
			"Payments are temporarily unavailable.",
		);
	});

	it("refuses a disconnected account without making provider calls", async () => {
		const s = setup();
		s.projection.status = {
			accountId: ACCOUNT,
			state: { kind: "disconnected", eventId: "evt_disconnected", disconnectedAt: Date.now() },
		};
		await expect(verifyClientPaymentReadiness(s.options)).rejects.toThrow(
			"Payments are temporarily unavailable.",
		);
		expect(s.retrieve).not.toHaveBeenCalled();
	});

	it("does not authorize a discarded provider result or a changed target", async () => {
		for (const failure of ["superseded", "ownership", "slow"] as const) {
			const s = setup();
			const original = s.mutation.getMockImplementation();
			if (!original) throw new Error("Missing mutation fixture");
			s.mutation.mockImplementation(async (reference, args) => {
				if (getFunctionName(reference) !== "platform:finishStripeConnectStatusRefresh")
					return original(reference, args);
				if (failure === "superseded") return { applied: false };
				const result = await original(reference, args);
				if (failure === "ownership")
					s.projection.target.tenantId = "tenant_22222222-2222-4222-8222-222222222222";
				if (failure === "slow") vi.setSystemTime(Date.now() + 60_000);
				return result;
			});
			await expect(verifyClientPaymentReadiness(s.options)).rejects.toThrow(
				"Payments are temporarily unavailable.",
			);
		}
	});

	it("needs no supplier account for digital or service payments", async () => {
		const s = setup();
		await verifyClientCheckoutReadiness({ ...s.options, supplier: null });
		expect(createLumaPrintsClient).not.toHaveBeenCalled();
	});

	it("uses the captured supplier identity to verify store access", async () => {
		const s = setup();
		await verifyClientCheckoutReadiness({ ...s.options, supplier });
		expect(createLumaPrintsClient).toHaveBeenCalledWith(supplier);
		expect(resolveLumaPrintsWebhookConfiguration).toHaveBeenCalledWith(supplier.connectionRef);
		expect(s.verifyStoreAccess).toHaveBeenCalledOnce();
	});

	it.each([
		"tenant",
		"mode",
		"webhook",
		"store",
	])("refuses supplier %s failure before payment", async (failure) => {
		const s = setup();
		if (failure === "webhook")
			vi.mocked(resolveLumaPrintsWebhookConfiguration).mockImplementation(() => {
				throw new Error("missing");
			});
		if (failure === "store") s.verifyStoreAccess.mockRejectedValue(new Error("provider details"));
		const connection = {
			...supplier,
			...(failure === "tenant" ? { tenantId: "tenant_22222222-2222-4222-8222-222222222222" } : {}),
			...(failure === "mode" ? { environment: "production" as const } : {}),
		};
		await expect(
			verifyClientCheckoutReadiness({ ...s.options, supplier: connection }),
		).rejects.toThrow("Payments are temporarily unavailable.");
	});
});
