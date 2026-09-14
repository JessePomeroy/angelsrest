import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@sveltejs/adapter-vercel";
import { error, json } from "@sveltejs/kit";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { runPrintFulfillmentStep } from "$lib/server/printFulfillmentJob";

export const config = { maxDuration: 60 } satisfies Config;

export async function POST({ request }: { request: Request }) {
	const secret = env.PRINT_FULFILLMENT_RUNNER_SECRET;
	if (!secret || secret.length < 32 || secret === env.WEBHOOK_SECRET)
		throw error(503, "Print runner is not configured");
	const digest = (value: string) => createHash("sha256").update(value).digest();
	if (
		!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))
	)
		throw error(401, "Unauthorized");
	// Bound the authenticated callback body; never accept an order, tenant, URL or provider payload.
	const reader = request.body?.getReader();
	if (!reader) throw error(400, "Invalid print job");
	let body = "";
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			body += new TextDecoder().decode(value);
			if (body.length > 512) {
				await reader.cancel();
				throw error(413, "Invalid print job");
			}
		}
	} finally {
		reader.releaseLock();
	}
	let input: unknown;
	try {
		input = JSON.parse(body);
	} catch {
		throw error(400, "Invalid print job");
	}
	if (
		!input ||
		typeof input !== "object" ||
		!("jobId" in input) ||
		!("leaseToken" in input) ||
		Object.keys(input).length !== 2 ||
		typeof input.jobId !== "string" ||
		!/^[a-z0-9]{16,64}$/.test(input.jobId) ||
		typeof input.leaseToken !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.leaseToken)
	)
		throw error(400, "Invalid print job");
	await runPrintFulfillmentStep(input.jobId as Id<"printFulfillmentJobs">, input.leaseToken);
	return json({ received: true });
}
