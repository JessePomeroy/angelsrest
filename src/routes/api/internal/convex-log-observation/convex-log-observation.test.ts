import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handle: vi.fn(async () => new Response(null, { status: 200 })),
	env: {
		CONVEX_LOG_STREAM_HMAC_SECRET: "route-hmac-secret",
		SENTRY_OBSERVATION_OTLP_LOGS_ENDPOINT:
			"https://o123.ingest.sentry.io/api/456/integration/otlp/v1/logs",
		SENTRY_OBSERVATION_PUBLIC_KEY: "0123456789abcdef0123456789abcdef",
		SENTRY_OBSERVATION_ENVIRONMENT: "canary",
	},
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/convexLogObservation", () => ({
	handleConvexLogObservationRequest: mocks.handle,
}));

import { POST } from "./+server";

describe("Convex log observation route wiring", () => {
	it("delegates the untouched request with only the four server values", async () => {
		const request = new Request("https://angelsrest.online/api/internal/convex-log-observation", {
			method: "POST",
			headers: { "content-type": "application/json", "x-webhook-signature": "opaque" },
			body: "raw-body-sentinel",
		});
		const response = await POST({ request } as never);

		expect(response.status).toBe(200);
		expect(mocks.handle).toHaveBeenCalledOnce();
		expect(mocks.handle).toHaveBeenCalledWith(request, {
			hmacSecret: "route-hmac-secret",
			sentryOtlpLogsEndpoint: "https://o123.ingest.sentry.io/api/456/integration/otlp/v1/logs",
			sentryPublicKey: "0123456789abcdef0123456789abcdef",
			environment: "canary",
		});
		expect(await request.text()).toBe("raw-body-sentinel");
	});
});
