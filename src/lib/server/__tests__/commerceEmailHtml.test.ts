import { describe, expect, it } from "vitest";
import {
	type CustomerCommerceEmailInput,
	type OwnerCommerceEmailInput,
	renderClassicOrderConfirmationEmailHtml,
	renderCustomerCommerceEmailHtml,
	renderOwnerCommerceEmailHtml,
} from "$lib/server/commerceEmailHtml";

const receiptTextureUrl =
	"https://media.angelsrest.online/sites/angelsrest.online/email/receipt-paper-warning-lines-60eaecf2f022.jpg";

const physicalInput = {
	kind: "order_confirmation" as const,
	brand: {
		siteName: "Angel's Rest",
		homeUrl: "https://angelsrest.online",
		receiptTextureUrl,
	},
	customerName: "Avery Harper",
	orderId: "cs_test_123",
	total: "$78.00",
	items: [
		{
			description: "Archival print — 8×10",
			quantity: "2",
			unitPrice: "$24.00",
			total: "$48.00",
		},
		{ description: "Walnut frame", quantity: "1", unitPrice: "$30.00", total: "$30.00" },
	],
	delivery: {
		kind: "physical" as const,
		shippingAddress: "Avery Harper\n123 Forest Road\nDetroit, MI 48201\nUS",
		statusUrl: "https://angelsrest.online/orders?order=ORD-018",
	},
};

