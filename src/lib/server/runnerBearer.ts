import { createHash, timingSafeEqual } from "node:crypto";
import { error } from "@sveltejs/kit";

/**
 * Constant-time `Authorization: Bearer <secret>` check for internal runner
 * callbacks. Both sides are hashed so `timingSafeEqual` always compares
 * equal-length digests. Callers validate their own secret configuration first.
 */
export function requireRunnerBearer(request: Request, secret: string): void {
	const digest = (value: string) => createHash("sha256").update(value).digest();
	if (
		!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))
	)
		error(401, "Unauthorized");
}
