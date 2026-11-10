export type BoundedBytes =
	| { status: "ok"; bytes: Buffer }
	| { status: "missing" }
	| { status: "too_large" };

/**
 * Read a request or response body incrementally, stopping as soon as the
 * cumulative byte count exceeds `limit`. Overflow cancels the stream before any
 * aggregate allocation; cancellation failures never replace the size result.
 * Stream read errors propagate so each caller keeps its own failure mapping.
 */
export async function readBoundedBytes(
	stream: ReadableStream<Uint8Array> | null,
	limit: number,
): Promise<BoundedBytes> {
	if (!stream) return { status: "missing" };
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				try {
					await reader.cancel();
				} catch {
					// Cancellation is best-effort cleanup; keep the size failure.
				}
				return { status: "too_large" };
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return { status: "ok", bytes: Buffer.concat(chunks, total) };
}

/** Classify a declared Content-Length before reading; an absent header is `ok`. */
export function declaredLengthStatus(
	headers: Headers,
	limit: number,
): "ok" | "invalid" | "too_large" {
	const declared = headers.get("content-length");
	if (declared === null) return "ok";
	if (!/^\d+$/.test(declared)) return "invalid";
	return BigInt(declared) > BigInt(limit) ? "too_large" : "ok";
}
