<script lang="ts">
import AsciiImage from "$lib/components/AsciiImage.svelte";
import BookingButton from "$lib/components/BookingButton.svelte";
import ContactForm from "$lib/components/ContactForm.svelte";
import SEO from "$lib/components/SEO.svelte";
import { ABOUT_CONTACT_SEO_DESCRIPTION_FALLBACK } from "$lib/about-contact/content";

let { data } = $props();
const about = $derived(data.content.about);
const contact = $derived(data.content.contact);
</script>

<SEO
    title="about | angel's rest"
    description={about.seo.description || ABOUT_CONTACT_SEO_DESCRIPTION_FALLBACK}
    image={about.seo.imageUrl || undefined}
    url="https://angelsrest.online/about"
/>

<section class="about-page">
    <div
        class="about-grid"
    >
        <!-- Portrait -->
        <div class="portrait-column">
            <div class="portrait-frame">
                <div
                    class="portrait-image"
                >
                    <AsciiImage
                        src={about.portrait.src}
                        alt={about.portrait.altText}
                        resolution={24}
                    />
                </div>
            </div>
        </div>

        <!-- Bio -->
        <div class="biography">
            <h1 class="bio-title">{about.displayName}</h1>
            <p class="bio-intro">
                {about.introduction}
            </p>
            {#if data.instagramUrl}
                <p class="social-profile">
                    <a
                        href={data.instagramUrl}
                        target="_blank"
                        rel="noopener"
                        class="social-link"
                        >instagram</a
                    >
                </p>
            {/if}
            {#if contact.booking.enabled && contact.booking.calLink}
                <div class="booking-section">
                    <p class="booking-intro">
                        {contact.booking.intro}
                    </p>
                    <BookingButton calLink={contact.booking.calLink} label={contact.booking.label} />
                </div>
            {/if}
        </div>

        <!-- Contact form -->
        <div
            class="contact-section"
        >
            <h2 class="contact-heading">{contact.heading.toLowerCase()}</h2>
            <div class="contact-intro">
                {#each contact.intro as paragraph}
                    <p>{#each paragraph.split("\n") as line, index}{#if index > 0}<br />{/if}{line}{/each}</p>
                {/each}
            </div>
            <ContactForm hideHeader confirmationMessage={contact.confirmationMessage} />
        </div>
    </div>
</section>

<style>
    @layer components {
        .about-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; max-width: 1400px; }
        .portrait-column { height: fit-content; }
        .portrait-image { aspect-ratio: 3 / 4; width: 16rem; overflow: hidden; }
        .portrait-image :global(img) { width: 100%; height: 100%; object-fit: cover; }
        .biography, .contact-section { padding-top: 0.5rem; }
        .bio-title { font-size: var(--text-2xl); line-height: var(--text-2xl--line-height); }
        .bio-intro { font-size: var(--text-sm); line-height: 1.625; }
        .social-profile { color: var(--color-surface-400); font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
        .social-link { transition: color 150ms cubic-bezier(0.4, 0, 0.2, 1); }
        .booking-section { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid color-mix(in oklab, var(--color-surface-500) 20%, transparent); }
        .booking-intro { color: var(--color-surface-400); font-size: var(--text-xs); line-height: var(--text-xs--line-height); }
        .contact-heading { font-size: var(--text-lg); line-height: var(--text-lg--line-height); }
        .contact-intro { color: var(--color-surface-400); font-size: var(--text-sm); margin-bottom: 1rem; line-height: 1.625; }
        @media (hover: hover) { .social-link:hover { color: var(--color-surface-200); } }
        @media (min-width: 48rem) {
            .about-grid { grid-template-columns: auto 1fr; }
            .portrait-image { width: 18rem; }
            .contact-section { grid-column: span 2 / span 2; border-top: 1px solid color-mix(in oklab, var(--color-surface-500) 20%, transparent); padding-top: 1.5rem; margin-top: 0.5rem; }
        }
        @media (min-width: 64rem) {
            .about-grid { grid-template-columns: auto 1fr 1fr; gap: 2.5rem; }
            .portrait-image { width: 20rem; }
            .biography, .contact-section { padding-top: 1rem; }
            .contact-section { grid-column: span 1 / span 1; border-width: 0; margin-top: 0; }
        }
    }

    .about-page { width: 100%; }
    .portrait-frame { display: inline-block; padding: 7px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
</style>
