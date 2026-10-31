import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: {
		INQUIRY_NOTIFICATION_RUNNER_SECRET: "synthetic-runner-secret-012345678901234",
		WEBHOOK_SECRET: "different-webhook",
	},
	run: vi.fn(),
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/inquiryNotificationRunner", () => ({ runInquiryNotification: mocks.run }));

import { POST } from "../+server";

const id = "a".repeat(32),
	leaseToken = "11111111-1111-4111-8111-111111111111";
const request = (body: string, credential = mocks.env.INQUIRY_NOTIFICATION_RUNNER_SECRET) =>
	new Request("https://hub.example/api/internal/inquiry-notifications", {
		method: "POST",
		headers: { authorization: `Bearer ${credential}` },
		body,
	});
beforeEach(() => {
	vi.clearAllMocks();
	mocks.env.INQUIRY_NOTIFICATION_RUNNER_SECRET = "synthetic-runner-secret-012345678901234";
});
it("rejects an unauthenticated runner before dispatch", async () => {
	await expect(
		POST({ request: request(JSON.stringify({ id, leaseToken }), "wrong") }),
	).rejects.toMatchObject({ status: 401 });
	expect(mocks.run).not.toHaveBeenCalled();
});
it("bounds the authenticated body and accepts only a job id plus UUID lease", async () => {
	await expect(POST({ request: request("x".repeat(513)) })).rejects.toMatchObject({ status: 413 });
	await expect(
		POST({ request: request(JSON.stringify({ id, leaseToken, siteUrl: "injected.example" })) }),
	).rejects.toMatchObject({ status: 400 });
	expect(mocks.run).not.toHaveBeenCalled();
});
it("fails closed for a reused broad credential", async () => {
	mocks.env.INQUIRY_NOTIFICATION_RUNNER_SECRET = mocks.env.WEBHOOK_SECRET;
	await expect(
		POST({ request: request(JSON.stringify({ id, leaseToken })) }),
	).rejects.toMatchObject({ status: 503 });
	expect(mocks.run).not.toHaveBeenCalled();
});
it("dispatches only the authenticated job identity", async () => {
	expect((await POST({ request: request(JSON.stringify({ id, leaseToken })) })).status).toBe(200);
	expect(mocks.run).toHaveBeenCalledExactlyOnceWith(id, leaseToken);
});
