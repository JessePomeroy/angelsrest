import type { Config } from "@sveltejs/adapter-vercel";
import { error, json } from "@sveltejs/kit";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { readBoundedBytes } from "$lib/server/boundedBody";
import { runCommerceIntakeStep } from "$lib/server/commerceIntakeJob";
import { requireRunnerBearer } from "$lib/server/runnerBearer";
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
	requireRunnerBearer(request, secret);
	const body = await readBoundedBytes(request.body, 512);
	if (body.status === "missing") throw error(400, "Invalid commerce job");
	if (body.status === "too_large") throw error(413, "Invalid commerce job");
	let input: unknown;
	try {
		input = JSON.parse(body.bytes.toString("utf8"));
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
