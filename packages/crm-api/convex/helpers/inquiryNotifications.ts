import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const inquiryNotificationEnvelope = v.object({
	transport: v.union(v.literal("hub"), v.literal("tenant")),
	from: v.string(),
	to: v.string(),
	replyTo: v.string(),
	subject: v.string(),
	html: v.string(),
	text: v.string(),
});
type Envelope = {
	transport: "hub" | "tenant";
	from: string;
	to: string;
	replyTo: string;
	subject: string;
	html: string;
	text: string;
};

export async function enqueueInquiryNotification(
	ctx: MutationCtx,
	inquiryId: Id<"inquiries">,
	siteUrl: string,
	envelope: Envelope,
) {
	if (
		[envelope.from, envelope.to, envelope.replyTo, envelope.subject].some(
			(value) => !value || value.length > 1000 || /[\r\n]/.test(value),
		) ||
		envelope.html.length > 100_000 ||
		envelope.text.length > 20_000
	)
		throw new Error("Invalid inquiry notification");
	const nextAt = Date.now();
	const id = await ctx.db.insert("inquiryNotifications", {
		inquiryId,
		siteUrl,
		envelope,
		state: "pending",
		attempts: 0,
		recoveries: 0,
		nextAt,
	});
	await ctx.scheduler.runAt(nextAt, internal.inquiryNotifications.wake, { id, nextAt });
}
