import { createHash } from "node:crypto";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { ADMIN_EMAIL, SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { getResend, getTenantResend } from "$lib/server/resendClient";
import { inquiryTenants } from "$lib/server/tenantContact";

export async function runInquiryNotification(id: Id<"inquiryNotifications">, leaseToken: string) {
	const runnerSecret = env.INQUIRY_NOTIFICATION_RUNNER_SECRET ?? "";
	const client = getConvex();
	const job = await client.query(api.inquiryNotifications.getDispatch, {
		id,
		leaseToken,
		runnerSecret,
	});
	if (!job) return;
	let outcome: "accepted" | "rejected" | "retryable" | "uncertain" = "uncertain";
	let providerId: string | undefined;
	try {
		const envelope = job.envelope;
		let sender: ReturnType<typeof getResend>;
		if (envelope.transport === "hub") {
			if (
				job.siteUrl !== SITE_DOMAIN ||
				envelope.from !== "contact@angelsrest.online" ||
				envelope.to !== (env.NOTIFICATION_EMAIL || ADMIN_EMAIL)
			)
				throw new Error("Notification configuration changed");
			sender = getResend();
		} else {
			const tenant = inquiryTenants(env.INQUIRY_TENANTS, env.WEBHOOK_SECRET ?? "").find(
				(tenant) => tenant.siteUrl === job.siteUrl,
			);
			if (
				!tenant ||
				tenant.notification.from !== envelope.from ||
				tenant.notification.to !== envelope.to
			)
				throw new Error("Notification configuration changed");
			sender = getTenantResend(tenant.notification.apiKey);
		}
		if (!sender.key) throw new Error("Sender unavailable");
		const fingerprint = createHash("sha256").update(sender.key).digest("hex");
		if (
			!(await client.mutation(api.inquiryNotifications.authorizeSender, {
				id,
				leaseToken,
				runnerSecret,
				fingerprint,
			}))
		)
			return;
		const { transport: _transport, ...email } = envelope;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const result = await Promise.race([
			sender.emails.send(email, { idempotencyKey: job.idempotencyKey }),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("Provider acceptance timed out")), 20_000);
			}),
		]).finally(() => clearTimeout(timer));
		if (result.data?.id && !result.error) {
			outcome = "accepted";
			providerId = result.data.id;
		} else if (result.error) {
			const code = result.error.statusCode;
			outcome =
				result.error.name === "concurrent_idempotent_requests" ||
				code === 429 ||
				(code !== null && code !== undefined && code >= 500)
					? "retryable"
					: "rejected";
		}
	} catch {
		outcome = "uncertain";
	}
	await client.mutation(api.inquiryNotifications.complete, {
		id,
		leaseToken,
		runnerSecret,
		outcome,
		...(providerId ? { providerId } : {}),
	});
}
