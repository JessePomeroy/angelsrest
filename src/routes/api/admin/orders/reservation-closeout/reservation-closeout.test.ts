import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	HISTORICAL_RESERVATION_CLOSEOUT_ID,
	historicalReservationCloseoutManifest as manifest,
} from "$lib/server/historicalReservationCloseoutManifest";

const mocks = vi.hoisted(() => ({
	privateEnv: { CHECKOUT_RESERVATION_CLOSEOUT_ID: undefined as string | undefined },
	publicEnv: { PUBLIC_CONVEX_URL: "https://loyal-swan-967.convex.cloud" },
	adminConfig: { siteUrl: "angelsrest.online" },
	authorize: vi.fn(),
	createAuthenticatedClient: vi.fn(),
	mutation: vi.fn(),
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
vi.mock("$lib/server/webhookSecret", () => ({ getWebhookSecret: () => "webhook-authority" }));
vi.mock("$lib/server/logger", () => ({ logStructured: mocks.log }));
vi.mock("$convex/api", () => ({
	api: {
		orders: {
			closeHistoricalCheckoutSnapshotReservation:
				"orders.closeHistoricalCheckoutSnapshotReservation",
		},
	},
}));

function request(
	body: unknown = { closeoutId: HISTORICAL_RESERVATION_CLOSEOUT_ID },
	origin: string = manifest.expectedOrigin,
	url: string = `${manifest.expectedOrigin}/api/admin/orders/reservation-closeout`,
	contentType: string = "application/json",
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

describe("historical reservation closeout route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.privateEnv.CHECKOUT_RESERVATION_CLOSEOUT_ID = HISTORICAL_RESERVATION_CLOSEOUT_ID;
		mocks.publicEnv.PUBLIC_CONVEX_URL = manifest.expectedConvexUrl;
		mocks.adminConfig.siteUrl = manifest.siteUrl;
		mocks.authorize.mockResolvedValue({ convexToken: "session-token" });
		mocks.mutation.mockResolvedValue({ kind: "closed" });
	});

	it.each([
		["cross-origin", "https://attacker.test", manifest.expectedOrigin],
		["same-origin preview", "https://preview.test", "https://preview.test"],
	] as const)("rejects a %s request before authentication", async (_label, origin, baseUrl) => {
		const response = await post(
			request(undefined, origin, `${baseUrl}/api/admin/orders/reservation-closeout`),
		);

		expect(response.status).toBe(403);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.mutation).not.toHaveBeenCalled();
	});

	it.each([
		"host gate",
		"Convex deployment",
		"site",
	] as const)("fails closed for the wrong %s before authentication", async (gate) => {
		if (gate === "host gate") {
			mocks.privateEnv.CHECKOUT_RESERVATION_CLOSEOUT_ID = undefined;
		} else if (gate === "Convex deployment") {
			mocks.publicEnv.PUBLIC_CONVEX_URL = "https://preview.convex.cloud";
		} else {
			mocks.adminConfig.siteUrl = "other.example";
		}

		const response = await post(request());

		expect(response.status).toBe(404);
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.mutation).not.toHaveBeenCalled();
	});

	it("requires current stored site membership", async () => {
		mocks.authorize.mockResolvedValue(null);

		const response = await post(request());

		expect(response.status).toBe(401);
		expect(mocks.mutation).not.toHaveBeenCalled();
	});

	it.each([
		["wrong ID", { closeoutId: "wrong-closeout" }, "application/json"],
		[
			"caller evidence",
			{ closeoutId: HISTORICAL_RESERVATION_CLOSEOUT_ID, reservationId: "asserted" },
			"application/json",
		],
		["array", [HISTORICAL_RESERVATION_CLOSEOUT_ID], "application/json"],
		[
			"non-JSON media type",
			{ closeoutId: HISTORICAL_RESERVATION_CLOSEOUT_ID },
			"application/jsonp",
		],
		["oversized body", { closeoutId: "x".repeat(1100) }, "application/json"],
	] as const)("rejects an invalid %s request before Convex", async (_label, body, contentType) => {
		const response = await post(request(body, undefined, undefined, contentType));

		expect(response.status).toBe(400);
		expect(mocks.mutation).not.toHaveBeenCalled();
	});

	it.each([
		"closed",
		"already_closed",
	] as const)("returns the generic %s result from one authenticated mutation", async (kind) => {
		mocks.mutation.mockResolvedValue({ kind });

		const response = await post(request());

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({ status: kind });
		expect(mocks.createAuthenticatedClient).toHaveBeenCalledWith("session-token");
		expect(mocks.mutation).toHaveBeenCalledWith(
			"orders.closeHistoricalCheckoutSnapshotReservation",
			{
				webhookSecret: "webhook-authority",
				closeoutId: HISTORICAL_RESERVATION_CLOSEOUT_ID,
			},
		);
	});

	it("returns indeterminate without retry when the atomic result is uncertain", async () => {
		mocks.mutation.mockRejectedValue(new Error("response unavailable"));

		const response = await post(request());

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({ status: "indeterminate" });
		expect(mocks.mutation).toHaveBeenCalledOnce();
		expect(mocks.log).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "checkout_snapshot_reservation.admin_closeout_indeterminate",
			}),
		);
	});
});
