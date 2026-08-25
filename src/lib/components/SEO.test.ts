import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import SEO from "$lib/components/SEO.svelte";

const defaultImageUrl = "https://www.angelsrest.online/og-image.png";
const retiredImagePath = ["/og-image", ".jpg"].join("");

describe("SEO", () => {
	it("uses the direct PNG fallback when image is omitted or undefined", () => {
		const omittedImageHead = render(SEO).head;
		const undefinedImageHead = render(SEO, {
			props: { image: undefined },
		}).head;

		for (const head of [omittedImageHead, undefinedImageHead]) {
			expect(head).toContain(`<meta property="og:image" content="${defaultImageUrl}"/>`);
			expect(head).not.toContain(retiredImagePath);
		}
	});

	it("normalizes a relative image against the public site origin", () => {
		const { head } = render(SEO, {
			props: { image: "/images/custom-og.webp" },
		});

		expect(head).toContain(
			'<meta property="og:image" content="https://angelsrest.online/images/custom-og.webp"/>',
		);
	});

	it("preserves an absolute media image URL", () => {
		const image = "https://media.angelsrest.online/blog/example.webp";
		const { head } = render(SEO, { props: { image } });

		expect(head).toContain(`<meta property="og:image" content="${image}"/>`);
	});
});
