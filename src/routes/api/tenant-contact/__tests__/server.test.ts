import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	save: vi.fn(),
	send: vi.fn(),
	client: vi.fn(),
	capture: vi.fn(),
	env: {
		WEBHOOK_SECRET: "synthetic-hub-secret",
		INQUIRY_TENANTS: JSON.stringify({
			"queenworm.angelsrest.online": {
				origin: "https://queenworm.example",
				secrets: ["synthetic-inquiry-credential-0123456789"],
				turnstileSecret: "synthetic-challenge-secret",
				notification: {
					from: "contact@queenworm.example",
					to: "owner@example.test",
					brand: "Queen Worm",
					apiKey: "re_synthetic_queenworm_sender",
				},
			},
		}),
	},
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$convex/api", () => ({
	api: { platformOffboarding: { isActive: "active" }, inquiries: { create: "create" } },
}));
vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: async () => ({ active: true }), mutation: mocks.save }),
}));
vi.mock("$lib/server/resendClient", () => ({
	getTenantResend: (apiKey: string) => {
		mocks.client(apiKey);
		return { emails: { send: mocks.send } };
	},
}));
vi.mock("@sentry/sveltekit", () => ({ captureException: mocks.capture }));

import { POST } from "../+server";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});
it("uses the configured owner/sender, visitor Reply-To, escaped HTML, in a durable envelope", async () => {
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValue(
				Response.json({ success: true, hostname: "queenworm.example", action: "contact" }),
			),
	);
	mocks.save.mockResolvedValue("inquiry-one");
	mocks.send.mockResolvedValue({ data: { id: "email-one" } });
	const request = new Request("https://hub.example/api/tenant-contact", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer synthetic-inquiry-credential-0123456789",
		},
		body: JSON.stringify({
			name: "<visitor>",
			email: "visitor@example.test",
			subject: "Portrait",
			message: "<script>untrusted</script>",
			token: "synthetic-token",
		}),
	});
	// The route uses only Request; other SvelteKit event fields are irrelevant here.
	const response = await POST({ request } as Parameters<typeof POST>[0]);
	expect(response.status).toBe(200);
	expect(mocks.client).not.toHaveBeenCalled();
	expect(mocks.send).not.toHaveBeenCalled();
	const mail = mocks.save.mock.calls[0][1].notification;
	expect(mail).toMatchObject({
		transport: "tenant",
		from: "contact@queenworm.example",
		to: "owner@example.test",
		replyTo: "visitor@example.test",
	});
	expect(mail.html).toContain("Queen Worm");
	expect(mail.html).toContain("&lt;script&gt;");
	expect(mail.html).not.toContain("<script>");
	expect(JSON.stringify(mail)).not.toContain("re_synthetic_queenworm_sender");
});
