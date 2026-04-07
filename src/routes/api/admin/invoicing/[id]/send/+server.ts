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

function buildDefaultInvoiceHtml(vars: Record<string, string>): string {
	return `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
<p>hi ${vars.clientName},</p>
<p>a new invoice has been created for you.</p>
<table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
<tr><td style="padding: 8px 0; color: #666;">invoice</td><td style="padding: 8px 0; text-align: right;">${vars.invoiceNumber}</td></tr>
<tr><td style="padding: 8px 0; color: #666;">amount</td><td style="padding: 8px 0; text-align: right;">${vars.amount}</td></tr>
${vars.dueDate ? `<tr><td style="padding: 8px 0; color: #666;">due date</td><td style="padding: 8px 0; text-align: right;">${vars.dueDate}</td></tr>` : ""}
</table>
<p>please reach out if you have any questions.</p>
<p style="color: #999; font-size: 0.85em; margin-top: 32px;">angel's rest</p>
</div>`;
}

export async function POST({ params }) {
	const { id } = params;

	try {
		const invoice = await convex.query(api.invoices.get, {
			invoiceId: id as Id<"invoices">,
		});
		if (!invoice) throw error(404, "Invoice not found");

		const clientEmail = invoice.clientEmail;
		if (!clientEmail) throw error(400, "Client has no email address");

		const total = invoice.items.reduce(
			(sum, item) => sum + item.quantity * item.unitPrice,
			0,
		);
		const taxAmount = invoice.taxPercent
			? Math.round(total * (invoice.taxPercent / 100))
			: 0;
		const grandTotal = total + taxAmount;

		const vars: Record<string, string> = {
			clientName: invoice.clientName ?? "there",
			invoiceNumber: invoice.invoiceNumber,
			amount: formatCurrency(grandTotal),
			dueDate: invoice.dueDate ?? "",
		};

		// try to find a custom email template
		let html: string;
		const template = await convex.query(api.emailTemplates.getByCategory, {
			siteUrl: SITE_URL,
			category: "custom",
		});

		if (template) {
			const subject = replaceTemplateVariables(template.subject, vars);
			html = replaceTemplateVariables(template.body, vars);
			// wrap plain text in basic html
			if (!html.includes("<")) {
				html = `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; white-space: pre-wrap;">${html}</div>`;
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
				type: "invoice",
				relatedId: id,
				status: "sent",
				resendId: result.data?.id,
			});
		} else {
			html = buildDefaultInvoiceHtml(vars);

			const subject = `invoice ${invoice.invoiceNumber}`;
			const result = await sendEmail({
				to: clientEmail,
				subject,
				html,
			});

			await convex.mutation(api.emailLog.create, {
				siteUrl: SITE_URL,
				to: clientEmail,
				subject,
				type: "invoice",
				relatedId: id,
				status: "sent",
				resendId: result.data?.id,
			});
		}

		// mark invoice as sent
		await convex.mutation(api.invoices.markSent, {
			invoiceId: id as Id<"invoices">,
			siteUrl: SITE_DOMAIN,
		});

		return json({ success: true });
	} catch (err: unknown) {
		const e = err as { status?: number; message?: string };
		if (e?.status) throw err;
		console.error("Failed to send invoice email:", err);

		// log failure
		try {
			await convex.mutation(api.emailLog.create, {
				siteUrl: SITE_URL,
				to: "unknown",
				subject: "invoice email",
				type: "invoice",
				relatedId: id,
				status: "failed",
				error: e?.message ?? "Unknown error",
			});
		} catch {
			// best effort logging
		}

		throw error(500, "Failed to send invoice email");
	}
}
