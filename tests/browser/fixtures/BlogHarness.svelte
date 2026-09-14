<script lang="ts">
import type { BlogPostDetail, BlogTextSpan } from "$lib/blog/content";
import Standard from "$lib/components/templates/Standard.svelte";
import BehindTheScenes from "$lib/components/templates/BehindTheScenes.svelte";
import CaseStudy from "$lib/components/templates/CaseStudy.svelte";
import ClientStory from "$lib/components/templates/ClientStory.svelte";
import Technical from "$lib/components/templates/Technical.svelte";
import BlogIndex from "../../../src/routes/blog/+page.svelte";
const kind = new URLSearchParams(window.location.search).get("kind") ?? "standard";
const image = { src: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="#789abc"/><circle cx="400" cy="120" r="80" fill="#ccddee"/></svg>'), alt: "Fixture landscape", width: 600, height: 240, caption: "A quiet moment beside the water.", framing: null };
const spans = (text: string): BlogTextSpan[] => [{ text, marks: [] }];
const post: BlogPostDetail = {
  siteUrl: "https://example.invalid", title: "An afternoon by the water", slug: "afternoon", publishedAt: "2026-06-10T12:00:00Z", excerpt: "Notes on light, people and place.", presentation: "standard", author: { name: "Fixture photographer", image }, categories: [{ title: "Field notes" }, { title: "Photography" }], mainImage: image,
  seoTitle: null, seoDescription: null, brief: "Keep the day natural and the photographs honest.", approach: "Work with the light and leave room for spontaneous moments.", outcome: "A collection of memories to return to.", credits: null, materials: [],
  equipment: [{ kind: "photography", camera: "Film camera", lens: "50mm lens", filmStock: "Color negative", developer: "C-41" }, { kind: "summary", label: "Tripod", details: "For the quieter frames" }],
  body: [
    { type: "heading", level: 1, spans: spans("Looking for the light") },
    { type: "paragraph", spans: [...spans("We arrived beside the water. "), { text: "The light changed", marks: [{ type: "strong" }] }, ...spans(" and we followed it. "), { text: "A quiet moment", marks: [{ type: "emphasis" }] }, ...spans(" made the afternoon.\nRead "), { text: "our field notes", marks: [{ type: "link", href: "#field-notes" }, { type: "strong" }] }, ...spans(" for the details.")] },
    { type: "heading", level: 2, spans: spans("Working slowly") },
    { type: "quote", spans: spans("Give the scene time to tell its own story.") },
    { type: "list", level: 1, style: "bullet", items: [{ blockStyle: "normal", spans: spans("Watch the reflections"), children: [{ type: "list", level: 2, style: "number", items: [{ blockStyle: "normal", spans: spans("Wait for the ripples"), children: [] }, { blockStyle: "h4", spans: spans("Make the frame"), children: [] }] }] }, { blockStyle: "normal", spans: spans("Keep the horizon simple"), children: [] }] },
    { type: "heading", level: 3, spans: spans("The small details") },
    { type: "paragraph", spans: spans("A breeze, a reflection, a shift in expression. These are the details that make a photograph feel alive.") },
    { type: "image", image },
    { type: "heading", level: 4, spans: spans("What we took home") },
    { type: "paragraph", spans: spans("A few good frames and a reason to come back.") },
  ],
};
</script>

<div class="blog-fixture">
  {#if kind === "standard"}<Standard {post} />
  {:else if kind === "behindTheScenes"}<BehindTheScenes {post} />
  {:else if kind === "caseStudy"}<CaseStudy {post} />
  {:else if kind === "clientStory"}<ClientStory {post} />
  {:else if kind === "technical"}<Technical {post} />
  {:else}<BlogIndex data={{ siteSettings: { artistName: null, siteTitle: null, tagline: null, logoUrl: null, socialLinks: [], seo: { description: null, ogImageUrl: null, keywords: [] } }, posts: kind === "empty" ? [] : [post] }} />{/if}
</div>
<style>.blog-fixture { padding: 2rem 1rem; max-width: 1200px; margin-inline: auto; }</style>
