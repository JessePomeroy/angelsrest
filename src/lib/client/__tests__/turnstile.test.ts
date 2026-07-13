/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

const SCRIPT_SELECTOR = 'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]';

function fakeApi() {
	return {
		render: vi.fn(() => "widget-id"),
		reset: vi.fn(),
		remove: vi.fn(),
	};
}

function setTurnstile(value?: ReturnType<typeof fakeApi>) {
	Object.defineProperty(window, "turnstile", {
		configurable: true,
		writable: true,
		value,
	});
}

afterEach(() => {
	document.querySelectorAll(SCRIPT_SELECTOR).forEach((script) => {
		script.remove();
	});
	Reflect.deleteProperty(window, "turnstile");
	vi.useRealTimers();
	vi.resetModules();
});

describe("loadTurnstile", () => {
	it("reuses an API that is already loaded", async () => {
		const api = fakeApi();
		setTurnstile(api);
		const { loadTurnstile } = await import("../turnstile");

		await expect(loadTurnstile()).resolves.toBe(api);
		expect(document.querySelector(SCRIPT_SELECTOR)).toBeNull();
	});

	it("shares one in-flight explicit script load", async () => {
		const { loadTurnstile } = await import("../turnstile");
		const first = loadTurnstile();
		const second = loadTurnstile();
		const script = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
		const api = fakeApi();

		expect(second).toBe(first);
		expect(script?.src).toContain("api.js?render=explicit");
		expect(document.querySelectorAll(SCRIPT_SELECTOR)).toHaveLength(1);
		setTurnstile(api);
		script?.dispatchEvent(new Event("load"));

		await expect(first).resolves.toBe(api);
		await expect(second).resolves.toBe(api);
	});

	it("removes a failed script and permits a clean retry", async () => {
		const { loadTurnstile } = await import("../turnstile");
		const first = loadTurnstile();
		const failedScript = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
		failedScript?.dispatchEvent(new Event("error"));

		await expect(first).rejects.toThrow("Failed to load Turnstile");
		expect(failedScript?.isConnected).toBe(false);

		const retry = loadTurnstile();
		const retryScript = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
		const api = fakeApi();
		expect(retryScript).not.toBe(failedScript);
		setTurnstile(api);
		retryScript?.dispatchEvent(new Event("load"));

		await expect(retry).resolves.toBe(api);
	});

	it("ignores a late failed load and can reuse a subsequently available API", async () => {
		vi.useFakeTimers();
		const { loadTurnstile } = await import("../turnstile");
		const first = loadTurnstile();
		const timedOutScript = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
		const rejection = expect(first).rejects.toThrow("Timed out loading Turnstile");

		await vi.advanceTimersByTimeAsync(10_000);
		await rejection;
		expect(timedOutScript?.isConnected).toBe(false);

		const api = fakeApi();
		setTurnstile(api);
		timedOutScript?.dispatchEvent(new Event("load"));
		await expect(loadTurnstile()).resolves.toBe(api);
	});
});
