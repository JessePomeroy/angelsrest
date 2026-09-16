import type { BlogPostDetail, BlogTextSpan } from "$lib/blog/content";

const spans = (text: string): BlogTextSpan[] => [{ text, marks: [] }];
// Already-published portfolio photography; this is not a private delivery asset.
const image = {
	src: "https://media.angelsrest.online/sites/angelsrest.online/web/6ef3cb89-b2d3-40db-9e98-54eff3e7e2a8/card.webp",
	alt: "Published portfolio photograph used in a synthetic handbook article",
	width: 768, height: 512, caption: "Original public portfolio asset · demonstration article.", framing: null,
};
export const siteSettings = {
	artistName: null, siteTitle: null, tagline: null, logoUrl: null, socialLinks: [],
	seo: { description: null, ogImageUrl: null, keywords: [] },
};
export const demonstrationProduct = {
	title: "Photographic field notes", slug: "handbook-example",
	description: "A fictional product for documenting the implemented shop template.",
	category: "merchandise", price: 24, inStock: true, featured: false,
	images: [{ full: image.src, thumbnail: image.src, original: image.src, alt: image.alt }],
};
export const demonstrationPost: BlogPostDetail = {
	siteUrl: "https://example.invalid", title: "A study in available light", slug: "handbook-example",
	publishedAt: "2026-09-10T12:00:00Z", excerpt: "A synthetic article for documenting the implemented blog templates.",
	presentation: "standard", author: { name: "Demonstration author", image: null },
	categories: [{ title: "Field notes" }, { title: "Photography" }], mainImage: image,
	seoTitle: null, seoDescription: null,
	brief: "Observe how available light changes a familiar place.",
	approach: "Work slowly, follow the light, and keep the framing simple.",
	outcome: "A short photographic sequence with room for quiet details.", credits: "Demonstration content only.", materials: [],
	equipment: [
		{ kind: "photography", camera: "35mm film camera", lens: "50mm lens", filmStock: "Color negative", developer: "C-41" },
		{ kind: "summary", label: "Tripod", details: "For the quieter frames" },
	],
	body: [
		{ type: "heading", level: 2, spans: spans("Looking for the light") },
		{ type: "paragraph", spans: [...spans("These are invented field notes. "), { text: "The light changed", marks: [{ type: "strong" }] }, ...spans(" as we worked. "), { text: "A quiet moment", marks: [{ type: "emphasis" }] }, ...spans(" gave the sequence its shape.")] },
		{ type: "quote", spans: spans("Give the scene time to tell its own story.") },
		{ type: "heading", level: 3, spans: spans("Working slowly") },
		{ type: "list", level: 1, style: "bullet", items: [
			{ blockStyle: "normal", spans: spans("Watch the edges of the frame"), children: [] },
			{ blockStyle: "normal", spans: spans("Leave room for the unexpected"), children: [] },
		] },
		{ type: "image", image },
		{ type: "paragraph", spans: spans("A small set of observations, documented here to show the article's reading rhythm.") },
	],
};
