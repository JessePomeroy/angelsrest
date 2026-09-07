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
        class="grid grid-cols-1 md:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_1fr] gap-6 lg:gap-10 max-w-[1400px]"
    >
        <!-- Portrait -->
        <div class="h-fit">
            <div class="portrait-frame">
                <div
                    class="aspect-[3/4] w-64 md:w-72 lg:w-80 overflow-hidden"
                >
                    <AsciiImage
                        src={about.portrait.src}
                        alt={about.portrait.altText}
                        class="w-full h-full object-cover"
                        resolution={24}
                    />
                </div>
            </div>
        </div>

        <!-- Bio -->
        <div class="pt-2 lg:pt-4">
            <h1 class="mb-3 text-2xl">{about.displayName}</h1>
            <p class="leading-relaxed mb-3 text-sm">
                {about.introduction}
            </p>
            {#if data.instagramUrl}
                <p class="text-surface-400 text-sm">
                    <a
                        href={data.instagramUrl}
                        target="_blank"
                        rel="noopener"
                        class="hover:text-surface-200 transition-colors"
                        >instagram</a
                    >
                </p>
            {/if}
            {#if contact.booking.enabled && contact.booking.calLink}
                <div class="mt-4 pt-4 border-t border-surface-500/20">
                    <p class="text-surface-400 text-xs mb-3">
                        {contact.booking.intro}
                    </p>
                    <BookingButton calLink={contact.booking.calLink} label={contact.booking.label} />
                </div>
            {/if}
        </div>

        <!-- Contact form -->
        <div
            class="pt-2 lg:pt-4 md:col-span-2 lg:col-span-1 md:border-t md:border-surface-500/20 md:pt-6 md:mt-2 lg:border-0 lg:mt-0"
        >
            <h2 class="mb-2 text-lg">{contact.heading.toLowerCase()}</h2>
            <div class="text-surface-400 text-sm mb-4 leading-relaxed">
                {#each contact.intro as paragraph}
                    <p>{#each paragraph.split("\n") as line, index}{#if index > 0}<br />{/if}{line}{/each}</p>
                {/each}
            </div>
            <ContactForm hideHeader confirmationMessage={contact.confirmationMessage} />
        </div>
    </div>
</section>

<style>
    .about-page { width: 100%; }
    .portrait-frame { display: inline-block; padding: 7px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
</style>
