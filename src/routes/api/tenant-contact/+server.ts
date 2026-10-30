import { captureException } from "@sentry/sveltekit";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { renderContactOwnerNotificationHtml } from "$lib/server/contactNotificationEmailHtml";
import { getConvex } from "$lib/server/convexClient";
import { getResend } from "$lib/server/resendClient";
import { createTenantContact } from "$lib/server/tenantContact";
import type { RequestHandler } from "./$types";

// Only the hub holds WEBHOOK_SECRET. The intake key resolves one tenant server-side.
const intake = createTenantContact({
	registry: () => env.INQUIRY_TENANTS,
	webhookSecret: () => env.WEBHOOK_SECRET ?? "",
	active: async (siteUrl) =>
		(await getConvex().query(api.platformOffboarding.isActive, { siteUrl })).active === true,
	save: (inquiry) =>
		getConvex().mutation(api.inquiries.create, {
			...inquiry,
			webhookSecret: env.WEBHOOK_SECRET ?? "",
		}),
	notify: async (inquiry, notification, inquiryId) => {
		if (typeof inquiryId !== "string") throw new Error("Missing inquiry identity");
		const result = await getResend().emails.send(
			{
				from: notification.from,
				to: notification.to,
				replyTo: inquiry.email,
				subject: inquiry.subject || `Contact from ${inquiry.name}`,
				text: `Name: ${inquiry.name}\nEmail: ${inquiry.email}\n\n${inquiry.message}`,
				html: renderContactOwnerNotificationHtml({ ...inquiry, brand: notification.brand }),
			},
			{ idempotencyKey: `inquiry/${inquiryId}` },
		);
		if (result.error || !result.data?.id) throw new Error("Inquiry notification was not accepted");
	},
	// Keep the saved inquiry successful if notification fails, as on the hub contact form.
	notificationFailed: () =>
		captureException(new Error("Tenant inquiry notification failed after save"), {
			tags: { operation: "tenant-inquiry-notification" },
		}),
});
export const POST: RequestHandler = ({ request }) => intake(request);
