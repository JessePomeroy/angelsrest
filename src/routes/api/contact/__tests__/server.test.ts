import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: {
		WEBHOOK_SECRET: "test-webhook-secret" as string | undefined,
		NOTIFICATION_EMAIL: "notifications@example.com",
	},
	verifyTurnstileToken: vi.fn(),
	resendSend: vi.fn(),
	convexMutation: vi.fn(),
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));

vi.mock("$lib/server/turnstile", () => ({
	verifyTurnstileToken: mocks.verifyTurnstileToken,
}));

vi.mock("$lib/server/resendClient", () => ({
	getResend: () => ({ emails: { send: mocks.resendSend } }),
}));

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ mutation: mocks.convexMutation }),
}));

vi.mock("$convex/api", () => ({
	api: { inquiries: { create: "inquiries.create" } },
}));

vi.mock("$lib/config/site", () => ({
	ADMIN_EMAIL: "admin@example.com",
	SITE_DOMAIN: "angelsrest.online",
}));

import { renderContactOwnerNotificationHtml } from "$lib/server/contactNotificationEmailHtml";
import { POST } from "../+server";

function postRequest(overrides: Record<string, unknown> = {}) {
	return {
		request: new Request("https://angelsrest.online/api/contact", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Example Person",
				email: "person@example.com",
				subject: "Question",
				message: "Hello",
				"cf-turnstile-response": "challenge-token",
				...overrides,
			}),
		}),
		getClientAddress: () => "203.0.113.4",
	};
}

describe("contact API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.WEBHOOK_SECRET = "test-webhook-secret";
		mocks.verifyTurnstileToken.mockResolvedValue({ success: true });
		mocks.resendSend.mockResolvedValue({
			data: { id: "email-1" },
			error: null,
			headers: null,
		});
		mocks.convexMutation.mockResolvedValue("inquiry-1");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("fails closed before side effects when Turnstile rejects the request", async () => {
		mocks.verifyTurnstileToken.mockResolvedValue({ success: false, reason: "rejected" });

		const response = await POST(postRequest() as never);

		expect(response.status).toBe(403);
		expect(mocks.resendSend).not.toHaveBeenCalled();
		expect(mocks.convexMutation).not.toHaveBeenCalled();
	});

	it("atomically requests one durable, replyable owner notification with the verified inquiry", async () => {
		const response = await POST(postRequest() as never);
		expect(response.status).toBe(200);
		expect(mocks.convexMutation).toHaveBeenCalledExactlyOnceWith("inquiries.create", {
			webhookSecret: "test-webhook-secret",
			siteUrl: "angelsrest.online",
			name: "Example Person",
			email: "person@example.com",
			subject: "Question",
			message: "Hello",
			notification: {
				transport: "hub",
				from: "contact@angelsrest.online",
				to: "notifications@example.com",
				replyTo: "person@example.com",
				subject: "Question",
				text: "Name: Example Person\nEmail: person@example.com\n\nHello",
				html: renderContactOwnerNotificationHtml({
					name: "Example Person",
					email: "person@example.com",
					subject: "Question",
					message: "Hello",
				}),
			},
		});
		expect(mocks.resendSend).not.toHaveBeenCalled();
	});
	it("uses a fallback subject in the queued envelope", async () => {
		expect((await POST(postRequest({ subject: " " }) as never)).status).toBe(200);
		expect(mocks.convexMutation.mock.calls[0][1].notification.subject).toBe(
			"Contact from Example Person",
		);
	});
	it("does not confirm persistence when atomic enqueue fails", async () => {
		mocks.convexMutation.mockRejectedValue(new Error("Unavailable"));
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect((await POST(postRequest() as never)).status).toBe(500);
		expect(mocks.resendSend).not.toHaveBeenCalled();
	});

	it("fails closed when the shared Convex secret is missing", async () => {
		mocks.env.WEBHOOK_SECRET = undefined;

		const response = await POST(postRequest() as never);

		expect(response.status).toBe(503);
		expect(mocks.verifyTurnstileToken).not.toHaveBeenCalled();
		expect(mocks.resendSend).not.toHaveBeenCalled();
		expect(mocks.convexMutation).not.toHaveBeenCalled();
	});
});