describe("commerceEmailHtml", () => {
	it("renders an email-safe used receipt with unit pricing, paper texture, and a status path", () => {
		const html = renderCustomerCommerceEmailHtml(physicalInput);

		expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
		expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
		expect(html).toContain('<meta name="color-scheme" content="light">');
		expect(html).toContain("mso-hide: all");
		expect(html).toContain("@media only screen and (max-width: 520px)");
		expect(html).toContain(`background="${receiptTextureUrl}"`);
		expect(html).toContain(`background-image: url('${receiptTextureUrl}')`);
		expect(html).not.toContain('<img src="cid:');
		expect(html).toContain('role="presentation"');
		expect(html).toContain('width="480"');
		expect(html).toContain("max-width: 480px");
		expect(html).toContain("'Noto Sans Mono', 'Roboto Mono'");
		expect(html).not.toContain("font-family: 'Courier New', Courier, monospace");
		expect(html.match(/<h1\b/g)).toHaveLength(1);
		expect(html).toContain("Thank you.");
		expect(html).toContain("Angel&#39;s Rest");
		expect(html).toContain("Items sold");
		expect(html).toContain("Ship to");
		expect(html).toContain("2 × $24.00");
		expect(html).toContain("Avery Harper<br>123 Forest Road<br>Detroit, MI 48201<br>US");
		expect(html).toContain("Next");
		expect(html).toContain(
			'<a class="receipt-button" href="https://angelsrest.online/orders?order=ORD-018"',
		);
		expect(html).toContain(">View order status</a>");
		expect(html).toContain("mso-padding-alt: 13px 18px");
		expect(html.match(/https:\/\/angelsrest\.online\/orders\?order=ORD-018/g)).toHaveLength(3);
		expect(html).not.toContain("Your files are ready");
		expect(html).not.toMatch(/<(?:script|link)\b/i);
		expect(html).not.toContain("@import");
	});

	it("keeps the receipt usable when a tenant has no public paper texture", () => {
		const html = renderCustomerCommerceEmailHtml({
			...physicalInput,
			brand: {
				siteName: physicalInput.brand.siteName,
				homeUrl: physicalInput.brand.homeUrl,
			},
		});

		expect(html).not.toContain("background-image: url(");
		expect(html).not.toContain("media.angelsrest.online");
		expect(html).toContain("2 × $24.00");
	});

	it("keeps the original stationery order-confirmation design available as a backup", () => {
		const html = renderClassicOrderConfirmationEmailHtml(physicalInput);

		expect(html).toContain('<meta name="color-scheme" content="light dark">');
		expect(html).toContain("@media only screen and (max-width: 640px)");
		expect(html).toContain("@media (prefers-color-scheme: dark)");
		expect(html).toContain('width="600"');
		expect(html).toContain("Thank you for your order.");
		expect(html).toContain("Items ordered");
		expect(html).toContain("2 × $24.00");
	});

	it("keeps alert copy legible when a client applies the dark color scheme", () => {
		const html = renderCustomerCommerceEmailHtml({
			kind: "payment_failed",
			brand: physicalInput.brand,
			reason: "The payment could not be completed.",
			shopUrl: "https://angelsrest.online/shop",
		});

		expect(html).toContain('<td class="notice-cell" bgcolor="#f2ede6"');
		expect(html).toContain(
			".email-shell .notice-cell { background: #403832 !important; color: #f0e8df !important; }",
		);
	});

	it("constrains long unbroken item and address values to the mobile email width", () => {
		const unbrokenValue = "x".repeat(500);
		const html = renderCustomerCommerceEmailHtml({
			...physicalInput,
			items: [{ description: unbrokenValue, quantity: "1", unitPrice: "$25.00", total: "$25.00" }],
			delivery: {
				kind: "physical",
				shippingAddress: unbrokenValue,
				statusUrl: "https://angelsrest.online/orders",
			},
		});

		expect(html).toContain("max-width: 480px; table-layout: fixed;");
		expect(html).toContain(
			"letter-spacing: -0.025em; line-height: 1.35; overflow-wrap: anywhere; word-break: break-word;",
		);
		expect(html).toContain(
			"font-style: normal; line-height: 1.6; overflow-wrap: anywhere; word-break: break-word;",
		);
		expect(html).toContain(unbrokenValue);
	});

	it("renders the digital branch with the tenant download link and visible fallback URL", () => {
		const html = renderCustomerCommerceEmailHtml({
			...physicalInput,
			brand: {
				siteName: "Reflecting Pool",
				homeUrl: "https://zippymiggy.com",
			},
			delivery: {
				kind: "digital",
				downloadUrl: "https://zippymiggy.com/checkout/success?session_id=cs_test_123&source=email",
			},
		});

		expect(html).toContain(">Reflecting Pool</a>");
		expect(html).toContain("Download");
		expect(html).toContain(">Download purchase</a>");
		expect(html).toContain(
			'href="https://zippymiggy.com/checkout/success?session_id=cs_test_123&amp;source=email"',
		);
		expect(
			html.match(
				/https:\/\/zippymiggy\.com\/checkout\/success\?session_id=cs_test_123&amp;source=email/g,
			),
		).toHaveLength(3);
		expect(html).toContain("use the email address entered at checkout");
		expect(html).not.toContain("Ship to");
		expect(html).not.toContain(">Next</h2>");
		expect(html).not.toContain("View order status");
	});

	it("escapes every dynamic text and attribute value", () => {
		const html = renderCustomerCommerceEmailHtml({
			kind: "order_confirmation",
			brand: {
				siteName: `Studio <em>One</em> & "Two"`,
				homeUrl: "https://studio.example",
			},
			customerName: `<script>alert("customer")</script>`,
			orderId: `order"><img src=x onerror=alert(1)>`,
			total: `<strong>$12.00</strong>`,
			items: [
				{
					description: `<svg onload=alert("item")>`,
					quantity: `<i>2</i>`,
					unitPrice: `<u>$3.00</u>`,
					total: `& <b>$6.00</b>`,
				},
			],
			delivery: {
				kind: "physical",
				shippingAddress: `<a href="bad">Attacker</a>\nSecond & Third`,
				statusUrl: `https://studio.example/orders?order="><script>alert(1)</script>`,
			},
		});

		expect(html).not.toMatch(/<script>|<img\b|<svg\b|<em>|<strong>\$12|<i>2|<u>\$3|<a href="bad"/i);
		expect(html).toContain("Studio &lt;em&gt;One&lt;/em&gt; &amp; &quot;Two&quot;");
		expect(html).toContain("&lt;script&gt;alert(&quot;customer&quot;)&lt;/script&gt;");
		expect(html).toContain("order&quot;&gt;");
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
		expect(html).toContain("&lt;svg onload=alert(&quot;item&quot;)&gt;");
		expect(html).toContain("&lt;a href=&quot;bad&quot;&gt;");
		expect(html).toContain("Second &amp; Third");
		expect(html).toContain(
			'href="https://studio.example/orders?order=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
		);
		expect(html).not.toContain('onmouseover="alert(1)');
	});

	it("renders every customer lifecycle branch without accepting owner-only facts", () => {
		const brand = physicalInput.brand;
		const fixtures: readonly CustomerCommerceEmailInput[] = [
			{
				kind: "shipment",
				brand,
				orderNumber: "ORD-019",
				trackingNumber: "TRACK-123",
				carrier: "FedEx",
				statusUrl: "https://angelsrest.online/orders",
			},
			{
				kind: "refund_issued",
				brand,
				orderNumber: "ORD-020",
				refundId: "re_123456789",
				total: "$78.00",
			},
			{
				kind: "payment_failed",
				brand,
				reason: "Your card was declined.",
				shopUrl: "https://angelsrest.online/shop",
			},
		];

		const documents = fixtures.map(renderCustomerCommerceEmailHtml);
		for (const html of documents) {
			expect(html.match(/<h1\b/g)).toHaveLength(1);
			expect(html).not.toMatch(/<(?:img|script|link)\b/i);
			expect(html).not.toContain("buyer@example.com");
			expect(html).not.toContain("Provider rejected fulfillment");
		}
		expect(documents[0]).toContain("Your order is on its way.");
		expect(documents[0]).toContain("TRACK-123");
		expect(documents[0]).toContain("FedEx");
		expect(documents[0]).toContain(">View order status</a>");
		expect(documents[1]).toContain("Your refund has been issued.");
		expect(documents[1]).toContain("re_123456789");
		expect(documents[2]).toContain("Your payment did not go through.");
		expect(documents[2]).toContain("Your card was declined.");
		expect(documents[2]).toContain(">Return to the shop</a>");
	});

	it("renders every owner lifecycle branch with private facts confined to owner documents", () => {
		const brand = physicalInput.brand;
		const common = {
			brand,
			orderNumber: "ORD-021",
			customerEmail: "buyer+private@example.com",
			errorSummary: `Provider said <retry id="secret">`,
			total: "$78.00",
			adminUrl: "https://angelsrest.online/admin/orders",
		};
		const fixtures: readonly OwnerCommerceEmailInput[] = [
			{
				kind: "new_order",
				brand,
				orderId: "cs_test_owner",
				orderNumber: "ORD-021",
				customerName: "Avery Harper",
				customerEmail: common.customerEmail,
				total: common.total,
				paymentStatus: "paid",
				items: physicalInput.items,
				shippingAddress: physicalInput.delivery.shippingAddress,
				stripeUrl: "https://dashboard.stripe.com/payments/pi_test_owner",
			},
			{
				kind: "webhook_failure",
				brand,
				eventType: "checkout.session.completed",
				sessionId: "cs_test_owner",
				errorMessage: common.errorSummary,
				stripeUrl: "https://dashboard.stripe.com",
			},
			{
				kind: "reconciliation_blocked",
				brand,
				orderNumber: common.orderNumber,
				classification: "Provider result remained ambiguous",
				adminUrl: common.adminUrl,
			},
			{
				kind: "fulfillment_refund_succeeded",
				...common,
				refundId: "re_succeeded",
			},
			{
				kind: "automated_refund_failed",
				...common,
				refundId: "re_failed",
				refundStatus: "failed",
			},
			{
				kind: "automated_refund_attention",
				...common,
				reason: "The refund request outcome is unknown.",
			},
		];

		const documents = fixtures.map(renderOwnerCommerceEmailHtml);
		for (const html of documents) {
			expect(html.match(/<h1\b/g)).toHaveLength(1);
			expect(html).not.toMatch(/<(?:img|script|link)\b/i);
		}
		expect(documents[0]).toContain("A new order is ready.");
		expect(documents[0]).toContain(common.customerEmail);
		expect(documents[0]).toContain(">Open in Stripe</a>");
		expect(documents[1]).toContain("A webhook needs attention.");
		expect(documents[1]).toContain("&lt;retry id=&quot;secret&quot;&gt;");
		expect(documents[2]).toContain("Print reconciliation is blocked.");
		expect(documents[2]).toContain("does not assert that the provider order is absent");
		expect(documents[3]).toContain("Fulfillment failed; refund issued.");
		expect(documents[4]).toContain("The automated refund failed.");
		expect(documents[5]).toContain("Stripe refund ID");
		expect(documents[5]).toContain("not observed");
	});

	it("rejects non-web, credential-bearing, and whitespace-bearing action URLs", () => {
		for (const homeUrl of [
			"javascript:alert(1)",
			"https://user:password@example.com",
			"https://example.com/line\nbreak",
		]) {
			expect(() =>
				renderCustomerCommerceEmailHtml({
					...physicalInput,
					brand: { ...physicalInput.brand, homeUrl },
				}),
			).toThrow("absolute http(s) URL");
		}
	});

	it("stays below the Gmail clipping threshold for the maximum accepted cart shape", () => {
		const html = renderCustomerCommerceEmailHtml({
			...physicalInput,
			orderId: `cs_test_${"界".repeat(120)}`,
			items: Array.from({ length: 40 }, (_, index) => ({
				description: `${index + 1} · ${"界".repeat(250)}`,
				quantity: "20",
				unitPrice: "$49.99",
				total: "$999.99",
			})),
		});

		expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(90 * 1024);
		expect(html).toContain("40 ·");
		expect(html.match(/20 × \$49\.99/g)).toHaveLength(40);
	});
});
