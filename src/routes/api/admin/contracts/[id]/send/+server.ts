import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN, SITE_URL } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { replaceTemplateVariables, sendEmail } from "$lib/server/email";

const convex = getConvex();

function formatCurrency(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

function buildDefaultContractHtml(vars: Record<string, string>): string {
	return `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
<p>hi ${vars.clientName},</p>
<p>a contract has been prepared for your review.</p>
<table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
<tr><td style="padding: 8px 0; color: #666;">contract</td><td style="padding: 8px 0; text-align: right;">${vars.title}</td></tr>
${vars.eventDate ? `<tr><td style="padding: 8px 0; color: #666;">event date</td><td style="padding: 8px 0; text-align: right;">${vars.eventDate}</td></tr>` : ""}
${vars.eventLocation ? `<tr><td style="padding: 8px 0; color: #666;">location</td><td style="padding: 8px 0; text-align: right;">${vars.eventLocation}</td></tr>` : ""}
${vars.totalPrice ? `<tr><td style="padding: 8px 0; color: #666;">total</td><td style="padding: 8px 0; text-align: right;">${vars.totalPrice}</td></tr>` : ""}
</table>
<p>please review the details and reach out with any questions.</p>
<p style="color: #999; font-size: 0.85em; margin-top: 32px;">angel's rest</p>
</div>`;
}

export async function POST({ params }) {
	const { id } = params;

	try {
		const contract = await convex.query(api.contracts.get, {
			contractId: id as Id<"contracts">,
		});
		if (!contract) throw error(404, "Contract not found");

		const clientEmail = contract.clientEmail;
		if (!clientEmail) throw error(400, "Client has no email address");

		const vars: Record<string, string> = {
			clientName: contract.clientName ?? "there",
			title: contract.title,
			eventDate: contract.eventDate ?? "",
			eventLocation: contract.eventLocation ?? "",
			totalPrice: contract.totalPrice
				? formatCurrency(contract.totalPrice)
				: "",
			depositAmount: contract.depositAmount
				? formatCurrency(contract.depositAmount)
				: "",
		};

		let subject: string;
		let html: string;

		const template = await convex.query(api.emailTemplates.getByCategory, {
			siteUrl: SITE_URL,
			category: "custom",
		});

		if (template) {
			subject = replaceTemplateVariables(template.subject, vars);
			html = replaceTemplateVariables(template.body, vars);
			if (!html.includes("<")) {
				html = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; white-space: pre-wrap;">${html}</div>`;
			}
		} else {
			subject = `contract: ${contract.title}`;
			html = buildDefaultContractHtml(vars);
		}

		const result = await sendEmail({
			to: clientEmail,
			subject,
			html,
		});

		await convex.mutation(api.emailLog.create, {
			siteUrl: SITE_URL,
			to: clientEmail,
			subject,
			type: "contract",
			relatedId: id,
			status: "sent",
			resendId: result.data?.id,
		});

		await convex.mutation(api.contracts.markSent, {
			contractId: id as Id<"contracts">,
			siteUrl: SITE_DOMAIN,
		});

		return json({ success: true });
	} catch (err: unknown) {
		const e = err as { status?: number; message?: string };
		if (e?.status) throw err;
		console.error("Failed to send contract email:", err);

		try {
			await convex.mutation(api.emailLog.create, {
				siteUrl: SITE_URL,
				to: "unknown",
				subject: "contract email",
				type: "contract",
				relatedId: id,
				status: "failed",
				error: e?.message ?? "Unknown error",
			});
		} catch {
			// best effort logging
		}

		throw error(500, "Failed to send contract email");
	}
}
