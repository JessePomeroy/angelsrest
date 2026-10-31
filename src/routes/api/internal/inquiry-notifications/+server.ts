import { createHash, timingSafeEqual } from "node:crypto";
import { error, json } from "@sveltejs/kit";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { runInquiryNotification } from "$lib/server/inquiryNotificationRunner";

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
	const digest = (value: string) => createHash("sha256").update(value).digest();
	if (
		!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))
	)
		error(401, "Unauthorized");
	const reader = request.body?.getReader();
	if (!reader) error(400, "Missing notification job");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 512) {
				await reader.cancel();
				error(413, "Invalid notification job");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	let body: unknown;
	try {
		body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
