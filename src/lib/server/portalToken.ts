import { error } from "@sveltejs/kit";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";

/**
 * Validate a portal token and assert it matches the expected type.
 *
 * Throws:
 *   - 404 if the token is missing, expired, or already used
 *   - 400 if the token's type doesn't match `expectedType`
 *
 * Returns the valid token result narrowed to `{ expired: false }`.
 *
 * Note: the Convex side also performs these checks atomically inside each
 * action mutation (`acceptQuote`, `declineQuote`, `signContract`). This helper
 * is now used primarily for *read* paths where we want to serve the portal
 * page with early rejection.
 */
export async function validatePortalToken(
	convex: ConvexHttpClient,
	token: string,
	expectedType: "quote" | "contract" | "invoice",
) {
	const result = await convex.query(api.portal.getByToken, { token });
	if (!result) {
		throw error(404, "Invalid token");
	}
	if (result.expired) {
		throw error(
			404,
			result.reason === "used" ? "This link has already been used" : "This link has expired",
		);
	}
	if (result.token.type !== expectedType) {
		throw error(400, `This token is not for a ${expectedType}`);
	}
	return result;
}
