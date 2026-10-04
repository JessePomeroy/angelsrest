import { afterEach, expect, test, vi } from "vitest";

const sentry = vi.hoisted(() => ({
	addBreadcrumb: vi.fn(),
	captureException: vi.fn(),
	withScope: vi.fn(),
}));
vi.mock("@sentry/node", () => sentry);

import { logStructured, withPrivateIntakeLogs } from "../logger";

afterEach(() => vi.restoreAllMocks());

test("private intake drops payloads from console and Sentry without changing simultaneous ordinary logs", async () => {
	const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
	const infoLog = vi.spyOn(console, "log").mockImplementation(() => {});
	let resume: () => void = () => {};
	const waiting = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const privateWork = withPrivateIntakeLogs(async () => {
		await waiting;
		logStructured({
			event: "commerce_intake.failure",
			level: "error",
			stage: "webhook",
			durationMs: 12,
			sessionId: "private-session",
			orderId: "private-order",
			meta: { email: "buyer@example.invalid", key: "private-key" },
			error: new Error("private-provider-response"),
		});
	});
	logStructured({ event: "outside.success", meta: { ordinary: "preserved" } });
	resume();
	await privateWork;
	expect(JSON.parse(String(infoLog.mock.calls[0][0]))).toMatchObject({
		event: "outside.success",
		ordinary: "preserved",
	});
	const privatePayload = JSON.parse(String(errorLog.mock.calls[0][0]));
	expect(Object.keys(privatePayload).sort()).toEqual([
		"durationMs",
		"event",
		"level",
		"stage",
		"ts",
	]);
	expect(sentry.captureException).not.toHaveBeenCalled();
	expect(JSON.stringify(sentry.addBreadcrumb.mock.calls)).not.toMatch(/private-|buyer@example/);
});
