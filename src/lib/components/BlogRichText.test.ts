import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import type { BlogTextBlock } from "$lib/blog/content";
import BlogRichText from "$lib/components/BlogRichText.svelte";

const span = (text: string) => ({ text, marks: [] });

describe("BlogRichText", () => {
	it("renders H1 and nests child lists inside their parent list item", () => {
		const blocks: BlogTextBlock[] = [
			{ type: "heading", level: 1, spans: [span("Top heading")] },
			{
				type: "list",
				level: 1,
				style: "bullet",
				items: [
					{
						blockStyle: "h2",
						spans: [span("Parent")],
						children: [
							{
								type: "list",
								level: 2,
								style: "number",
								items: [
									{
										blockStyle: "blockquote",
										spans: [span("Child")],
										children: [],
									},
								],
							},
						],
					},
				],
			},
		];

		const { body } = render(BlogRichText, { props: { blocks } });
		const html = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\s+/g, "");

		expect(html).toContain("<h1>Topheading</h1>");
		expect(html).toContain(
			"<ul><li><h2>Parent</h2><ol><li><blockquote>Child</blockquote></li></ol></li></ul>",
		);
	});
});
