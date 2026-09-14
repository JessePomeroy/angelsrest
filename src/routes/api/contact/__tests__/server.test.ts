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

	it("persists the verified inquiry before sending one replyable owner notification", async () => {
		const response = await POST(postRequest() as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
		expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith({
			token: "challenge-token",
			remoteIp: "203.0.113.4",
		});
		expect(mocks.convexMutation).toHaveBeenCalledWith("inquiries.create", {
			webhookSecret: "test-webhook-secret",
			siteUrl: "angelsrest.online",
			name: "Example Person",
			email: "person@example.com",
			subject: "Question",
			message: "Hello",
		});
		expect(mocks.resendSend).toHaveBeenCalledOnce();
		expect(mocks.resendSend).toHaveBeenCalledWith({
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
		});
		expect(mocks.convexMutation.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.resendSend.mock.invocationCallOrder[0] as number,
		);
	});

	it("preserves the fallback envelope while rendering an absent-subject state", async () => {
		const response = await POST(postRequest({ subject: "   " }) as never);

		expect(response.status).toBe(200);
		expect(mocks.resendSend).toHaveBeenCalledWith({
			from: "contact@angelsrest.online",
			to: "notifications@example.com",
			replyTo: "person@example.com",
			subject: "Contact from Example Person",
			text: "Name: Example Person\nEmail: person@example.com\n\nHello",
			html: renderContactOwnerNotificationHtml({
				name: "Example Person",
				email: "person@example.com",
				subject: undefined,
				message: "Hello",
			}),
		});
	});

	it("does not notify the owner when inquiry persistence fails", async () => {
		const persistenceError = new Error("Convex unavailable");
		mocks.convexMutation.mockRejectedValue(persistenceError);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await POST(postRequest() as never);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Failed to send" });
		expect(mocks.convexMutation).toHaveBeenCalledOnce();
		expect(mocks.resendSend).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledWith("Contact form error:", persistenceError);
	});

	it("contains a rejected owner notification after the inquiry is durable", async () => {
		const deliveryError = new Error("Resend transport unavailable");
		mocks.resendSend.mockRejectedValue(deliveryError);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await POST(postRequest() as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
		expect(mocks.convexMutation).toHaveBeenCalledOnce();
		expect(mocks.resendSend).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith(
			"[contact] owner notification failed after inquiry was saved",
			deliveryError,
		);
	});

	it("contains a resolved Resend API error after the inquiry is durable", async () => {
		mocks.resendSend.mockResolvedValue({
			data: null,
			error: { message: "Resend rejected notification" },
			headers: null,
		});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await POST(postRequest() as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
		expect(mocks.convexMutation).toHaveBeenCalledOnce();
		expect(mocks.resendSend).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith(
			"[contact] owner notification failed after inquiry was saved",
			expect.objectContaining({ message: "Resend rejected notification" }),
		);
	});

	it("contains a Resend response with no delivery id after the inquiry is durable", async () => {
		mocks.resendSend.mockResolvedValue({ data: null, error: null, headers: null });
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await POST(postRequest() as never);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
		expect(mocks.convexMutation).toHaveBeenCalledOnce();
		expect(mocks.resendSend).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith(
			"[contact] owner notification failed after inquiry was saved",
			expect.objectContaining({ message: "Owner notification returned no delivery id" }),
		);
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
