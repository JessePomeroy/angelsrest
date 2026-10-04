import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@sveltejs/adapter-vercel";
import { error, json } from "@sveltejs/kit";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { runCommerceIntakeStep } from "$lib/server/commerceIntakeJob";
import type { RequestHandler } from "./$types";

export const config = { maxDuration: 120 } satisfies Config;

export const POST: RequestHandler = async ({ request }) => {
	const secret = env.COMMERCE_INTAKE_RUNNER_SECRET;
	if (
		!secret ||
		secret.length < 32 ||
		secret === env.WEBHOOK_SECRET ||
		secret === env.PRINT_FULFILLMENT_RUNNER_SECRET
	)
		throw error(503, "Commerce runner is not configured");
	const digest = (value: string) => createHash("sha256").update(value).digest();
	if (
		!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))
	) {
		throw error(401, "Unauthorized");
	}
	const reader = request.body?.getReader();
	if (!reader) throw error(400, "Invalid commerce job");
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > 512) {
				await reader.cancel();
				throw error(413, "Invalid commerce job");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	let input: unknown;
	try {
		input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw error(400, "Invalid commerce job");
	}
	if (
		!input ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		!("inboxId" in input) ||
		!("leaseToken" in input) ||
		Object.keys(input).length !== 2 ||
		typeof input.inboxId !== "string" ||
		!/^[a-z0-9]{16,64}$/.test(input.inboxId) ||
		typeof input.leaseToken !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.leaseToken)
	) {
		throw error(400, "Invalid commerce job");
	}
	try {
		await runCommerceIntakeStep(input.inboxId as Id<"commerceIntakeInbox">, input.leaseToken);
	} catch {
		throw error(503, "Commerce intake is temporarily unavailable");
	}
	return json({ received: true });
};
