<script lang="ts">
/** ContactForm.svelte
 * contact form extracted out of the about page during refactor
 */
import TurnstileWidget from "$lib/components/TurnstileWidget.svelte";

let {
	hideHeader = false,
	confirmationMessage = "message sent !",
}: { hideHeader?: boolean; confirmationMessage?: string } = $props();

let status = $state("idle"); // 'idle' | 'sending' | 'success' | 'error'
let verificationError = $state("");
let verificationReady = $state(false);
let turnstileWidget: TurnstileWidget | undefined;

function resetTurnstile() {
	verificationReady = false;
	turnstileWidget?.reset();
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
        <h2 class="contact-heading">get in touch</h2>
        <p class="contact-description">
            for inquiries, commissions, and collaborations.
        </p>
    {/if}

    <form onsubmit={handleSubmit} class="contact-form">
        <div class="field-group">
            <label for="name" class="field-label">name</label>
            <input
                type="text"
                id="name"
                name="name"
                placeholder="your name"
                required
                class="contact-field"
            />
        </div>
        <div class="field-group">
            <label for="email" class="field-label">email</label>
            <input
                type="email"
                id="email"
                name="email"
                placeholder="you@example.com"
                required
                class="contact-field"
            />
        </div>
        <div class="field-group">
            <label for="subject" class="field-label">subject</label>
            <input
                type="text"
                id="subject"
                name="subject"
                placeholder="what's this about ?"
                class="contact-field"
            />
        </div>
        <div class="field-group">
            <label for="message" class="field-label">message</label>
            <textarea
                id="message"
                name="message"
                rows="4"
                placeholder="your message..."
                required
                class="contact-field"
            ></textarea>
        </div>
		<TurnstileWidget
			bind:this={turnstileWidget}
			theme="auto"
			onverified={() => {
				verificationReady = true;
				verificationError = "";
			}}
			onerror={() => {
				verificationReady = false;
				verificationError = "Verification could not load. Please try again.";
			}}
			onexpired={() => {
				verificationError = "Verification expired. Please complete it again.";
				resetTurnstile();
			}}
			onloaderror={(error) => {
				console.error("contact Turnstile failed to load", error);
				verificationReady = false;
				verificationError = "Verification could not load. Please refresh and try again.";
			}}
		/>
        <button
            type="submit"
            class="contact-submit"
            disabled={status === "sending" || !verificationReady}
        >
            {status === "sending" ? "sending..." : "send message"}
        </button>

        <div aria-live="polite">
            {#if verificationError}
                <p class="form-error">{verificationError}</p>
            {/if}
            {#if status === "success"}
                <p class="form-success">{confirmationMessage}</p>
            {/if}
            {#if status === "error"}
                <p class="form-error">something went wrong. try again ?</p>
            {/if}
        </div>
    </form>
</div>

<style>
    @layer components {
        .contact-heading { font-size: var(--text-lg); line-height: var(--text-lg--line-height); }
        .contact-description { color: var(--color-surface-400); font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
        .contact-form { display: flex; flex-direction: column; gap: 1.25rem; }
        .field-group { display: flex; flex-direction: column; gap: 0.625rem; }
        .field-label { font-size: var(--text-sm); line-height: var(--text-sm--line-height); font-weight: 500; }
        .form-error { color: oklch(70.4% 0.191 22.216); }
        .form-success { color: oklch(79.2% 0.209 151.711); }
    }

    .contact-field, .contact-submit { color: #000; }
    :global(.dark) .contact-field, :global(.dark) .contact-submit { color: #fafafa; }
    .contact-field { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 0; background: color-mix(in srgb, var(--color-surface-900) 18%, transparent); font-size: 0.82rem; transition: border-color 160ms ease, background 160ms ease; }
    .contact-field::placeholder { color: color-mix(in srgb, currentColor 44%, transparent); }
    .contact-field:focus { border-color: var(--time-accent); outline: 1px solid var(--time-accent); outline-offset: -1px; background: color-mix(in srgb, var(--color-surface-900) 25%, transparent); }
    textarea.contact-field { min-height: 112px; }
    .contact-submit { min-height: 44px; margin: 8px 0 24px; padding: 11px 16px; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 0; background: transparent; font-size: 0.78rem; font-weight: 500; letter-spacing: 0.08em; text-transform: lowercase; cursor: pointer; transition: border-color 160ms ease, background 160ms ease; }
    .contact-submit:hover:not(:disabled) { border-color: var(--time-accent); background: color-mix(in srgb, currentColor 6%, transparent); }
    .contact-submit:focus-visible { outline: 1px solid var(--time-accent); outline-offset: 2px; }
    .contact-submit:disabled { cursor: not-allowed; opacity: 0.45; }
</style>
