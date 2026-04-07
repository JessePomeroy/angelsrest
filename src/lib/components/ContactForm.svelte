<script lang="ts">
/** ContactForm.svelte
 * contact form extracted out of the about page during refactor
 */
import { isDark } from "$lib/stores/theme";

let { hideHeader = false }: { hideHeader?: boolean } = $props();

/**
 * Theme-aware form text color
 *
 * Tailwind's dark: variant wasn't working reliably with !text-black,
 * so we use a CSS variable that updates reactively when the theme changes.
 *
 * The --form-text-color variable is applied via inline styles on form elements.
 * - Light mode: #000000 (black)
 * - Dark mode: #fafafa (near-white)
 */
$effect(() => {
	document.documentElement.style.setProperty(
		"--form-text-color",
		$isDark ? "#fafafa" : "#000000",
	);
});

let status = $state("idle"); // 'idle' | 'sending' | 'success' | 'error'

async function handleSubmit(e: SubmitEvent) {
	e.preventDefault();
	status = "sending";

	const form = e.target as HTMLFormElement;
	const data = Object.fromEntries(new FormData(form));

	try {
		const res = await fetch("/api/contact", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});

		if (res.ok) {
			status = "success";
			form.reset();
		} else {
			status = "error";
		}
	} catch {
		status = "error";
	}
}
</script>

<!-- Contact Form -->
<div>
    {#if !hideHeader}
        <h2 class="mb-2 text-lg">get in touch</h2>
        <p class="text-surface-400 text-sm mb-8">
            for inquiries, commissions, and collaborations.
        </p>
    {/if}

    <form onsubmit={handleSubmit} class="flex flex-col gap-5">
        <div class="flex flex-col gap-2.5">
            <label for="name" class="text-sm font-medium">name</label>
            <input
                type="text"
                id="name"
                name="name"
                placeholder="your name"
                required
                style="color: var(--form-text-color);"
                class="bg-white/5 border border-white/10 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full"
            />
        </div>
        <div class="flex flex-col gap-2.5">
            <label for="email" class="text-sm font-medium">email</label>
            <input
                type="email"
                id="email"
                name="email"
                placeholder="you@example.com"
                required
                style="color: var(--form-text-color);"
                class="bg-white/5 border border-white/10 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full"
            />
        </div>
        <div class="flex flex-col gap-2.5">
            <label for="subject" class="text-sm font-medium">subject</label>
            <input
                type="text"
                id="subject"
                name="subject"
                placeholder="what's this about ?"
                style="color: var(--form-text-color);"
                class="bg-white/5 border border-white/10 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full"
            />
        </div>
        <div class="flex flex-col gap-2.5">
            <label for="message" class="text-sm font-medium">message</label>
            <textarea
                id="message"
                name="message"
                rows="4"
                placeholder="your message..."
                required
                style="color: var(--form-text-color);"
                class="bg-white/5 border border-white/10 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full resize-y"
            ></textarea>
        </div>
        <button
            type="submit"
            class="mt-2 mb-6 px-4 py-3 text-sm font-medium lowercase tracking-wide bg-white/5 dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-all cursor-pointer"
            style="color: var(--form-text-color);"
            disabled={status === "sending"}
        >
            {status === "sending" ? "sending..." : "send message"}
        </button>

        {#if status === "success"}
            <p class="text-green-400">message sent !</p>
        {/if}
        {#if status === "error"}
            <p class="text-red-400">something went wrong. try again ?</p>
        {/if}
    </form>
</div>
