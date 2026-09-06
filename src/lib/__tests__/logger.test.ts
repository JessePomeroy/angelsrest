import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
	captureException: vi.fn(),
	addBreadcrumb: vi.fn(),
	setTag: vi.fn(),
	setExtra: vi.fn(),
	setContext: vi.fn(),
}));
vi.mock("@sentry/node", () => ({
	...sentry,
	withScope: (callback: (scope: typeof sentry) => void) => callback(sentry),
}));

import { logStructured, timed } from "../server/logger";

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("structured logging", () => {
	it("writes structured info with metadata and a breadcrumb", () => {
		logStructured({
			event: "order.created",
			stage: "order_create",
			orderId: "ORD-001",
			durationMs: 42,
			meta: { itemCount: 3 },
		});
		expect(console.log).toHaveBeenCalledOnce();
		const payload = JSON.parse(vi.mocked(console.log).mock.calls[0][0]);
		expect(payload).toEqual({
			ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			level: "info",
			event: "order.created",
			stage: "order_create",
			orderId: "ORD-001",
			durationMs: 42,
			itemCount: 3,
		});
		expect(sentry.addBreadcrumb).toHaveBeenCalledExactlyOnceWith({
			category: "order_create",
			message: "order.created",
			level: "info",
			data: payload,
		});
		expect(sentry.captureException).not.toHaveBeenCalled();
	});

	it.each([
		[undefined, "log", "info"],
		["warn", "warn", "warning"],
		["error", "error", "info"],
	] as const)("routes %s without an exception to %s and a breadcrumb", (level, method, breadcrumbLevel) => {
		logStructured({ event: "noop", level });
		expect(console[method]).toHaveBeenCalledOnce();
		for (const other of ["log", "warn", "error"] as const) {
			if (other !== method) expect(console[other]).not.toHaveBeenCalled();
		}
		const payload = JSON.parse(vi.mocked(console[method]).mock.calls[0][0]);
		expect(payload).toEqual({ ts: expect.any(String), level: level ?? "info", event: "noop" });
		expect(sentry.addBreadcrumb).toHaveBeenCalledExactlyOnceWith({
			category: "app",
			message: "noop",
			level: breadcrumbLevel,
			data: payload,
		});
		expect(sentry.captureException).not.toHaveBeenCalled();
	});

	it("forwards exceptions and contextual tags without a breadcrumb", () => {
		const error = new Error("kapow");
		logStructured({
			event: "fail",
			level: "error",
			stage: "lumaprints_submit",
			orderId: "ORD-007",
			error,
		});
		expect(console.error).toHaveBeenCalledOnce();
		expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
			level: "error",
			errorMessage: "kapow",
		});
		expect(sentry.captureException).toHaveBeenCalledExactlyOnceWith(error);
		expect(sentry.setTag).toHaveBeenCalledWith("stage", "lumaprints_submit");
		expect(sentry.setTag).toHaveBeenCalledWith("orderId", "ORD-007");
		expect(sentry.addBreadcrumb).not.toHaveBeenCalled();
	});

	it("returns a timed result and logs its elapsed duration", async () => {
		vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(142);
		await expect(timed({ event: "done" }, async () => "ok")).resolves.toBe("ok");
		expect(console.log).toHaveBeenCalledOnce();
		expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toMatchObject({
			event: "done",
			level: "info",
			durationMs: 42,
		});
	});

	it("logs elapsed failure and rethrows the original error", async () => {
		vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(125);
		const error = new Error("network down");
		await expect(
			timed({ event: "failed" }, async () => {
				throw error;
			}),
		).rejects.toBe(error);
		expect(console.error).toHaveBeenCalledOnce();
		expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toMatchObject({
			level: "error",
			errorMessage: "network down",
			durationMs: 25,
		});
		expect(sentry.captureException).toHaveBeenCalledWith(error);
	});
});
