/** Pure, dependency-free HTML rendering for automated commerce email. */

export interface CommerceEmailItem {
	description: string;
	quantity: string;
	unitPrice: string;
	total: string;
}

export interface CommerceEmailBrand {
	siteName: string;
	homeUrl: string;
	receiptTextureUrl?: string;
}

export type CustomerCommerceEmailInput =
	| {
			kind: "order_confirmation";
			brand: CommerceEmailBrand;
			customerName: string;
			orderId: string;
			total: string;
			items: readonly CommerceEmailItem[];
			delivery:
				| {
						kind: "digital";
						downloadUrl: string;
				  }
				| {
						kind: "physical";
						shippingAddress: string;
						statusUrl: string;
				  };
	  }
	| {
			kind: "shipment";
			brand: CommerceEmailBrand;
			orderNumber: string;
			trackingNumber?: string;
			carrier?: string;
			statusUrl: string;
	  }
	| {
			kind: "refund_issued";
			brand: CommerceEmailBrand;
			orderNumber: string;
			refundId: string;
			total: string;
	  }
	| {
			kind: "payment_failed";
			brand: CommerceEmailBrand;
			reason: string;
			shopUrl: string;
	  };

export type OwnerCommerceEmailInput =
	| {
			kind: "new_order";
			brand: CommerceEmailBrand;
			orderId: string;
			orderNumber?: string;
			customerName: string;
			customerEmail: string;
			total: string;
			paymentStatus: string;
			items: readonly CommerceEmailItem[];
			shippingAddress: string;
			stripeUrl: string;
	  }
	| {
			kind: "webhook_failure";
			brand: CommerceEmailBrand;
			eventType: string;
			sessionId: string;
			errorMessage: string;
			stripeUrl: string;
	  }
	| {
			kind: "reconciliation_blocked";
			brand: CommerceEmailBrand;
			orderNumber: string;
			classification: string;
			adminUrl: string;
	  }
	| {
			kind: "fulfillment_refund_succeeded";
			brand: CommerceEmailBrand;
			orderNumber: string;
			customerEmail: string;
			errorSummary: string;
			refundId: string;
			total: string;
			adminUrl: string;
	  }
	| {
			kind: "automated_refund_failed";
			brand: CommerceEmailBrand;
			orderNumber: string;
			customerEmail: string;
			errorSummary: string;
			refundId: string;
			refundStatus: "failed" | "canceled";
			total: string;
			adminUrl: string;
	  }
	| {
			kind: "automated_refund_attention";
			brand: CommerceEmailBrand;
			orderNumber: string;
			customerEmail: string;
			errorSummary: string;
			refundId?: string;
			refundStatus?: "pending" | "requires_action";
			reason: string;
			total: string;
			adminUrl: string;
	  };

interface SummaryFact {
	label: string;
	value: string;
}

interface CommerceEmailDocument {
	audience: "customer" | "owner";
	siteName: string;
	homeUrl: string;
	documentTitle: string;
	preheader: string;
	eyebrow: string;
	title: string;
	intro: string;
	summary?: readonly SummaryFact[];
	body: string;
	footer: string;
}

const HTML_ESCAPE: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE[character] ?? character);
}

function escapedLines(value: string) {
	return value.split(/\r?\n/).map(escapeHtml).join("<br>");
}

function safeHref(value: string) {
	if (
		[...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
	) {
		throw new Error("Commerce email links must use an absolute http(s) URL");
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("Commerce email links must use an absolute http(s) URL");
	}
	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		parsed.username.length > 0 ||
		parsed.password.length > 0
	) {
		throw new Error("Commerce email links must use an absolute http(s) URL");
	}
	return escapeHtml(value);
}

function receiptTextureSource(brand: CommerceEmailBrand) {
	return brand.receiptTextureUrl ? safeHref(brand.receiptTextureUrl) : undefined;
}

function assertNever(value: never): never {
	throw new Error(`Unsupported commerce email kind: ${String(value)}`);
}

