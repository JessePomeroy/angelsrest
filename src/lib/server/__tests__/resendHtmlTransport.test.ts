import { Resend } from "resend";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("sends HTML/text through the real Resend SDK without React email rendering", async () => {
	const fetch = vi.fn<typeof globalThis.fetch>(async () =>
		Response.json({ id: "email-local-test" }, { status: 200 }),
	);
	vi.stubGlobal("fetch", fetch);
	const payload = {
		from: "sender@example.invalid",
		to: "recipient@example.invalid",
		subject: "Delivery update",
		html: "<p>Your delivery is ready.</p>",
		text: "Your delivery is ready.",
	};

	const result = await new Resend("re_local_test").emails.send(payload, {
		idempotencyKey: "local-delivery-test",
	});

	expect(result.error).toBeNull();
	expect(result.data?.id).toBe("email-local-test");
	expect(fetch).toHaveBeenCalledExactlyOnceWith(
		"https://api.resend.com/emails",
		expect.objectContaining({
			method: "POST",
		}),
	);
	const request = fetch.mock.calls[0]?.[1];
	expect(JSON.parse(String(request?.body))).toEqual(payload);
	expect(new Headers(request?.headers).get("Idempotency-Key")).toBe("local-delivery-test");
});
