import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualRefundRecoveryEvidenceError } from "$lib/server/manualRefundRecovery";
import {
	MANUAL_REFUND_RECOVERY_ID,
	manualRefundRecoveryManifest as manifest,
} from "$lib/server/manualRefundRecoveryManifest";

const mocks = vi.hoisted(() => ({
	privateEnv: { STRIPE_REFUND_RECOVERY_ID: undefined as string | undefined },
	publicEnv: { PUBLIC_CONVEX_URL: "https://loyal-swan-967.convex.cloud" },
	adminConfig: { siteUrl: "angelsrest.online" },
	authorize: vi.fn(),
	createAuthenticatedClient: vi.fn(),
	mutation: vi.fn(),
	recover: vi.fn(),
	stripe: {},
	log: vi.fn(),
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.privateEnv }));
vi.mock("$env/dynamic/public", () => ({ env: mocks.publicEnv }));
vi.mock("$lib/config/admin", () => ({ adminConfig: mocks.adminConfig }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	authorizeSiteAdminRequest: mocks.authorize,
}));
vi.mock("$lib/server/convexClient", () => ({
	createAuthenticatedConvexClient: (token: string) => {
		mocks.createAuthenticatedClient(token);
		return { mutation: mocks.mutation };
	},
}));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: () => mocks.stripe }));
vi.mock("$lib/server/webhookSecret", () => ({ getWebhookSecret: () => "webhook-authority" }));
vi.mock("$lib/server/logger", () => ({ logStructured: mocks.log }));
vi.mock("$lib/server/manualRefundRecovery", async (importOriginal) => {
	const original = await importOriginal<typeof import("$lib/server/manualRefundRecovery")>();
	return { ...original, recoverManualRefundFromProvider: mocks.recover };
});
vi.mock("$convex/api", () => ({
	api: {
		orders: {
			claimManualRefundRecovery: "orders.claimManualRefundRecovery",
			failManualRefundRecovery: "orders.failManualRefundRecovery",
		},
	},
}));

function request(
	body: unknown = { recoveryId: MANUAL_REFUND_RECOVERY_ID },
	origin = "https://www.angelsrest.online",
	url = "https://www.angelsrest.online/api/admin/orders/refund-recovery",
	contentType = "application/json",
) {
	return new Request(url, {
		method: "POST",
		headers: { "content-type": contentType, origin },
		body: JSON.stringify(body),
	});
}

async function post(input: Request) {
	const { POST } = await import("./+server");
	return await POST({ request: input } as Parameters<typeof POST>[0]);
}

