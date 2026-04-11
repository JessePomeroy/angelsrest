/**
 * Checkout-time image validation endpoint.
 *
 * Called by the shop configurator (PR #4) when a customer picks a
 * paper + size combination for a photo. Calls LumaPrints'
 * `checkImageConfig` endpoint to verify the image will print cleanly
 * at that size and subcategory.
 *
 * Returns `{ valid: true }` when the image is good, or
 * `{ valid: false, message, recommendedWidth?, recommendedHeight? }`
 * when it will be rejected (low resolution, wrong aspect ratio, etc.).
 *
 * If LumaPrints' validation API is down, we degrade gracefully by
 * returning `{ valid: true, degraded: true }` — the checkout flow
 * must never be blocked on LumaPrints availability. The webhook's
 * post-payment validation still catches anything that slips through.
 *
 * Added in audit #23 PR #3.
 */

import { error, json } from "@sveltejs/kit";
import { checkImageConfig, LumaPrintsError } from "$lib/server/lumaprints";
import type { RequestHandler } from "./$types";

interface ValidateImageRequest {
	imageUrl: string;
	subcategoryId: number;
	width: number;
	height: number;
}

function isValidRequest(body: unknown): body is ValidateImageRequest {
	if (!body || typeof body !== "object") return false;
	const b = body as Record<string, unknown>;
	return (
		typeof b.imageUrl === "string" &&
		b.imageUrl.length > 0 &&
		typeof b.subcategoryId === "number" &&
		typeof b.width === "number" &&
		b.width > 0 &&
		typeof b.height === "number" &&
		b.height > 0
	);
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return error(400, "Invalid JSON body");
	}

	if (!isValidRequest(body)) {
		return error(
			400,
			"Missing or invalid fields: imageUrl (string), subcategoryId (number), width (number > 0), height (number > 0)",
		);
	}

	try {
		const result = await checkImageConfig({
			imageUrl: body.imageUrl,
			subcategoryId: body.subcategoryId,
			width: body.width,
			height: body.height,
		});
		return json(result);
	} catch (err) {
		// Network / 5xx from LumaPrints: degrade gracefully so checkout isn't
		// blocked. The customer can still pay; the webhook's post-payment
		// submission will catch anything that slips through.
		if (err instanceof LumaPrintsError) {
			console.warn(
				"LumaPrints checkImageConfig failed, degrading to valid:",
				err.message,
				err.details,
			);
			return json({
				valid: true,
				degraded: true,
				degradedReason: "validation_unavailable",
			});
		}
		// Unknown errors: also degrade rather than block.
		console.error("Unexpected error in checkImageConfig:", err);
		return json({
			valid: true,
			degraded: true,
			degradedReason: "internal_error",
		});
	}
};
