import { describe, expect, it } from "vitest";
import { renderContactOwnerNotificationHtml } from "$lib/server/contactNotificationEmailHtml";

describe("contactNotificationEmailHtml", () => {
	it("renders a restrained, responsive owner notification with one clear heading", () => {
		const html = renderContactOwnerNotificationHtml({
			name: "Avery Harper",
			email: "avery@example.com",
			subject: "Portrait availability",
			message: "Hello,\nAre you available in October?",
		});

		expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
		expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
		expect(html).toContain('<meta name="color-scheme" content="light dark">');
		expect(html).toContain("mso-hide: all");
		expect(html).toContain("@media only screen and (max-width: 640px)");
		expect(html).toContain("@media (prefers-color-scheme: dark)");
		expect(html).toContain('role="presentation"');
		expect(html).toContain('width="600"');
		expect(html).toContain("max-width: 600px");
		expect(html.match(/<h1\b/g)).toHaveLength(1);
		expect(html).toContain("A new message arrived.");
		expect(html).toContain("Avery Harper");
		expect(html).toContain("avery@example.com");
		expect(html).toContain("Portrait availability");
		expect(html).toContain("Hello,<br>Are you available in October?");
		expect(html).toContain("Reply to this email to respond to Avery Harper.");
		expect(html).not.toMatch(/<(?:img|script|link)\b/i);
		expect(html).not.toMatch(/@import|url\s*\(/i);
	});

	it("escapes every submitted value and provides a neutral missing-subject state", () => {
		const html = renderContactOwnerNotificationHtml({
			name: `<script>alert("name")</script>`,
			email: `attacker@example.com"><img src=x onerror=alert(1)>`,
			message: `<svg onload=alert("message")>\nSecond & third`,
		});

		expect(html).not.toMatch(/<script>|<img\b|<svg\b/i);
		expect(html).toContain("&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;");
		expect(html).toContain("attacker@example.com&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
		expect(html).toContain("&lt;svg onload=alert(&quot;message&quot;)&gt;<br>Second &amp; third");
		expect(html).toContain("No subject provided");
		expect(html.match(/<h1\b/g)).toHaveLength(1);
	});

	it("constrains long unbroken contact values to the mobile email width", () => {
		const unbrokenValue = "x".repeat(5000);
		const html = renderContactOwnerNotificationHtml({
			name: unbrokenValue,
			email: `${"e".repeat(240)}@example.com`,
			subject: unbrokenValue,
			message: unbrokenValue,
		});

		expect(html).toContain("max-width: 600px; table-layout: fixed;");
		expect(html).toContain("overflow-wrap: anywhere; word-break: break-word;");
		expect(html).toContain(unbrokenValue);
		expect(html.match(/<h1\b/g)).toHaveLength(1);
	});

	it("stays comfortably below a transactional-email byte ceiling at route input limits", () => {
		const html = renderContactOwnerNotificationHtml({
			name: "🌲".repeat(127),
			email: `${"e".repeat(240)}@example.com`,
			subject: "作品".repeat(127),
			message: "写真と森🌲".repeat(625),
		});

		expect(Buffer.byteLength(html, "utf8")).toBeLessThan(90 * 1024);
		expect(html.match(/<h1\b/g)).toHaveLength(1);
	});
});
