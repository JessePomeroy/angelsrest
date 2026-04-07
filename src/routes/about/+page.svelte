<script lang="ts">
import { PortableText } from "@portabletext/svelte";
import portrait from "$lib/assets/DSCF7533.jpg";
import AsciiImage from "$lib/components/AsciiImage.svelte";
import ContactForm from "$lib/components/ContactForm.svelte";
import SEO from "$lib/components/SEO.svelte";

let { data } = $props();
const contact = $derived(data.contactPage);
</script>

<svelte:head>
    <!-- Cal element-click embed code begins -->
    <script type="text/javascript">
        (function (C, A, L) {
            let p = function (a, ar) {
                a.q.push(ar);
            };
            let d = C.document;
            C.Cal =
                C.Cal ||
                function () {
                    let cal = C.Cal;
                    let ar = arguments;
                    if (!cal.loaded) {
                        cal.ns = {};
                        cal.q = cal.q || [];
                        d.head.appendChild(d.createElement("script")).src = A;
                        cal.loaded = true;
                    }
                    if (ar[0] === L) {
                        const api = function () {
                            p(api, arguments);
                        };
                        const namespace = ar[1];
                        api.q = api.q || [];
                        if (typeof namespace === "string") {
                            cal.ns[namespace] = cal.ns[namespace] || api;
                            p(cal.ns[namespace], ar);
                            p(cal, ["initNamespace", namespace]);
                        } else p(cal, ar);
                        return;
                    }
                    p(cal, ar);
                };
        })(window, "https://app.cal.com/embed/embed.js", "init");

        Cal("init", "photosession", { origin: "https://app.cal.com" });

        Cal.ns.photosession("ui", {
            hideEventTypeDetails: false,
            layout: "month_view",
            useSlotsViewOnSmallScreen: true,
        });
    </script>
    <!-- Cal element-click embed code ends -->
</svelte:head>

<SEO
    title="about | angel's rest"
    description={data.about?.seo?.description || "About Jesse Pomeroy — photographer, visual artist, and web developer. Get in touch for inquiries and collaborations."}
    image={data.about?.seo?.ogImageUrl || "/og-image.jpg"}
    url="https://angelsrest.online/about"
/>

<section class="px-6! md:px-8! lg:px-10!">
    <div
        class="grid grid-cols-1 md:grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_1fr] gap-6 lg:gap-10 max-w-[1400px]"
    >
        <!-- Portrait -->
        <div class="h-fit">
            <div
                class="bg-surface-500/10 border border-surface-500/20 p-2 rounded-lg inline-block"
            >
                <div
                    class="aspect-[3/4] w-64 md:w-72 lg:w-80 overflow-hidden rounded-md"
                >
                    <AsciiImage
                        src={portrait}
                        alt={data.about?.name || "Portrait"}
                        class="w-full h-full object-cover"
                        resolution={24}
                    />
                </div>
            </div>
        </div>

        <!-- Bio -->
        <div class="pt-2 lg:pt-4">
            <h1 class="mb-3 text-2xl">{data.about.name}</h1>
            <p class="leading-relaxed mb-3 text-sm">
                {data.about.shortBio}
            </p>
            {#if data.about?.social?.instagram}
                <p class="text-surface-400 text-sm">
                    <a
                        href={data.about.social.instagram}
                        target="_blank"
                        rel="noopener"
                        class="hover:text-surface-200 transition-colors"
                        >instagram</a
                    >
                </p>
            {/if}
            {#if contact?.bookingEnabled}
                <div class="mt-4 pt-4 border-t border-surface-500/20">
                    <p class="text-surface-400 text-xs mb-3">
                        want to book a session or schedule a call?
                    </p>
                    <button
                        type="button"
                        class="px-4 py-2.5 text-sm font-medium lowercase tracking-wide bg-white/5 border border-gray-300 dark:border-white/10 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-all cursor-pointer"
                        style="color: var(--form-text-color);"
                        data-cal-link="jesse-s1wmio/photosession"
                        data-cal-namespace="photosession"
                    >
                        book a time
                    </button>
                </div>
            {/if}
        </div>

        <!-- Contact form -->
        <div
            class="pt-2 lg:pt-4 md:col-span-2 lg:col-span-1 md:border-t md:border-surface-500/20 md:pt-6 md:mt-2 lg:border-0 lg:mt-0"
        >
            {#if contact?.heading}
                <h2 class="mb-2 text-lg">{contact.heading.toLowerCase()}</h2>
            {:else}
                <h2 class="mb-2 text-lg">get in touch</h2>
            {/if}
            {#if contact?.intro}
                <div class="text-surface-400 text-sm mb-4 leading-relaxed">
                    <PortableText value={contact.intro} />
                </div>
            {:else}
                <p class="text-surface-400 text-sm mb-4">
                    for inquiries, commissions, and collaborations.
                </p>
            {/if}
            <ContactForm hideHeader={!!contact?.heading} />
        </div>
    </div>
</section>
