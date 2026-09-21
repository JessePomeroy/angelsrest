import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import type { StripeConnectStore } from "$lib/server/stripeConnectOnboarding";
import {
	processStripeConnectLifecycleEvent,
	refreshClientStripeConnectStatus,
	type StripeConnectStatusStore,
} from "$lib/server/stripeConnectStatusSync";
import { createStripeConnectStore } from "$lib/server/stripeConnectStore";

vi.mock("$lib/server/stripeConnectStore", () => ({ createStripeConnectStore: vi.fn() }));
vi.mock("$lib/server/webhookSecret", () => ({ getWebhookSecret: () => "hub-secret" }));

const ACCOUNT = "acct_client12345678901";
const PLATFORM = "acct_platform1234567890";
const CLIENT = "client-demo" as Id<"platformClients">;
const SITE = "client.example";
const CLAIM = "970a6e68-a67c-40b2-8231-0d16b10a8c47";
const READY = {
	status: "ready",
	chargesEnabled: true,
	payoutsEnabled: true,
	detailsSubmitted: true,
} as const;
const DISCONNECTED = {
	accountId: ACCOUNT,
	state: { kind: "disconnected", eventId: "evt_disconnected", disconnectedAt: 42 },
} as const;

function setup() {
	const target: FunctionReturnType<typeof api.platform.getStripeConnectTarget> = {
		clientId: CLIENT,
		tenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
		siteUrl: SITE,
		stripeConnectedAccountId: ACCOUNT,
		attempt: {
			id: "attempt-1",
			model: "full-v1",
			email: "owner@example.com",
			siteUrl: SITE,
			startedAt: 42,
			platformAccountId: PLATFORM,
			livemode: false,
		},
	};
	const account: Stripe.Account = {
		id: ACCOUNT,
		email: "owner@example.com",
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
			commerceTenantId: target.tenantId ?? "",
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
	const store = {
		findClient: vi.fn<StripeConnectStatusStore["findClient"]>().mockResolvedValue(target),
		readStatus: vi.fn<StripeConnectStatusStore["readStatus"]>().mockResolvedValue({
			accountId: ACCOUNT,
			state: { kind: "observed", readiness: READY, checkedAt: 42 },
		}),
		beginStatusRefresh: vi
			.fn<StripeConnectStatusStore["beginStatusRefresh"]>()
			.mockResolvedValue({ kind: "checking", refreshToken: CLAIM }),
		finishStatusRefresh: vi
			.fn<StripeConnectStatusStore["finishStatusRefresh"]>()
			.mockResolvedValue({ applied: true }),
		markDisconnected: vi.fn<StripeConnectStatusStore["markDisconnected"]>().mockResolvedValue(true),
		beginAttempt: vi.fn<StripeConnectStore["beginAttempt"]>(),
		bindAccount: vi.fn<StripeConnectStore["bindAccount"]>(),
	} satisfies StripeConnectStatusStore & StripeConnectStore;
	vi.mocked(createStripeConnectStore).mockReturnValue(store);
	const client = {
		_id: CLIENT,
		siteUrl: SITE,
		tenantId: target.tenantId,
		stripeConnectedAccountId: ACCOUNT,
		stripeConnectAttempt: target.attempt,
	};
	const query = vi.fn().mockResolvedValue(client);
	const convex = { query } as unknown as ConvexHttpClient;
	return {
		target,
		account,
		retrieve,
		balance,
		store,
		client,
		query,
		convex,
		stripe,
		options: { siteUrl: SITE, stripe, store },
	};
}

function lifecycle(
	type: "account.updated" | "capability.updated" | "account.application.deauthorized",
	overrides: Record<string, unknown> = {},
): Stripe.Event {
	return {
		id: "evt_lifecycle123",
		account: ACCOUNT,
		type,
		livemode: false,
		created: 1,
		data: {
			object:
				type === "account.updated"
					? { id: ACCOUNT, charges_enabled: false }
					: type === "capability.updated"
						? { id: "card_payments", account: ACCOUNT, status: "inactive" }
						: { id: "ca_application", object: "application" },
		},
		...overrides,
	} as Stripe.Event;
}

beforeEach(() => vi.clearAllMocks());

describe("client Stripe status synchronization", () => {
	it("claims before bounded provider reads and returns only authorized committed readiness", async () => {
		const s = setup();
		await expect(refreshClientStripeConnectStatus(s.options)).resolves.toMatchObject({
			accountId: ACCOUNT,
			readiness: READY,
			connectionIssue: null,
		});
		expect(s.store.findClient.mock.invocationCallOrder[0]).toBeLessThan(
			s.store.beginStatusRefresh.mock.invocationCallOrder[0],
		);
		expect(s.store.beginStatusRefresh.mock.invocationCallOrder[0]).toBeLessThan(
			s.retrieve.mock.invocationCallOrder[0],
		);
		expect(s.retrieve).toHaveBeenCalledWith({ timeout: 10_000, maxNetworkRetries: 0 });
		expect(s.retrieve).toHaveBeenCalledWith(ACCOUNT, { timeout: 10_000, maxNetworkRetries: 0 });
		expect(s.balance).toHaveBeenCalledWith({ timeout: 10_000, maxNetworkRetries: 0 });
		expect(s.store.finishStatusRefresh).toHaveBeenCalledWith({
			clientId: CLIENT,
			accountId: ACCOUNT,
			platformAccountId: PLATFORM,
			livemode: false,
			refreshToken: CLAIM,
			result: { kind: "observed", readiness: READY },
		});
		expect(s.store.readStatus.mock.invocationCallOrder[0]).toBeGreaterThan(
			s.store.finishStatusRefresh.mock.invocationCallOrder[0],
		);
		expect(s.store.beginAttempt).not.toHaveBeenCalled();
		expect(s.store.bindAccount).not.toHaveBeenCalled();
	});

	it("does not contact Stripe before authorization or without a bound account", async () => {
		const s = setup();
		s.store.findClient.mockRejectedValueOnce(new Error("forbidden"));
		await expect(refreshClientStripeConnectStatus(s.options)).rejects.toThrow("forbidden");
		s.target.stripeConnectedAccountId = null;
		s.store.readStatus.mockResolvedValue(null);
		await expect(refreshClientStripeConnectStatus(s.options)).resolves.toMatchObject({
			accountId: null,
			readiness: null,
			connectionIssue: null,
		});
		expect(s.store.beginStatusRefresh).not.toHaveBeenCalled();
		expect(s.retrieve).not.toHaveBeenCalled();
	});

	it("withholds a provider result if membership is revoked during the read", async () => {
		const s = setup();
		s.store.readStatus.mockRejectedValue(new Error("forbidden"));
		await expect(refreshClientStripeConnectStatus(s.options)).rejects.toThrow("forbidden");
		expect(s.store.finishStatusRefresh).toHaveBeenCalledOnce();
	});

	it.each([
		"checking",
		"unavailable",
		"disconnected",
	] as const)("does not display a superseded ready result over committed %s", async (kind) => {
		const s = setup();
		s.store.finishStatusRefresh.mockResolvedValue({ applied: false });
		s.store.readStatus.mockResolvedValue(
			kind === "disconnected"
				? DISCONNECTED
				: kind === "checking"
					? { accountId: ACCOUNT, state: { kind, startedAt: 42 } }
					: { accountId: ACCOUNT, state: { kind, reason: "provider_unavailable", checkedAt: 42 } },
		);
		await expect(refreshClientStripeConnectStatus(s.options)).resolves.toMatchObject({
			readiness: null,
			connectionIssue: kind,
		});
	});

	it("does not retrieve or restart a disconnected account", async () => {
		const s = setup();
		s.store.beginStatusRefresh.mockResolvedValue({ kind: "disconnected" });
		s.store.readStatus.mockResolvedValue(DISCONNECTED);
		await expect(refreshClientStripeConnectStatus(s.options)).resolves.toMatchObject({
			connectionIssue: "disconnected",
		});
		expect(s.retrieve).not.toHaveBeenCalled();
		expect(s.store.finishStatusRefresh).not.toHaveBeenCalled();
	});

	it("records unavailable when Stripe fails without returning raw errors or old readiness", async () => {
		const s = setup();
		s.retrieve.mockRejectedValue(new Error("secret provider diagnostic"));
		s.store.readStatus.mockResolvedValue({
			accountId: ACCOUNT,
			state: { kind: "unavailable", reason: "provider_unavailable", checkedAt: 42 },
		});
		await expect(refreshClientStripeConnectStatus(s.options)).resolves.toMatchObject({
			readiness: null,
			connectionIssue: "unavailable",
		});
		expect(s.store.finishStatusRefresh).toHaveBeenCalledWith(
			expect.objectContaining({ result: { kind: "unavailable", reason: "provider_unavailable" } }),
		);
	});

	it.each([
		"beginStatusRefresh",
		"finishStatusRefresh",
	] as const)("propagates a %s persistence failure", async (method) => {
		const s = setup();
		s.store[method].mockRejectedValue(new Error("database unavailable"));
		await expect(refreshClientStripeConnectStatus(s.options)).rejects.toThrow(
			"database unavailable",
		);
		if (method === "beginStatusRefresh") expect(s.retrieve).not.toHaveBeenCalled();
	});

	it("rejects an account change at the final committed-state read", async () => {
		const s = setup();
		s.store.readStatus.mockResolvedValue({ ...DISCONNECTED, accountId: "acct_other123456789012" });
		await expect(refreshClientStripeConnectStatus(s.options)).rejects.toMatchObject({
			status: 409,
		});
	});
});

describe("signed Connect lifecycle dispatch", () => {
	it.each([
		"account.updated",
		"capability.updated",
	] as const)("uses current facts instead of the %s snapshot or event timestamp", async (type) => {
		const s = setup();
		const event = lifecycle(type);
		await expect(processStripeConnectLifecycleEvent(event, "connected-accounts", s)).resolves.toBe(
			true,
		);
		expect(s.query).toHaveBeenCalledWith(api.platform.getByStripeConnectedAccountId, {
			stripeConnectedAccountId: ACCOUNT,
			webhookSecret: "hub-secret",
		});
		expect(s.store.finishStatusRefresh).toHaveBeenCalledWith(
			expect.objectContaining({ result: { kind: "observed", readiness: READY } }),
		);
		expect(s.store.readStatus).not.toHaveBeenCalled();
	});

	it("disconnects by signed top-level account even when API access is gone", async () => {
		const s = setup();
		s.retrieve.mockRejectedValue(new Error("account inaccessible"));
		await processStripeConnectLifecycleEvent(
			lifecycle("account.application.deauthorized"),
			"connected-accounts",
			s,
		);
		expect(s.store.markDisconnected).toHaveBeenCalledWith({
			clientId: CLIENT,
			accountId: ACCOUNT,
			platformAccountId: PLATFORM,
			livemode: false,
			eventId: "evt_lifecycle123",
		});
		expect(s.retrieve).not.toHaveBeenCalled();
		expect(s.store.beginStatusRefresh).not.toHaveBeenCalled();
	});

	it.each([
		"unknown",
		"historical",
		"unmanaged",
		"other mode",
	])("ignores %s account events before provider/status writes", async (condition) => {
		const s = setup();
		if (condition === "unknown") s.query.mockResolvedValue(null);
		if (condition === "historical") s.client.stripeConnectedAccountId = "acct_other123456789012";
		if (condition === "unmanaged") s.client.stripeConnectAttempt = null;
		await processStripeConnectLifecycleEvent(
			lifecycle("account.updated", condition === "other mode" ? { livemode: true } : {}),
			"connected-accounts",
			s,
		);
		expect(s.store.beginStatusRefresh).not.toHaveBeenCalled();
		expect(s.retrieve).not.toHaveBeenCalled();
	});

	it.each([
		"account.updated",
		"capability.updated",
	] as const)("rejects conflicting %s identity", async (type) => {
		const s = setup();
		await expect(
			processStripeConnectLifecycleEvent(
				lifecycle(type, {
					data: { object: { id: "acct_other123456789012", account: "acct_other123456789012" } },
				}),
				"connected-accounts",
				s,
			),
		).rejects.toMatchObject({ status: 400 });
		expect(s.query).not.toHaveBeenCalled();
	});

	it("returns a retryable error only after recording the failed provider check", async () => {
		const s = setup();
		s.retrieve.mockRejectedValue(new Error("provider down"));
		await expect(
			processStripeConnectLifecycleEvent(lifecycle("account.updated"), "connected-accounts", s),
		).rejects.toMatchObject({ status: 502 });
		expect(s.store.finishStatusRefresh).toHaveBeenCalledWith(
			expect.objectContaining({ result: { kind: "unavailable", reason: "provider_unavailable" } }),
		);
		s.store.finishStatusRefresh.mockResolvedValue({ applied: false });
		await expect(
			processStripeConnectLifecycleEvent(lifecycle("account.updated"), "connected-accounts", s),
		).resolves.toBe(true);
	});

	it("records mismatched ownership as unavailable without endless retries", async () => {
		const s = setup();
		s.account.metadata = { platformClientId: "other-client" };
		await expect(
			processStripeConnectLifecycleEvent(lifecycle("account.updated"), "connected-accounts", s),
		).resolves.toBe(true);
		expect(s.store.finishStatusRefresh).toHaveBeenCalledWith(
			expect.objectContaining({ result: { kind: "unavailable", reason: "account_mismatch" } }),
		);
	});

	it("leaves commerce events to intake and ignores platform lifecycle events", async () => {
		const s = setup();
		await expect(
			processStripeConnectLifecycleEvent(
				lifecycle("account.updated", { type: "checkout.session.completed" }),
				"connected-accounts",
				s,
			),
		).resolves.toBe(false);
		await expect(
			processStripeConnectLifecycleEvent(
				lifecycle("account.updated", { account: undefined }),
				"your-account",
				s,
			),
		).resolves.toBe(true);
		expect(s.query).not.toHaveBeenCalled();
	});
});