function renderItems(items: readonly CommerceEmailItem[]) {
	if (items.length === 0) {
		return `<tr>
		<td style="padding: 18px 0 4px; color: #6a625b; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6;">
			The payment receipt has the complete item details.
		</td>
	</tr>`;
	}

	return items
		.map(
			(item) => `<tr>
		<td style="padding: 18px 0; border-bottom: 1px solid #ddd6cc;">
			<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout: fixed;">
				<tr>
					<td valign="top" style="padding: 0 16px 0 0; color: #2f2a26; font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; word-break: break-word;">
						${escapeHtml(item.description)}
						<div style="padding-top: 4px; color: #756c64; font-size: 13px; font-weight: 400; line-height: 1.5;">${escapeHtml(item.quantity)} × ${escapeHtml(item.unitPrice)}</div>
					</td>
					<td valign="top" align="right" style="color: #2f2a26; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-variant-numeric: tabular-nums; line-height: 1.45; white-space: nowrap;">
						${escapeHtml(item.total)}
					</td>
				</tr>
			</table>
		</td>
	</tr>`,
		)
		.join("");
}

function renderReceiptItems(items: readonly CommerceEmailItem[]) {
	if (items.length === 0) {
		return `<tr>
		<td style="padding: 16px 0; border-bottom: 1px dashed #6e6a61; color: #373530; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; letter-spacing: -0.02em; line-height: 1.55;">
			The payment receipt has the complete item details.
		</td>
	</tr>`;
	}

	return items
		.map(
			(item) => `<tr>
		<td style="padding: 14px 0; border-bottom: 1px dashed #8a857a;">
			<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="table-layout: fixed;">
				<tr>
					<td valign="top" style="padding: 0 14px 0 0; color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: -0.025em; line-height: 1.35; overflow-wrap: anywhere; word-break: break-word; text-transform: uppercase;">
						${escapeHtml(item.description)}
						<div style="padding-top: 4px; color: #555149; font-size: 13px; font-weight: 400; line-height: 1.45; text-transform: none;">${escapeHtml(item.quantity)} × ${escapeHtml(item.unitPrice)}</div>
					</td>
					<td valign="top" align="right" style="width: 96px; color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; font-weight: 700; font-variant-ligatures: none; font-variant-numeric: tabular-nums; letter-spacing: -0.025em; line-height: 1.35; white-space: nowrap;">
						${escapeHtml(item.total)}
					</td>
				</tr>
			</table>
		</td>
	</tr>`,
		)
		.join("");
}

function actionBlock(label: string, url: string) {
	const escapedUrl = safeHref(url);
	return `<table class="action-table" role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 26px 0 0;">
	<tr>
		<td class="button-cell" bgcolor="#3f352e" style="border-radius: 3px; mso-padding-alt: 14px 22px; text-align: center;">
			<a class="button-link" href="${escapedUrl}" style="display: inline-block; padding: 14px 22px; color: #ffffff; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: 600; line-height: 1; text-decoration: none;">${escapeHtml(label)}</a>
		</td>
	</tr>
</table>
<p class="muted" style="margin: 22px 0 6px; color: #756c64; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.55;">If the button does not open, copy this address into your browser:</p>
<p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; word-break: break-word;"><a class="text-link" href="${escapedUrl}" style="color: #594a3f; text-decoration: underline;">${escapedUrl}</a></p>`;
}

function summaryTable(facts: readonly SummaryFact[]) {
	if (facts.length === 0) return "";
	return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 30px; border-top: 1px solid #ddd6cc; border-bottom: 1px solid #ddd6cc;">
	<tr>
		${facts
			.map(
				(
					fact,
					index,
				) => `<td class="summary-cell" valign="top" ${index > 0 ? 'align="right"' : ""} style="padding: 17px ${index > 0 ? "0 17px 12px" : "12px 17px 0"}; color: #756c64; font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 0.06em; line-height: 1.45; text-transform: uppercase;">
			${escapeHtml(fact.label)}<br><strong style="display: inline-block; padding-top: 4px; color: #2f2a26; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 0; overflow-wrap: anywhere; text-transform: none;">${escapeHtml(fact.value)}</strong>
		</td>`,
			)
			.join("")}
	</tr>
</table>`;
}

function section(heading: string, content: string, options?: { compact?: boolean }) {
	return `<tr>
	<td class="section" style="padding: ${options?.compact ? "4px 48px 36px" : "34px 48px 40px"}; border-top: 1px solid #ddd6cc;">
		<h2 style="margin: 0; color: #2f2a26; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 400; letter-spacing: -0.02em; line-height: 1.2;">${escapeHtml(heading)}</h2>
		${content}
	</td>
</tr>`;
}

function paragraph(value: string) {
	return `<p style="margin: 13px 0 0; color: #5f5750; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.65;">${escapeHtml(value)}</p>`;
}

function detailTable(rows: readonly SummaryFact[]) {
	return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 15px;">
	${rows
		.map(
			(row) => `<tr>
		<td valign="top" style="width: 132px; padding: 9px 16px 9px 0; border-bottom: 1px solid #e7e1d9; color: #756c64; font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 0.05em; line-height: 1.5; text-transform: uppercase;">${escapeHtml(row.label)}</td>
		<td valign="top" style="padding: 9px 0; border-bottom: 1px solid #e7e1d9; color: #2f2a26; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.55; overflow-wrap: anywhere;">${escapedLines(row.value)}</td>
	</tr>`,
		)
		.join("")}
</table>`;
}

