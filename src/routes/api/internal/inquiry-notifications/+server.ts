import { error, json } from "@sveltejs/kit";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { readBoundedBytes } from "$lib/server/boundedBody";
import { runInquiryNotification } from "$lib/server/inquiryNotificationRunner";
import { requireRunnerBearer } from "$lib/server/runnerBearer";

export const config = { maxDuration: 60 };

export async function POST({ request }: { request: Request }) {
	const secret = env.INQUIRY_NOTIFICATION_RUNNER_SECRET;
	if (
		!secret ||
		secret.length < 32 ||
		secret.length > 512 ||
		secret !== secret.trim() ||
		[
			env.WEBHOOK_SECRET,
			env.ORDER_LOOKUP_SECRET,
			env.STRIPE_SECRET_KEY,
			env.BETTER_AUTH_SECRET,
			env.AUTH_GOOGLE_SECRET,
		].includes(secret)
	)
		error(503, "Notification runner is not configured");
	requireRunnerBearer(request, secret);
	const raw = await readBoundedBytes(request.body, 512);
	if (raw.status === "missing") error(400, "Missing notification job");
	if (raw.status === "too_large") error(413, "Invalid notification job");
	let body: unknown;
	try {
		body = JSON.parse(raw.bytes.toString("utf8"));
	} catch {
		error(400, "Invalid notification job");
	}
	if (
		!body ||
		typeof body !== "object" ||
		Object.keys(body).length !== 2 ||
		!("id" in body) ||
		!("leaseToken" in body) ||
		typeof body.id !== "string" ||
		!/^[a-z0-9]{16,64}$/.test(body.id) ||
		typeof body.leaseToken !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.leaseToken)
	)
		error(400, "Invalid notification job");
	await runInquiryNotification(body.id as Id<"inquiryNotifications">, body.leaseToken);
	return json({ received: true });
}
