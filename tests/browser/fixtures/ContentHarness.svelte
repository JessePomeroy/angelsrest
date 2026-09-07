<script lang="ts">
import About from "../../../src/routes/about/+page.svelte";
import Home from "../../../src/routes/+page.svelte";
import GalleryModal from "../../../src/lib/components/GalleryModal.svelte";
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
const images = [{ full: portrait, alt: "First portfolio image" }, { full: portrait, alt: "Second portfolio image" }];
</script>

<ThemeSwitcher />
{#if kind === "about"}
  <About {data} />
{:else if kind === "home"}
  <Home />
{:else}
  <button type="button" onclick={() => open = true}>Open portfolio lightbox</button>
  {#if open}<GalleryModal {images} currentIndex={0} onClose={() => open = false} />{/if}
{/if}