function notice(value: string) {
	return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 18px;">
	<tr>
		<td class="notice-cell" bgcolor="#f2ede6" style="padding: 17px 18px; border-left: 3px solid #8b6f5b; color: #4f4741; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.65; overflow-wrap: anywhere;">${escapedLines(value)}</td>
	</tr>
</table>`;
}

function numberedSteps(steps: readonly string[]) {
	return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 16px;">
	${steps
		.map(
			(step, index) => `<tr>
		<td valign="top" style="width: 24px; padding: 3px 0 10px; color: #756c64; font-family: Georgia, 'Times New Roman', serif; font-size: 17px; line-height: 1.5;">${String(index + 1).padStart(2, "0")}</td>
		<td style="padding: 0 0 10px 12px; color: #5f5750; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6;">${escapeHtml(step)}</td>
	</tr>`,
		)
		.join("")}
</table>`;
}

function renderDocument(input: CommerceEmailDocument) {
	const siteName = escapeHtml(input.siteName);
	const homeUrl = safeHref(input.homeUrl);
	const ownerClass = input.audience === "owner" ? " owner-email" : "";

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="x-apple-disable-message-reformatting">
	<meta name="color-scheme" content="light dark">
	<meta name="supported-color-schemes" content="light dark">
	<title>${escapeHtml(input.documentTitle)} · ${siteName}</title>
	<style>
		@media only screen and (max-width: 640px) {
			.email-shell { width: 100% !important; }
			.section { padding-left: 24px !important; padding-right: 24px !important; }
			.hero-title { font-size: 34px !important; }
			.action-table, .button-cell, .button-link { display: block !important; width: 100% !important; box-sizing: border-box !important; }
			.summary-cell { display: block !important; width: 100% !important; box-sizing: border-box !important; padding: 13px 0 !important; text-align: left !important; }
		}
		@media (prefers-color-scheme: dark) {
			.email-page { background: #211d1a !important; }
			.email-shell { background: #302a26 !important; }
			.email-shell h1, .email-shell h2, .email-shell strong { color: #f3eee7 !important; }
			.email-shell p, .email-shell td, .email-shell address { color: #d1c8bd !important; }
			.email-shell, .email-shell td { border-color: #514740 !important; }
			.email-shell .text-link { color: #ead9c8 !important; }
			.email-shell .button-cell { background: #d8c2ad !important; }
			.email-shell .button-link { color: #261f1a !important; }
			.email-shell .notice-cell { background: #403832 !important; color: #f0e8df !important; }
		}
	</style>
</head>
<body class="email-page" style="margin: 0; padding: 0; background: #f1eee8; -webkit-text-size-adjust: 100%;">
	<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent; mso-hide: all;">${escapeHtml(input.preheader)}</div>
	<table class="email-page" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1eee8" style="width: 100%; background: #f1eee8;">
		<tr>
			<td align="center" style="padding: 34px 14px 46px;">
				<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
				<table class="email-shell${ownerClass}" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#fbfaf7" style="width: 100%; max-width: 600px; table-layout: fixed; background: #fbfaf7; border: 1px solid #ddd6cc; overflow-wrap: anywhere; word-break: break-word;">
					<tr>
						<td class="section" style="padding: 30px 48px 26px; border-bottom: 1px solid #ddd6cc;">
							<a class="text-link" href="${homeUrl}" style="color: #40362f; font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0.14em; line-height: 1; text-decoration: none; text-transform: uppercase;">${siteName}</a>
						</td>
					</tr>
					<tr>
						<td class="section" style="padding: 40px 48px 38px;">
							<p style="margin: 0 0 14px; color: #756c64; font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.13em; line-height: 1.4; text-transform: uppercase;">${escapeHtml(input.eyebrow)}</p>
							<h1 class="hero-title" style="margin: 0; max-width: 500px; color: #2f2a26; font-family: Georgia, 'Times New Roman', serif; font-size: 42px; font-weight: 400; letter-spacing: -0.035em; line-height: 1.08;">${escapeHtml(input.title)}</h1>
							<p style="margin: 20px 0 0; max-width: 520px; color: #5f5750; font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.7;">${escapeHtml(input.intro)}</p>
							${summaryTable(input.summary ?? [])}
						</td>
					</tr>
					${input.body}
					<tr>
						<td class="section" style="padding: 30px 48px 36px; border-top: 1px solid #ddd6cc;">
							<p style="margin: 0; color: #5f5750; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.65;">${escapeHtml(input.footer)}</p>
							<p class="muted" style="margin: 18px 0 0; color: #756c64; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.6;"><a class="text-link" href="${homeUrl}" style="color: #594a3f; text-decoration: underline;">${homeUrl}</a></p>
						</td>
					</tr>
				</table>
				<!--[if mso]></td></tr></table><![endif]-->
			</td>
		</tr>
	</table>
</body>
</html>`;
}

function receiptActionBlock(label: string, url: string) {
	const escapedUrl = safeHref(url);
	return `<table class="receipt-action" role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 22px 0 0;">
	<tr>
		<td bgcolor="#262521" style="mso-padding-alt: 13px 18px; text-align: center;">
			<a class="receipt-button" href="${escapedUrl}" style="display: inline-block; padding: 13px 18px; color: #f7f3e9; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; line-height: 1; text-decoration: none; text-transform: uppercase;">${escapeHtml(label)}</a>
		</td>
	</tr>
</table>
<p style="margin: 18px 0 5px; color: #555149; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 11px; line-height: 1.5; text-transform: uppercase;">Button not working? Use this address:</p>
<p style="margin: 0; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; word-break: break-word;"><a href="${escapedUrl}" style="color: #302e29; text-decoration: underline;">${escapedUrl}</a></p>`;
}

function receiptSection(heading: string, content: string) {
	return `<tr>
	<td class="receipt-pad" style="padding: 24px 38px 28px; border-top: 1px dashed #777269;">
		<h2 style="margin: 0; color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 16px; font-weight: 700; letter-spacing: 0.08em; line-height: 1.35; text-transform: uppercase;">${escapeHtml(heading)}</h2>
		${content}
	</td>
</tr>`;
}

/** Preserved R9 stationery treatment for a one-line design rollback or later reuse. */
export function renderClassicOrderConfirmationEmailHtml(
	input: Extract<CustomerCommerceEmailInput, { kind: "order_confirmation" }>,
) {
	const items = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 8px;">${renderItems(input.items)}</table>`;
	const delivery =
		input.delivery.kind === "digital"
			? section(
					"Your files are ready",
					`${paragraph("Your download link will remain active. If you open it from a new browser, enter the email address used at checkout to verify the order.")}${actionBlock("Download your purchase", input.delivery.downloadUrl)}`,
				)
			: `${section(
					"Shipping address",
					`<address style="margin: 14px 0 0; color: #5f5750; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-style: normal; line-height: 1.65; overflow-wrap: anywhere; word-break: break-word;">${escapedLines(input.delivery.shippingAddress)}</address>${actionBlock("View order status", input.delivery.statusUrl)}`,
				)}${section(
					"What happens next",
					numberedSteps([
						"We are arranging fulfillment for your order.",
						"You can check progress on your order status page.",
						"We will email tracking information as soon as your order ships.",
					]),
				)}`;

	return renderDocument({
		audience: "customer",
		siteName: input.brand.siteName,
		homeUrl: input.brand.homeUrl,
		documentTitle: "Order receipt",
		preheader: `${input.brand.siteName} received your payment for order ${input.orderId}.`,
		eyebrow: "Order received",
		title: "Thank you for your order.",
		intro: `Hi ${input.customerName}, we have received your order and payment.`,
		summary: [
			{ label: "Order ID", value: input.orderId },
			{ label: "Total", value: input.total },
		],
		body: `${section("Items ordered", items, { compact: true })}${delivery}`,
		footer: `Questions about your order? Reply to this email and we will help. Thank you for supporting ${input.brand.siteName}.`,
	});
}

function renderOrderReceipt(
	input: Extract<CustomerCommerceEmailInput, { kind: "order_confirmation" }>,
) {
	const siteName = escapeHtml(input.brand.siteName);
	const homeUrl = safeHref(input.brand.homeUrl);
	const textureSource = receiptTextureSource(input.brand);
	const textureBackground = textureSource ? ` background="${textureSource}"` : "";
	const items = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 10px;">${renderReceiptItems(input.items)}</table>`;
	const delivery =
		input.delivery.kind === "digital"
			? receiptSection(
					"Download",
					`<p style="margin: 13px 0 0; color: #373530; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; line-height: 1.6;">Your download stays available. On a new browser, use the email address entered at checkout.</p>${receiptActionBlock("Download purchase", input.delivery.downloadUrl)}`,
				)
			: `${receiptSection(
					"Ship to",
					`<address style="margin: 13px 0 0; color: #373530; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; font-style: normal; line-height: 1.6; overflow-wrap: anywhere; word-break: break-word; text-transform: uppercase;">${escapedLines(input.delivery.shippingAddress)}</address>${receiptActionBlock("View order status", input.delivery.statusUrl)}`,
				)}${receiptSection(
					"Next",
					`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 12px;">
				<tr><td valign="top" style="width: 28px; padding: 3px 0 9px; color: #555149; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 12px;">01</td><td style="padding: 0 0 9px 8px; color: #373530; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; line-height: 1.55;">We are arranging fulfillment for your order.</td></tr>
				<tr><td valign="top" style="width: 28px; padding: 3px 0 9px; color: #555149; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 12px;">02</td><td style="padding: 0 0 9px 8px; color: #373530; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; line-height: 1.55;">You can check progress on your order status page.</td></tr>
				<tr><td valign="top" style="width: 28px; padding: 3px 0 0; color: #555149; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 12px;">03</td><td style="padding: 0 0 0 8px; color: #373530; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; line-height: 1.55;">Tracking arrives by email as soon as the order ships.</td></tr>
			</table>`,
				)}`;

	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="x-apple-disable-message-reformatting">
	<meta name="color-scheme" content="light">
	<meta name="supported-color-schemes" content="light">
	<title>Order receipt · ${siteName}</title>
	<style>
		@media only screen and (max-width: 520px) {
			.receipt-shell { width: 100% !important; }
			.receipt-pad { padding-left: 22px !important; padding-right: 22px !important; }
			.receipt-title { font-size: 27px !important; }
			.receipt-action, .receipt-action td, .receipt-button { display: block !important; width: 100% !important; box-sizing: border-box !important; }
		}
	</style>
</head>
<body style="margin: 0; padding: 0; background: #d9d7d0; -webkit-text-size-adjust: 100%;">
	<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent; mso-hide: all;">${escapeHtml(input.brand.siteName)} received your payment for order ${escapeHtml(input.orderId)}.</div>
	<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#d9d7d0" style="width: 100%; background: #d9d7d0;">
		<tr>
			<td align="center" style="padding: 32px 12px 46px;">
				<!--[if mso]><table role="presentation" width="480" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
				<table class="receipt-shell" role="presentation" width="480" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f1e7"${textureBackground} style="width: 100%; max-width: 480px; table-layout: fixed; background-color: #f5f1e7;${textureSource ? ` background-image: url('${textureSource}'); background-position: top center; background-repeat: repeat-y; background-size: 100% auto;` : ""} box-shadow: 0 12px 28px rgba(48, 45, 39, 0.18); font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-variant-ligatures: none; overflow-wrap: anywhere; word-break: break-word;">
					<tr>
						<td class="receipt-pad" align="center" style="padding: 34px 38px 25px; border-top: 2px dashed #5f5b53; border-bottom: 1px dashed #777269;">
							<a href="${homeUrl}" style="color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 16px; font-weight: 700; letter-spacing: 0.12em; line-height: 1.4; text-decoration: none; text-transform: uppercase;">${siteName}</a>
							<p style="margin: 7px 0 0; color: #555149; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 11px; letter-spacing: 0.1em; line-height: 1.4; text-transform: uppercase;">Online shop / payment receipt</p>
						</td>
					</tr>
					<tr>
						<td class="receipt-pad" style="padding: 27px 38px 25px;">
							<p style="margin: 0; color: #555149; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; line-height: 1.4; text-transform: uppercase;">Payment received</p>
							<h1 class="receipt-title" style="margin: 11px 0 0; color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 32px; font-weight: 700; letter-spacing: -0.065em; line-height: 1; text-transform: uppercase;">Thank you.</h1>
							<p style="margin: 17px 0 0; color: #373530; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 13px; line-height: 1.6;">Hi ${escapeHtml(input.customerName)} — we have received your order and payment.</p>
							<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 22px; border-top: 1px dashed #777269; border-bottom: 1px dashed #777269;">
								<tr><td style="padding: 12px 10px 5px 0; color: #555149; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;">Order ID</td><td align="right" style="padding: 12px 0 5px 10px; color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 12px; font-weight: 700; overflow-wrap: anywhere;">${escapeHtml(input.orderId)}</td></tr>
								<tr><td style="padding: 5px 10px 12px 0; color: #555149; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;">Payment</td><td align="right" style="padding: 5px 0 12px 10px; color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 12px; font-weight: 700; text-transform: uppercase;">Confirmed</td></tr>
							</table>
						</td>
					</tr>
					${receiptSection(
						"Items sold",
						`${items}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 17px;"><tr><td style="padding: 0 12px 0 0; color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 16px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;">Total purchase</td><td align="right" style="color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;">${escapeHtml(input.total)}</td></tr></table>`,
					)}
					${delivery}
					<tr>
						<td class="receipt-pad" align="center" style="padding: 27px 38px 36px; border-top: 1px dashed #777269; border-bottom: 2px dashed #5f5b53;">
							<p style="margin: 0; color: #262521; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 15px; font-weight: 700; letter-spacing: 0.08em; line-height: 1.5; text-transform: uppercase;">— Thank you —</p>
							<p style="margin: 14px 0 0; color: #555149; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 11px; line-height: 1.55;">Questions? Reply to this email and we will help.<br>Thank you for supporting ${siteName}.</p>
							<p style="margin: 15px 0 0; font-family: 'Noto Sans Mono', 'Roboto Mono', 'Lucida Console', Monaco, Consolas, 'Liberation Mono', monospace; font-size: 11px; line-height: 1.5;"><a href="${homeUrl}" style="color: #302e29; text-decoration: underline;">${homeUrl}</a></p>
						</td>
					</tr>
				</table>
				<!--[if mso]></td></tr></table><![endif]-->
			</td>
		</tr>
	</table>
</body>
</html>`;
}

/** Render a customer-facing commerce message without owner-only facts. */
export function renderCustomerCommerceEmailHtml(input: CustomerCommerceEmailInput) {
	if (input.kind === "order_confirmation") {
		return renderOrderReceipt(input);
	}

	if (input.kind === "shipment") {
		const tracking =
			input.trackingNumber === undefined
				? paragraph("Tracking details should update soon.")
				: detailTable([
						...(input.carrier ? [{ label: "Carrier", value: input.carrier }] : []),
						{ label: "Tracking number", value: input.trackingNumber },
					]);
		return renderDocument({
			audience: "customer",
			siteName: input.brand.siteName,
			homeUrl: input.brand.homeUrl,
			documentTitle: "Shipping update",
			preheader: `Order ${input.orderNumber} has shipped.`,
			eyebrow: "Shipping update",
			title: "Your order is on its way.",
			intro: `Your ${input.brand.siteName} order has shipped. Use the details below to follow its progress.`,
			summary: [{ label: "Order", value: input.orderNumber }],
			body: section(
				"Tracking details",
				`${tracking}${actionBlock("View order status", input.statusUrl)}`,
			),
			footer: "Questions about delivery? Reply to this email and we will help.",
		});
	}

	if (input.kind === "refund_issued") {
		return renderDocument({
			audience: "customer",
			siteName: input.brand.siteName,
			homeUrl: input.brand.homeUrl,
			documentTitle: "Refund issued",
			preheader: `A full refund was issued for order ${input.orderNumber}.`,
			eyebrow: "Refund update",
			title: "Your refund has been issued.",
			intro: `We could not complete order ${input.orderNumber}, so we returned the full payment to the original payment method.`,
			summary: [
				{ label: "Order", value: input.orderNumber },
				{ label: "Refund", value: input.total },
			],
			body: section(
				"Refund details",
				`${detailTable([{ label: "Stripe refund ID", value: input.refundId }])}${paragraph("The refund has been created successfully. Your bank determines when the credit appears on your statement.")}`,
			),
			footer: `We are sorry we could not complete this order for ${input.brand.siteName}. Reply to this email if you need help.`,
		});
	}

	if (input.kind === "payment_failed") {
		return renderDocument({
			audience: "customer",
			siteName: input.brand.siteName,
			homeUrl: input.brand.homeUrl,
			documentTitle: "Payment could not be processed",
			preheader: `Your recent ${input.brand.siteName} payment could not be processed.`,
			eyebrow: "Payment update",
			title: "Your payment did not go through.",
			intro:
				"No order was completed. You can review the reason below and try again when you are ready.",
			body: section(
				"What happened",
				`${notice(input.reason)}${actionBlock("Return to the shop", input.shopUrl)}`,
			),
			footer: "If you believe this is an error or need help, reply to this email.",
		});
	}

	return assertNever(input);
}

/** Render an owner/operator commerce message whose facts may include private order details. */
export function renderOwnerCommerceEmailHtml(input: OwnerCommerceEmailInput) {
	if (input.kind === "new_order") {
		const orderReference = input.orderNumber ?? input.orderId;
		return renderDocument({
			audience: "owner",
			siteName: input.brand.siteName,
			homeUrl: input.brand.homeUrl,
			documentTitle: "New order",
			preheader: `New order ${orderReference} for ${input.total}.`,
			eyebrow: "New order",
			title: "A new order is ready.",
			intro: `${input.customerName} completed payment. Review the order and fulfillment details below.`,
			summary: [
				{ label: "Order", value: orderReference },
				{ label: "Total", value: input.total },
				{ label: "Payment", value: input.paymentStatus },
			],
			body: `${section(
				"Items to fulfill",
				`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top: 8px;">${renderItems(input.items)}</table>`,
				{ compact: true },
			)}${section(
				"Customer and delivery",
				`${detailTable([
					{ label: "Customer", value: input.customerEmail },
					{ label: "Ship to", value: input.shippingAddress },
				])}${actionBlock("Open in Stripe", input.stripeUrl)}`,
			)}`,
			footer: `This order was received through ${input.brand.siteName}.`,
		});
	}

	if (input.kind === "webhook_failure") {
		return renderDocument({
			audience: "owner",
			siteName: input.brand.siteName,
			homeUrl: input.brand.homeUrl,
			documentTitle: "Webhook failure",
			preheader: `A critical ${input.eventType} webhook operation failed.`,
			eyebrow: "Operator alert",
			title: "A webhook needs attention.",
			intro: "Stripe will retry automatically. Review the event before intervening manually.",
			summary: [
				{ label: "Event", value: input.eventType },
				{ label: "Session", value: input.sessionId },
			],
			body: `${section("Error", notice(input.errorMessage))}${section(
				"Recommended review",
				`${numberedSteps([
					"Check Stripe for the payment and current event state.",
					"Check server logs for the complete stack trace.",
					"If retries exhaust, fulfill the order only after verifying the durable order state.",
				])}${actionBlock("Open Stripe dashboard", input.stripeUrl)}`,
			)}`,
			footer: "This is an automated operator alert from the commerce webhook.",
		});
	}

	if (input.kind === "reconciliation_blocked") {
		return renderDocument({
			audience: "owner",
			siteName: input.brand.siteName,
			homeUrl: input.brand.homeUrl,
			documentTitle: "Print reconciliation blocked",
			preheader: `Automatic print reconciliation stopped for order ${input.orderNumber}.`,
			eyebrow: "Operator alert",
			title: "Print reconciliation is blocked.",
			intro:
				"The provider result could not be reconciled safely. Review both systems before taking manual action.",
			summary: [{ label: "Order", value: input.orderNumber }],
			body: section(
				"Current state",
				`${detailTable([{ label: "Classification", value: input.classification }])}${notice("No customer failure email or automatic refund was sent. The provider submission claim remains locked. This alert does not assert that the provider order is absent.")}${actionBlock("Open admin orders", input.adminUrl)}`,
			),
			footer: "Review the provider and admin records together before changing fulfillment state.",
		});
	}

	if (input.kind === "fulfillment_refund_succeeded") {
		return renderDocument({
			audience: "owner",
			siteName: input.brand.siteName,
			homeUrl: input.brand.homeUrl,
			documentTitle: "Fulfillment error and refund",
			preheader: `Order ${input.orderNumber} failed fulfillment and was refunded.`,
			eyebrow: "Urgent operator alert",
			title: "Fulfillment failed; refund issued.",
			intro: "The order was not submitted successfully and the customer refund is durable.",
			summary: [
				{ label: "Order", value: input.orderNumber },
				{ label: "Amount", value: input.total },
			],
			body: section(
				"Recovery details",
				`${detailTable([
					{ label: "Customer", value: input.customerEmail },
					{ label: "Stripe refund ID", value: input.refundId },
				])}${notice(input.errorSummary)}${paragraph("The order is marked fulfillment_error. The refund ID and terminal recovery state are stored on the order.")}${actionBlock("Open admin orders", input.adminUrl)}`,
			),
			footer: "Review the durable order and provider records before any further manual action.",
		});
	}

	if (input.kind === "automated_refund_failed") {
		const statusCopy = input.refundStatus === "canceled" ? "was canceled" : "failed";
		return renderDocument({
			audience: "owner",
			siteName: input.brand.siteName,
			homeUrl: input.brand.homeUrl,
			documentTitle: `Automated refund ${statusCopy}`,
			preheader: `The automated refund ${statusCopy} for order ${input.orderNumber}.`,
			eyebrow: "Action required",
			title: `The automated refund ${statusCopy}.`,
			intro: "No customer refund-success email was sent. The order is blocked for operator review.",
			summary: [
				{ label: "Order", value: input.orderNumber },
				{ label: "Amount", value: input.total },
			],
			body: section(
				"Refund details",
				`${detailTable([
					{ label: "Customer", value: input.customerEmail },
					{ label: "Stripe refund ID", value: input.refundId },
					{ label: "Refund status", value: input.refundStatus },
				])}${notice(input.errorSummary)}${actionBlock("Open admin orders", input.adminUrl)}`,
			),
			footer: "Review Stripe and the durable order state before taking further action.",
		});
	}

	if (input.kind === "automated_refund_attention") {
		return renderDocument({
			audience: "owner",
			siteName: input.brand.siteName,
			homeUrl: input.brand.homeUrl,
			documentTitle: "Refund needs attention",
			preheader: `The automated refund for order ${input.orderNumber} needs attention.`,
			eyebrow: "Action required",
			title: "A refund needs attention.",
			intro: "No refund success was inferred and no customer refund-success email was sent.",
			summary: [
				{ label: "Order", value: input.orderNumber },
				{ label: "Amount", value: input.total },
			],
			body: section(
				"Current state",
				`${detailTable([
					{ label: "Customer", value: input.customerEmail },
					{ label: "Stripe refund ID", value: input.refundId ?? "not observed" },
					{ label: "Refund status", value: input.refundStatus ?? "unknown" },
				])}${notice(input.reason)}${paragraph(input.errorSummary)}${paragraph("Signed Stripe refund updates may still resolve this order automatically.")}${actionBlock("Open admin orders", input.adminUrl)}`,
			),
			footer: "Review Stripe and the durable order state before taking further action.",
		});
	}

	return assertNever(input);
}
