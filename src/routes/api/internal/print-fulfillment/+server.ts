import type { Config } from "@sveltejs/adapter-vercel";
import { error, json } from "@sveltejs/kit";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { readBoundedBytes } from "$lib/server/boundedBody";
import { runPrintFulfillmentStep } from "$lib/server/printFulfillmentJob";
import { requireRunnerBearer } from "$lib/server/runnerBearer";

export const config = { maxDuration: 60 } satisfies Config;

export async function POST({ request }: { request: Request }) {
	const secret = env.PRINT_FULFILLMENT_RUNNER_SECRET;
	if (!secret || secret.length < 32 || secret === env.WEBHOOK_SECRET)
		throw error(503, "Print runner is not configured");
	requireRunnerBearer(request, secret);
	// Bound the authenticated callback body; never accept an order, tenant, URL or provider payload.
	const body = await readBoundedBytes(request.body, 512);
	if (body.status === "missing") throw error(400, "Invalid print job");
	if (body.status === "too_large") throw error(413, "Invalid print job");
	let input: unknown;
	try {
		input = JSON.parse(new TextDecoder().decode(body.bytes));
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
