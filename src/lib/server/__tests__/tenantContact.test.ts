import { expect, it, vi } from "vitest";
import { createTenantContact, inquiryTenants } from "../tenantContact";

const key = "synthetic-queenworm-inquiry-credential-0123456789";
const notice = {
	from: "contact@queenworm.example",
	to: "owner@example.test",
	brand: "Queen Worm",
	apiKey: "re_synthetic_queenworm_sender",
};
const registry = JSON.stringify({
	"queenworm.angelsrest.online": {
		origin: "https://queenworm.example",
		secrets: [key],
		turnstileSecret: "synthetic-turnstile-secret",
		notification: notice,
	},
});
const fields = {
	name: "Synthetic Person",
	email: "person@example.test",
	subject: "Portrait",
	message: "Synthetic inquiry.",
	token: "synthetic-token",
};
function setup(
	verification: unknown = { success: true, hostname: "queenworm.example", action: "contact" },
) {
	const save = vi.fn().mockResolvedValue("synthetic-inquiry-id");
	const active = vi.fn().mockResolvedValue(true);
	const notify = vi.fn().mockResolvedValue(undefined);
	const notificationFailed = vi.fn();
	const transport = vi.fn().mockImplementation(async () => Response.json(verification));
	const handler = createTenantContact({
		registry: () => registry,
		webhookSecret: () => "hub-only-secret",
		active,
		save,
		notify,
		notificationFailed,
		fetch: transport,
	});
	const request = (patch = {}, credential = key) =>
		new Request("https://hub.example/api/tenant-contact", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
			body: JSON.stringify({ ...fields, ...patch }),
		});
	return { handler, request, save, active, notify, notificationFailed, transport };
}
it("derives tenant identity from its credential, saves, then notifies the configured owner", async () => {
	const flow = setup();
	expect((await flow.handler(flow.request())).status).toBe(200);
	const expected = {
		siteUrl: "queenworm.angelsrest.online",
		name: fields.name,
		email: fields.email,
		subject: fields.subject,
		message: fields.message,
	};
	expect(flow.save).toHaveBeenCalledExactlyOnceWith(expected);
	expect(flow.notify).toHaveBeenCalledExactlyOnceWith(expected, notice, "synthetic-inquiry-id");
	expect(flow.save.mock.invocationCallOrder[0]).toBeLessThan(
		flow.notify.mock.invocationCallOrder[0],
	);
});
it("rejects tenant injection and wrong credentials before saving or notifying", async () => {
	const flow = setup();
	await expect(flow.handler(flow.request({ siteUrl: "another.example" }))).rejects.toMatchObject({
		status: 400,
	});
	await expect(flow.handler(flow.request({}, "wrong"))).rejects.toMatchObject({ status: 403 });
	expect(flow.save).not.toHaveBeenCalled();
	expect(flow.notify).not.toHaveBeenCalled();
});
it.each([
	{ success: false },
	{ success: true, hostname: "other.example", action: "contact" },
	{ success: true, hostname: "queenworm.example", action: "other" },
])("requires a successful tenant-bound contact challenge: %j", async (verification) => {
	const flow = setup(verification);
	await expect(flow.handler(flow.request())).rejects.toMatchObject({ status: 403 });
	expect(flow.save).not.toHaveBeenCalled();
});
it("blocks offboarded tenants and preserves a saved inquiry when email fails", async () => {
	const flow = setup();
	flow.active.mockResolvedValue(false);
	await expect(flow.handler(flow.request())).rejects.toMatchObject({ status: 503 });
	expect(flow.save).not.toHaveBeenCalled();
	flow.active.mockResolvedValue(true);
	flow.notify.mockRejectedValue(new Error("Provider unavailable"));
	expect((await flow.handler(flow.request())).status).toBe(200);
	expect(flow.notificationFailed).toHaveBeenCalledOnce();
});
it("rejects broad/reused credentials and missing notification configuration", () => {
	expect(() => inquiryTenants(registry, key)).toThrow();
	const parsed = JSON.parse(registry);
	parsed["another.example"] = parsed["queenworm.angelsrest.online"];
	expect(() => inquiryTenants(JSON.stringify(parsed), "hub-only-secret")).toThrow();
	delete parsed["another.example"];
	delete parsed["queenworm.angelsrest.online"].notification;
	expect(() => inquiryTenants(JSON.stringify(parsed), "hub-only-secret")).toThrow();
});
it.each([
	undefined,
	"",
	" re_synthetic_sender",
	"re_synthetic sender",
	"re_short",
])("rejects an unavailable or malformed tenant sending key: %s", (apiKey) => {
	const parsed = JSON.parse(registry);
	parsed["queenworm.angelsrest.online"].notification.apiKey = apiKey;
	expect(() => inquiryTenants(JSON.stringify(parsed), "hub-only-secret")).toThrow();
});
