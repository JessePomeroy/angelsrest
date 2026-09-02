<script lang="ts">
/** ContactForm.svelte
 * contact form extracted out of the about page during refactor
 */
import { onMount } from "svelte";
import { loadTurnstile, type TurnstileApi } from "$lib/client/turnstile";
import { isDark } from "$lib/stores/theme";
import { TURNSTILE_SITE_KEY } from "$lib/config/turnstile";

let {
	hideHeader = false,
	confirmationMessage = "message sent !",
}: { hideHeader?: boolean; confirmationMessage?: string } = $props();

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
	// Audit M19: `$effect` already runs client-only in Svelte 5, but the
	// explicit guard documents intent and covers any host that polyfills
	// `$effect` during SSR (Vite dev warm-up has done this in the past).
	if (typeof document === "undefined") return;
	document.documentElement.style.setProperty(
		"--form-text-color",
		$isDark ? "#fafafa" : "#000000",
	);
});

let status = $state("idle"); // 'idle' | 'sending' | 'success' | 'error'
let verificationError = $state("");
let verificationReady = $state(false);
let turnstileApi: TurnstileApi | undefined;
let turnstileWidgetId: string | undefined;

onMount(() => {
	let disposed = false;
	void loadTurnstile()
		.then((api) => {
			if (disposed) return;
			turnstileApi = api;
			turnstileWidgetId = api.render("#contact-turnstile", {
				sitekey: TURNSTILE_SITE_KEY,
				theme: "auto",
				action: "turnstile-spin-v1",
				callback: () => {
					verificationReady = true;
					verificationError = "";
				},
				"error-callback": () => {
					verificationReady = false;
					verificationError = "Verification could not load. Please try again.";
					return false;
				},
				"expired-callback": () => {
					verificationError = "Verification expired. Please complete it again.";
					resetTurnstile();
				},
			});
		})
		.catch((error) => {
			console.error("contact Turnstile failed to load", error);
			if (!disposed) {
				verificationReady = false;
				verificationError = "Verification could not load. Please refresh and try again.";
			}
		});

	return () => {
		disposed = true;
		verificationReady = false;
		if (turnstileApi && turnstileWidgetId) turnstileApi.remove(turnstileWidgetId);
		turnstileWidgetId = undefined;
		turnstileApi = undefined;
	};
});

function resetTurnstile() {
	verificationReady = false;
	if (turnstileApi && turnstileWidgetId) turnstileApi.reset(turnstileWidgetId);
}

async function handleSubmit(e: SubmitEvent) {
	e.preventDefault();
	if (status === "sending") return;

	const form = e.currentTarget as HTMLFormElement;
	const formData = new FormData(form);
	const turnstileToken = formData.get("cf-turnstile-response");
	if (typeof turnstileToken !== "string" || turnstileToken.length === 0) {
		verificationError = "Please complete the verification challenge.";
		return;
	}
	status = "sending";
	verificationError = "";
	const data = Object.fromEntries(formData);

	try {
		const res = await fetch("/api/contact", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});

		if (res.ok) {
			status = "success";
			form.reset();
			resetTurnstile();
		} else {
			status = "error";
			resetTurnstile();
		}
	} catch {
		status = "error";
		resetTurnstile();
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
                class="contact-field"
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
                class="contact-field"
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
                class="contact-field"
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
                class="contact-field resize-y"
            ></textarea>
        </div>
		<div id="contact-turnstile"></div>
        <button
            type="submit"
            class="contact-submit"
            style="color: var(--form-text-color);"
            disabled={status === "sending" || !verificationReady}
        >
            {status === "sending" ? "sending..." : "send message"}
        </button>

        <div aria-live="polite">
            {#if verificationError}
                <p class="text-red-400">{verificationError}</p>
            {/if}
            {#if status === "success"}
                <p class="text-green-400">{confirmationMessage}</p>
            {/if}
            {#if status === "error"}
                <p class="text-red-400">something went wrong. try again ?</p>
            {/if}
        </div>
    </form>
</div>

<style>
    .contact-field { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 0; background: color-mix(in srgb, var(--color-surface-900) 18%, transparent); font-size: 0.82rem; transition: border-color 160ms ease, background 160ms ease; }
    .contact-field::placeholder { color: color-mix(in srgb, currentColor 44%, transparent); }
    .contact-field:focus { border-color: var(--time-accent); outline: 1px solid var(--time-accent); outline-offset: -1px; background: color-mix(in srgb, var(--color-surface-900) 25%, transparent); }
    textarea.contact-field { min-height: 112px; }
    .contact-submit { min-height: 44px; margin: 8px 0 24px; padding: 11px 16px; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 0; background: transparent; font-size: 0.78rem; font-weight: 500; letter-spacing: 0.08em; text-transform: lowercase; cursor: pointer; transition: border-color 160ms ease, background 160ms ease; }
    .contact-submit:hover:not(:disabled) { border-color: var(--time-accent); background: color-mix(in srgb, currentColor 6%, transparent); }
    .contact-submit:focus-visible { outline: 1px solid var(--time-accent); outline-offset: 2px; }
    .contact-submit:disabled { cursor: not-allowed; opacity: 0.45; }
</style>