describe("admin manual refund recovery route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.privateEnv.STRIPE_REFUND_RECOVERY_ID = MANUAL_REFUND_RECOVERY_ID;
		mocks.adminConfig.siteUrl = manifest.siteUrl;
		mocks.publicEnv.PUBLIC_CONVEX_URL = manifest.expectedConvexUrl;
		mocks.authorize.mockResolvedValue({ convexToken: "session-token" });
		mocks.mutation.mockImplementation((reference) => {
			if (reference === "orders.claimManualRefundRecovery") {
				return Promise.resolve({ claimed: true });
			}
			return Promise.resolve({ completed: true });
		});
		mocks.recover.mockResolvedValue({ kind: "reconciled" });
	});

	it.each([
		["cross-origin", "https://attacker.test", manifest.expectedOrigin],
		["same-origin preview", "https://preview.angelsrest.test", "https://preview.angelsrest.test"],
	] as const)("requires the exact production origin for a %s request", async (_label, origin, url) => {
		const response = await post(
			request(undefined, origin, `${url}/api/admin/orders/refund-recovery`),
		);

		expect(response.status).toBe(403);
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.mutation).not.toHaveBeenCalled();
		expect(mocks.recover).not.toHaveBeenCalled();
	});

	it("requires a valid session with stored site membership", async () => {
		mocks.authorize.mockResolvedValue(null);

		const response = await post(request());

		expect(response.status).toBe(401);
		expect(mocks.mutation).not.toHaveBeenCalled();
		expect(mocks.recover).not.toHaveBeenCalled();
	});

	it.each([
		"recovery gate",
		"Convex deployment",
	] as const)("fails closed when the exact %s is disabled", async (gate) => {
		if (gate === "recovery gate") mocks.privateEnv.STRIPE_REFUND_RECOVERY_ID = undefined;
		else mocks.publicEnv.PUBLIC_CONVEX_URL = "https://preview.convex.cloud";

		const response = await post(request());

		expect(response.status).toBe(404);
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.mutation).not.toHaveBeenCalled();
		expect(mocks.recover).not.toHaveBeenCalled();
	});

	it.each([
		["wrong recovery", { recoveryId: "wrong-recovery" }],
		["provider facts", { recoveryId: MANUAL_REFUND_RECOVERY_ID, stripeRefundId: "re_asserted" }],
		["array", [MANUAL_REFUND_RECOVERY_ID]],
	] as const)("rejects an invalid %s body before the durable claim", async (_label, body) => {
		const response = await post(request(body));

		expect(response.status).toBe(400);
		expect(mocks.mutation).not.toHaveBeenCalled();
		expect(mocks.recover).not.toHaveBeenCalled();
	});

	it.each([
		["non-JSON media type", request(undefined, undefined, undefined, "application/jsonp")],
		["oversized body", request({ recoveryId: "x".repeat(1100) })],
	] as const)("rejects a %s before the durable claim", async (_label, invalidRequest) => {
		const response = await post(invalidRequest);

		expect(response.status).toBe(400);
		expect(mocks.mutation).not.toHaveBeenCalled();
		expect(mocks.recover).not.toHaveBeenCalled();
	});

	it("claims once before provider retrieval and returns the reconciled result", async () => {
		const response = await post(request());

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({ status: "reconciled" });
		expect(mocks.createAuthenticatedClient).toHaveBeenCalledWith("session-token");
		expect(mocks.mutation).toHaveBeenNthCalledWith(1, "orders.claimManualRefundRecovery", {
			webhookSecret: "webhook-authority",
			recoveryId: MANUAL_REFUND_RECOVERY_ID,
			manifestVersion: manifest.manifestVersion,
			siteUrl: manifest.siteUrl,
			stripeContext: manifest.stripeContext,
			stripeEventId: manifest.stripeEventId,
			stripeEventType: manifest.stripeEventType,
			stripeEventApiVersion: manifest.stripeEventApiVersion,
			stripeRefundId: manifest.stripeRefundId,
			stripeChargeId: manifest.stripeChargeId,
			stripePaymentIntentId: manifest.stripePaymentIntentId,
			stripeSessionId: manifest.stripeSessionId,
			stripeTenantMetadataSiteUrl: manifest.stripeTenantMetadataSiteUrl,
			amount: manifest.amount,
			currency: manifest.currency,
			livemode: manifest.livemode,
		});
		expect(mocks.recover).toHaveBeenCalledOnce();
	});

	it("returns indeterminate and stops when the claim result is uncertain", async () => {
		mocks.mutation.mockRejectedValueOnce(new Error("claim response unavailable"));

		const response = await post(request());

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({ status: "indeterminate" });
		expect(mocks.recover).not.toHaveBeenCalled();
	});

	it("stops before provider reads when the recovery was already claimed", async () => {
		mocks.mutation.mockResolvedValue({ claimed: false });

		const response = await post(request());

		expect(response.status).toBe(409);
		expect(mocks.recover).not.toHaveBeenCalled();
	});

	it("durably records an ignored provider result and does not retry it", async () => {
		mocks.recover.mockResolvedValue({
			kind: "ignored",
			reason: "session_amount_mismatch",
			providerFailureObservations: {
				observedAt: 1_800_000_000_000,
				failedChecks: ["session.reconciliation"],
			},
		});

		const response = await post(request());

		expect(response.status).toBe(409);
		expect(mocks.mutation).toHaveBeenNthCalledWith(2, "orders.failManualRefundRecovery", {
			webhookSecret: "webhook-authority",
			recoveryId: MANUAL_REFUND_RECOVERY_ID,
			siteUrl: manifest.siteUrl,
			resultReason: "ignored_session_amount_mismatch",
			failureStage: "provider_evidence",
			providerFailureObservations: {
				observedAt: 1_800_000_000_000,
				failedChecks: ["session.reconciliation"],
			},
		});
	});

	it("returns an explicit indeterminate result when failure auditing is unavailable", async () => {
		mocks.recover.mockRejectedValue(new ManualRefundRecoveryEvidenceError("provider details"));
		mocks.mutation
			.mockResolvedValueOnce({ claimed: true })
			.mockRejectedValueOnce(new Error("audit unavailable"));

		const response = await post(request());

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({ status: "indeterminate" });
	});

	it("records provider evidence rejection without exposing details", async () => {
		mocks.recover.mockRejectedValue(
			new ManualRefundRecoveryEvidenceError("provider details", {
				observedAt: 1_800_000_000_000,
				failedChecks: ["current_refund.status"],
			}),
		);

		const response = await post(request());

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({ status: "failed" });
		expect(mocks.mutation).toHaveBeenNthCalledWith(2, "orders.failManualRefundRecovery", {
			webhookSecret: "webhook-authority",
			recoveryId: MANUAL_REFUND_RECOVERY_ID,
			siteUrl: manifest.siteUrl,
			resultReason: "provider_evidence_rejected",
			failureStage: "provider_evidence",
			providerFailureObservations: {
				observedAt: 1_800_000_000_000,
				failedChecks: ["current_refund.status"],
			},
		});
	});
});
