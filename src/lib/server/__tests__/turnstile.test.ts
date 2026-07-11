import { describe, expect, it, vi } from "vitest";
import { TURNSTILE_VERIFY_URL } from "$lib/config/turnstile";
import { verifyTurnstileToken } from "$lib/server/turnstile";

describe("verifyTurnstileToken", () => {
	it("rejects a missing token without calling the Worker", async () => {
		const fetchImpl = vi.fn();

		await expect(verifyTurnstileToken({ token: undefined, fetchImpl })).resolves.toEqual({
			success: false,
			reason: "missing",
		});
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("accepts only an explicit successful Worker response", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);

		await expect(
			verifyTurnstileToken({ token: "challenge-token", remoteIp: "203.0.113.4", fetchImpl }),
		).resolves.toEqual({ success: true });
		expect(fetchImpl).toHaveBeenCalledWith(
			TURNSTILE_VERIFY_URL,
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ token: "challenge-token", remoteip: "203.0.113.4" }),
			}),
		);
	});

	it("rejects a completed but unsuccessful challenge", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));

		await expect(verifyTurnstileToken({ token: "rejected", fetchImpl })).resolves.toEqual({
			success: false,
			reason: "rejected",
		});
	});

	it("fails closed when the verification Worker is unavailable", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));

		await expect(verifyTurnstileToken({ token: "challenge-token", fetchImpl })).resolves.toEqual({
			success: false,
			reason: "unavailable",
		});
	});
});
