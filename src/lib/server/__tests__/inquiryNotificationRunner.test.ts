import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	mutation: vi.fn(),
	send: vi.fn(),
	env: {
		INQUIRY_NOTIFICATION_RUNNER_SECRET: "synthetic-runner-01234567890123456789",
		NOTIFICATION_EMAIL: "owner@example.test",
	},
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$convex/api", () => ({
	api: {
		inquiryNotifications: {
			getDispatch: "dispatch",
			authorizeSender: "authorize",
			complete: "complete",
		},
	},
}));
vi.mock("$lib/config/site", () => ({
	ADMIN_EMAIL: "owner@example.test",
	SITE_DOMAIN: "angelsrest.online",
}));
vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: mocks.query, mutation: mocks.mutation }),
}));
vi.mock("$lib/server/resendClient", () => ({
	getResend: () => ({ key: "re_synthetic", emails: { send: mocks.send } }),
	getTenantResend: () => {
		throw new Error("unexpected tenant sender");
	},
}));

import type { Id } from "$convex/dataModel";
import { runInquiryNotification } from "../inquiryNotificationRunner";

const id = "synthetic-job" as Id<"inquiryNotifications">;
beforeEach(() => {
	vi.resetAllMocks();
	mocks.query.mockResolvedValue({
		siteUrl: "angelsrest.online",
		envelope: {
			transport: "hub",
			from: "contact@angelsrest.online",
			to: "owner@example.test",
			replyTo: "visitor@example.test",
			subject: "Synthetic",
			html: "<p>Synthetic</p>",
			text: "Synthetic",
		},
		idempotencyKey: "inquiry/synthetic",
	});
	mocks.mutation.mockResolvedValue(true);
});
it("uses frozen content and the same provider key, and records acceptance only with a provider id", async () => {
	mocks.send.mockResolvedValue({ data: { id: "provider-id" }, error: null });
	await runInquiryNotification(id, "lease");
	expect(mocks.send).toHaveBeenCalledWith(
		expect.objectContaining({ subject: "Synthetic", to: "owner@example.test" }),
		{ idempotencyKey: "inquiry/synthetic" },
	);
	expect(mocks.mutation).toHaveBeenLastCalledWith(
		"complete",
		expect.objectContaining({ outcome: "accepted", providerId: "provider-id" }),
	);
	expect(JSON.stringify(mocks.mutation.mock.calls)).not.toContain("re_synthetic");
});
it.each([
	[{ data: null, error: { statusCode: 429, name: "rate_limit_exceeded" } }, "retryable"],
	[{ data: null, error: { statusCode: 409, name: "concurrent_idempotent_requests" } }, "retryable"],
	[{ data: null, error: { statusCode: 422, name: "validation_error" } }, "rejected"],
	[{ data: null, error: null }, "uncertain"],
])("classifies provider responses without pretending acceptance: %j", async (result, outcome) => {
	mocks.send.mockResolvedValue(result);
	await runInquiryNotification(id, "lease");
	expect(mocks.mutation).toHaveBeenLastCalledWith("complete", expect.objectContaining({ outcome }));
});
it("does not send on a revoked sender binding or changed recipient", async () => {
	mocks.mutation.mockResolvedValue(false);
	await runInquiryNotification(id, "lease");
	expect(mocks.send).not.toHaveBeenCalled();
	mocks.query.mockResolvedValue({
		siteUrl: "foreign.example",
		envelope: { transport: "hub" },
		idempotencyKey: "x",
	});
	await runInquiryNotification(id, "lease");
	expect(mocks.send).not.toHaveBeenCalled();
});
