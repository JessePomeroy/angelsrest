import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @sentry/sveltekit before importing the logger so the logger picks
// up the mocked module. vi.mock is hoisted statically — see
// `feedback_vitest_mock_hoisting.md` for why we don't re-apply this in
// beforeEach.
vi.mock("@sentry/sveltekit", () => {
	const captureException = vi.fn();
	const addBreadcrumb = vi.fn();
	const setTag = vi.fn();
	const setExtra = vi.fn();
	const setContext = vi.fn();
	const withScope = vi.fn((cb: (scope: unknown) => void) => {
		cb({ setTag, setExtra, setContext });
	});
	return {
		captureException,
		addBreadcrumb,
		withScope,
		// Expose the inner mocks for assertions
		__mocks: { captureException, addBreadcrumb, setTag, setExtra, setContext },
	};
});

import * as Sentry from "@sentry/sveltekit";
import { logStructured, timed } from "../server/logger";

// biome-ignore lint/suspicious/noExplicitAny: test access to mock internals
const sentryMocks = (Sentry as any).__mocks as {
	captureException: ReturnType<typeof vi.fn>;
	addBreadcrumb: ReturnType<typeof vi.fn>;
	setTag: ReturnType<typeof vi.fn>;
	setExtra: ReturnType<typeof vi.fn>;
	setContext: ReturnType<typeof vi.fn>;
};

describe("logStructured", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		sentryMocks.captureException.mockClear();
		sentryMocks.addBreadcrumb.mockClear();
		sentryMocks.setTag.mockClear();
		sentryMocks.setExtra.mockClear();
		sentryMocks.setContext.mockClear();
	});

	afterEach(() => {
		logSpy.mockRestore();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	describe("JSON output shape", () => {
		it("emits a JSON line to console.log for info events", () => {
			logStructured({
				event: "order.created",
				stage: "order_create",
				orderId: "ORD-001",
				durationMs: 42,
			});

			expect(logSpy).toHaveBeenCalledTimes(1);
			const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
			expect(payload).toMatchObject({
				level: "info",
				event: "order.created",
				stage: "order_create",
				orderId: "ORD-001",
				durationMs: 42,
			});
			expect(payload.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("uses console.warn for warn level", () => {
			logStructured({ event: "fee.unavailable", level: "warn" });
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(logSpy).not.toHaveBeenCalled();
		});

		it("uses console.error for error level", () => {
			logStructured({
				event: "lumaprints.failed",
				level: "error",
				error: new Error("boom"),
			});
			expect(errorSpy).toHaveBeenCalledTimes(1);
		});

		it("strips undefined fields from output", () => {
			logStructured({ event: "noop" });
			const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
			expect(payload).not.toHaveProperty("orderId");
			expect(payload).not.toHaveProperty("sessionId");
			expect(payload).not.toHaveProperty("durationMs");
			expect(payload).not.toHaveProperty("stage");
		});

		it("includes errorMessage when error is provided", () => {
			logStructured({
				event: "fail",
				level: "error",
				error: new Error("kapow"),
			});
			const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
			expect(payload.errorMessage).toBe("kapow");
		});

		it("merges meta fields into the payload", () => {
			logStructured({
				event: "order.created",
				meta: { itemCount: 3, paperId: 42 },
			});
			const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
			expect(payload.itemCount).toBe(3);
			expect(payload.paperId).toBe(42);
		});
	});

	describe("Sentry routing", () => {
		it("calls captureException when level=error and error is provided", () => {
			const err = new Error("kaboom");
			logStructured({
				event: "lumaprints.failed",
				level: "error",
				stage: "lumaprints_submit",
				orderId: "ORD-007",
				error: err,
			});

			expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
			expect(sentryMocks.captureException).toHaveBeenCalledWith(err);
			expect(sentryMocks.setTag).toHaveBeenCalledWith("stage", "lumaprints_submit");
			expect(sentryMocks.setTag).toHaveBeenCalledWith("orderId", "ORD-007");
			expect(sentryMocks.addBreadcrumb).not.toHaveBeenCalled();
		});

		it("does NOT call captureException for info events", () => {
			logStructured({ event: "order.created", orderId: "ORD-001" });
			expect(sentryMocks.captureException).not.toHaveBeenCalled();
		});

		it("does NOT call captureException for error level WITHOUT an error object", () => {
			// Edge case: someone calls level=error but only as a flag, no exception
			// to forward. We still log to console.error but skip Sentry capture.
			logStructured({ event: "manual.error", level: "error" });
			expect(sentryMocks.captureException).not.toHaveBeenCalled();
			expect(sentryMocks.addBreadcrumb).toHaveBeenCalledTimes(1);
		});

		it("adds a breadcrumb for info events", () => {
			logStructured({
				event: "order.created",
				stage: "order_create",
				orderId: "ORD-001",
			});
			expect(sentryMocks.addBreadcrumb).toHaveBeenCalledTimes(1);
			const crumb = sentryMocks.addBreadcrumb.mock.calls[0][0];
			expect(crumb.category).toBe("order_create");
			expect(crumb.message).toBe("order.created");
			expect(crumb.level).toBe("info");
		});

		it("maps warn level to warning breadcrumb", () => {
			logStructured({ event: "fee.unavailable", level: "warn" });
			const crumb = sentryMocks.addBreadcrumb.mock.calls[0][0];
			expect(crumb.level).toBe("warning");
		});

		it("uses 'app' as default breadcrumb category when stage is omitted", () => {
			logStructured({ event: "noop" });
			const crumb = sentryMocks.addBreadcrumb.mock.calls[0][0];
			expect(crumb.category).toBe("app");
		});
	});
});

describe("timed", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		sentryMocks.captureException.mockClear();
		sentryMocks.addBreadcrumb.mockClear();
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("logs an info entry with durationMs on success", async () => {
		const result = await timed(
			{ event: "lumaprints.submitted", stage: "lumaprints_submit" },
			async () => {
				await new Promise((r) => setTimeout(r, 5));
				return "ok";
			},
		);

		expect(result).toBe("ok");
		expect(logSpy).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
		expect(payload.event).toBe("lumaprints.submitted");
		expect(payload.level).toBe("info");
		expect(payload.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("logs an error entry with durationMs and re-throws on failure", async () => {
		const err = new Error("network down");
		await expect(
			timed({ event: "lumaprints.submitted", stage: "lumaprints_submit" }, async () => {
				throw err;
			}),
		).rejects.toThrow("network down");

		expect(errorSpy).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(errorSpy.mock.calls[0][0] as string);
		expect(payload.level).toBe("error");
		expect(payload.errorMessage).toBe("network down");
		expect(sentryMocks.captureException).toHaveBeenCalledWith(err);
	});
});
