<script lang="ts">
import About from "../../../src/routes/about/+page.svelte";
import Home from "../../../src/routes/+page.svelte";
import GalleryModal from "../../../src/lib/components/GalleryModal.svelte";
import PortfolioGallery from "../../../src/routes/gallery/[slug]/+page.svelte";
import CartDrawer from "../../../src/lib/components/cart/CartDrawer.svelte";
import { cartUI } from "../../../src/lib/shop/cartUI.svelte";
import ThemeSwitcher from "../../../src/lib/components/ThemeSwitcher.svelte";
const kind = new URLSearchParams(window.location.search).get("kind") ?? "about";
const portrait = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#789abc"/></svg>');
const data = {
  siteSettings: { artistName: null, siteTitle: null, tagline: null, logoUrl: null, socialLinks: [], seo: { description: null, ogImageUrl: null, keywords: [] } },
  instagramUrl: "https://example.invalid/photographer",
  content: {
    siteUrl: "https://example.invalid",
    about: { displayName: "Fixture photographer", introduction: "Photography for people and places.", portrait: { src: portrait, altText: "Portrait fixture", sourceSha256: null }, seo: { description: "Fixture description", imageUrl: null } },
    contact: { email: "fixture@example.invalid", phone: null, inquiryChoices: [], heading: "Get in touch", intro: ["Tell me about your project.", "Available for commissions."], confirmationMessage: "Thank you for your message.", booking: { enabled: true, url: "https://cal.com/fixture/photos", calLink: "fixture/photos", label: "Book a session", intro: "Choose a time for your session." } },
  },
};
let open = $state(false);
let mounted = $state(true);
const imageCount = Number(new URLSearchParams(window.location.search).get("images") ?? 2);
const images = [{ full: portrait, alt: "First portfolio image" }, { full: `${portrait}#2`, alt: "Second portfolio image" }].slice(0, imageCount);
</script>

<ThemeSwitcher />
{#if kind === "about"}
  <About {data} />
{:else if kind === "home"}
  <Home />
{:else if kind === "portfolio-page"}
  <PortfolioGallery data={{ siteSettings: data.siteSettings, gallery: { title: "Fixture portfolio", description: null, seo: null, canonicalUrl: "https://example.invalid/gallery/fixture", images: images.map(image => ({ ...image, thumbnail: image.full })) } }} />
{:else}
  <button type="button" onclick={() => open = true}>Open portfolio lightbox</button>
  <a href="#outside">Outside lightbox link</a>
  <button type="button" onclick={() => mounted = false}>Remove lightbox host</button>
  <button type="button" onclick={() => cartUI.open()}>Open overlapping cart</button>
  {#if mounted && open}<GalleryModal {images} currentIndex={0} onClose={() => open = false} />{/if}
  <CartDrawer />
{/if}
