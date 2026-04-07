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

function buildDefaultQuoteHtml(vars: Record<string, string>): string {
	return `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
<p>hi ${vars.clientName},</p>
<p>here is your quote for review.</p>
<table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
<tr><td style="padding: 8px 0; color: #666;">quote</td><td style="padding: 8px 0; text-align: right;">${vars.quoteNumber}</td></tr>
</table>
${vars.packages ? `<div style="margin: 16px 0;">${vars.packages}</div>` : ""}
${vars.validUntil ? `<p style="color: #666; font-size: 0.85em;">valid until ${vars.validUntil}</p>` : ""}
<p>please reach out if you have any questions or would like to proceed.</p>
<p style="color: #999; font-size: 0.85em; margin-top: 32px;">angel's rest</p>
</div>`;
}

function formatPackages(
	packages: { name: string; description?: string; price: number }[],
): string {
	return packages
		.map(
			(pkg) =>
				`<div style="padding: 12px 0; border-bottom: 1px solid #eee;">
<strong>${pkg.name}</strong> — ${formatCurrency(pkg.price)}
${pkg.description ? `<br><span style="color: #666; font-size: 0.9em;">${pkg.description}</span>` : ""}
</div>`,
		)
		.join("");
}

export async function POST({ params }) {
	const { id } = params;

	try {
		const quote = await convex.query(api.quotes.get, {
			quoteId: id as Id<"quotes">,
		});
		if (!quote) throw error(404, "Quote not found");

		const clientEmail = quote.clientEmail;
		if (!clientEmail) throw error(400, "Client has no email address");

		const vars: Record<string, string> = {
			clientName: quote.clientName ?? "there",
			quoteNumber: quote.quoteNumber,
			packages: formatPackages(quote.packages),
			validUntil: quote.validUntil ?? "",
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
			subject = `quote ${quote.quoteNumber}`;
			html = buildDefaultQuoteHtml(vars);
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
			type: "quote",
			relatedId: id,
			status: "sent",
			resendId: result.data?.id,
		});

		await convex.mutation(api.quotes.markSent, {
			quoteId: id as Id<"quotes">,
			siteUrl: SITE_DOMAIN,
		});

		return json({ success: true });
	} catch (err: unknown) {
		const e = err as { status?: number; message?: string };
		if (e?.status) throw err;
		console.error("Failed to send quote email:", err);

		try {
			await convex.mutation(api.emailLog.create, {
				siteUrl: SITE_URL,
				to: "unknown",
				subject: "quote email",
				type: "quote",
				relatedId: id,
				status: "failed",
				error: e?.message ?? "Unknown error",
			});
		} catch {
			// best effort logging
		}

		throw error(500, "Failed to send quote email");
	}
}
