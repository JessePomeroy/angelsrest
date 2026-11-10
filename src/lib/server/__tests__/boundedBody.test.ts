import { describe, expect, test, vi } from "vitest";
import { declaredLengthStatus, readBoundedBytes } from "$lib/server/boundedBody";
import { requireRunnerBearer } from "$lib/server/runnerBearer";

function chunked(chunks: Uint8Array[], cancel = vi.fn()) {
	let index = 0;
	const pulled = vi.fn();
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			pulled();
			const chunk = chunks[index++];
			if (chunk) controller.enqueue(chunk);
			else controller.close();
		},
		cancel,
	});
	return { stream, cancel, pulled };
}

describe("readBoundedBytes", () => {
	test("reports a missing body without reading", async () => {
		await expect(readBoundedBytes(null, 10)).resolves.toEqual({ status: "missing" });
	});

	test("concatenates chunks under the limit and releases the stream", async () => {
		const { stream, cancel } = chunked([new Uint8Array([1, 2]), new Uint8Array([3])]);
		const result = await readBoundedBytes(stream, 10);
		expect(result.status).toBe("ok");
		if (result.status === "ok") expect([...result.bytes]).toEqual([1, 2, 3]);
		expect(cancel).not.toHaveBeenCalled();
		expect(stream.locked).toBe(false);
	});

	test("accepts a body of exactly the limit", async () => {
		const { stream } = chunked([new Uint8Array(4), new Uint8Array(6)]);
		const result = await readBoundedBytes(stream, 10);
		expect(result).toMatchObject({ status: "ok" });
		if (result.status === "ok") expect(result.bytes.byteLength).toBe(10);
	});

	test("cancels as soon as cumulative bytes cross the limit", async () => {
		const { stream, cancel, pulled } = chunked([
			new Uint8Array(6),
			new Uint8Array(5),
			new Uint8Array(100),
		]);
		await expect(readBoundedBytes(stream, 10)).resolves.toEqual({ status: "too_large" });
		expect(cancel).toHaveBeenCalledOnce();
		// The third chunk is never requested once the second crosses the limit.
		expect(pulled).toHaveBeenCalledTimes(2);
		expect(stream.locked).toBe(false);
	});

	test("counts UTF-8 bytes rather than decoded characters", async () => {
		const encoded = new TextEncoder().encode("é".repeat(6));
		expect(encoded.byteLength).toBe(12);
		await expect(readBoundedBytes(new Response(encoded).body, 10)).resolves.toEqual({
			status: "too_large",
		});
	});

	test("keeps the size result when cancellation fails", async () => {
		const { stream } = chunked([new Uint8Array(11)], vi.fn().mockRejectedValue(new Error("x")));
		await expect(readBoundedBytes(stream, 10)).resolves.toEqual({ status: "too_large" });
	});

	test("propagates stream read errors and releases the reader", async () => {
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(new Error("socket reset"));
			},
		});
		await expect(readBoundedBytes(stream, 10)).rejects.toThrow("socket reset");
		expect(stream.locked).toBe(false);
	});
});

describe("declaredLengthStatus", () => {
	const headers = (value?: string) =>
		new Headers(value === undefined ? {} : { "content-length": value });

	test.each([
		[undefined, "ok"],
		["0", "ok"],
		["10", "ok"],
		["11", "too_large"],
		["9".repeat(40), "too_large"],
		["", "invalid"],
		["-1", "invalid"],
		["1.0", "invalid"],
		["1e3", "invalid"],
	] as const)("classifies %j", (value, expected) => {
		expect(declaredLengthStatus(headers(value), 10)).toBe(expected);
	});
});

describe("requireRunnerBearer", () => {
	const secret = "runner-fixture-0123456789abcdef01234567";
	const request = (authorization?: string) =>
		new Request("https://fixture.test/api/internal/runner", {
			method: "POST",
			headers: authorization === undefined ? {} : { authorization },
		});

	test.each([
		["missing header", undefined],
		["wrong scheme", `Basic ${secret}`],
		["lowercase scheme", `bearer ${secret}`],
		["wrong token", "Bearer wrong"],
		["token prefix", `Bearer ${secret.slice(0, -1)}`],
		["bare token", secret],
	])("rejects a %s with 401", (_label, authorization) => {
		expect(() => requireRunnerBearer(request(authorization), secret)).toThrow(
			expect.objectContaining({ status: 401, body: { message: "Unauthorized" } }),
		);
	});

	test("accepts the configured bearer token", () => {
		expect(() => requireRunnerBearer(request(`Bearer ${secret}`), secret)).not.toThrow();
	});
});
