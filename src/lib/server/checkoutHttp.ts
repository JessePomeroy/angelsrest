export const CHECKOUT_REQUEST_MAX_BYTES = 64 * 1024;
export const CHECKOUT_RESPONSE_MAX_BYTES = 2 * 1024;
export const CHECKOUT_REQUEST_TIMEOUT_MS = 5_000;

export function checkoutHttpOrigin(value: string | undefined, unavailable: () => Error) {
	try {
		const url = new URL(value ?? "");
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		)
			throw unavailable();
		return url.origin;
	} catch {
		throw unavailable();
	}
}

export async function readCheckoutHttpResponse(response: Response, unavailable: () => Error) {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const bytes = new Uint8Array(CHECKOUT_RESPONSE_MAX_BYTES);
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) return new TextDecoder().decode(bytes.subarray(0, size));
		if (size + value.byteLength > CHECKOUT_RESPONSE_MAX_BYTES) {
			await reader.cancel();
			throw unavailable();
		}
		bytes.set(value, size);
		size += value.byteLength;
	}
}
