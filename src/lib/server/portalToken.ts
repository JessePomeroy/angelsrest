import { error } from "@sveltejs/kit";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";

/**
 * Validate a portal token and assert it matches the expected type.
 *
 * Throws 404 if the token is missing or expired, 400 if the token's type
 * doesn't match `expectedType`. Returns the valid token result narrowed
 * to `{ expired: false }`.
 */
export async function validatePortalToken(
	convex: ConvexHttpClient,
	token: string,
	expectedType: "quote" | "contract" | "invoice",
) {
	const result = await convex.query(api.portal.getByToken, { token });
	if (!result || result.expired) {
		throw error(404, "Invalid or expired token");
	}
	if (result.token.type !== expectedType) {
		throw error(400, `This token is not for a ${expectedType}`);
	}
	return result;
}
