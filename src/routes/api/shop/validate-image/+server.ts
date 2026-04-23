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
 * If LumaPrints' validation API is down, we fail closed and return
 * `{ valid: false, reason: "could not verify", degraded: true }` so
 * the UI surfaces a real error instead of silently letting an
 * unverified image reach the webhook — audit H39 reversed the
 * previous fail-open behavior.
 *
 * Added in audit #23 PR #3. Updated by audit H39.
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
		throw error(400, "Invalid JSON body");
	}

	if (!isValidRequest(body)) {
		throw error(
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
		// Audit H39: fail closed, not open. Returning `{ valid: true }`
		// on error hid validation outages and let unprintable images
		// reach the webhook, where a refund-after-the-fact is the only
		// recourse. Instead surface a "could not verify" result so the
		// checkout path can show a real error to the customer.
		if (err instanceof LumaPrintsError) {
			console.warn(
				"LumaPrints checkImageConfig failed, returning valid=false:",
				err.message,
				err.details,
			);
			return json({
				valid: false,
				reason: "could not verify",
				degraded: true,
				degradedReason: "validation_unavailable",
			});
		}
		console.error("Unexpected error in checkImageConfig:", err);
		return json({
			valid: false,
			reason: "could not verify",
			degraded: true,
			degradedReason: "internal_error",
		});
	}
};
