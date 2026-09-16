<script lang="ts">
import type { BlogPostDetail } from "$lib/blog/content";
import ContactForm from "$lib/components/ContactForm.svelte";
import Layout from "../../../src/routes/+layout.svelte";
import BlogPost from "../../../src/routes/blog/[slug]/+page.svelte";
import Product from "../../../src/routes/shop/[slug]/+page.svelte";
import { demonstrationPost, demonstrationProduct, siteSettings } from "./public-data";
import { page } from "./state.svelte";

const params = new URLSearchParams(window.location.search);
const requested = params.get("presentation");
const presentation = requested === "caseStudy" || requested === "behindTheScenes" || requested === "technical" || requested === "clientStory" ? requested : "standard";
const screen = params.get("screen");
page.url = new URL(screen === "contact" ? "/about" : screen === "product" ? "/shop/handbook-example" : "/blog/handbook-example", "https://example.invalid");
const post: BlogPostDetail = { ...demonstrationPost, presentation };
const productData = {
	siteSettings, productType: "v1",
	product: { ...demonstrationProduct, category: params.get("kind") === "digital" ? "digital" : "merchandise", inStock: params.get("state") !== "sold_out" },
} satisfies import("../../../src/routes/shop/[slug]/$types").PageData;
</script>

<Layout data={{ siteSettings }} params={{}}>
	{#if screen === "contact"}
		<section class="handbook-contact" aria-label="Complete contact component example">
			<ContactForm />
		</section>
	{:else if screen === "product"}
		<Product data={productData} />
	{:else}
		<BlogPost data={{ post, siteSettings }} />
	{/if}
</Layout>

<style>
.handbook-contact { width: min(100%, 640px); margin: 0 auto; }
</style>
