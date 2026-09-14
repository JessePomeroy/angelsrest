import type { ContactPageDraftPayload } from "@jessepomeroy/admin";

/**
 * Initial content snapshot verified 2026-07-19. It supplied heading, intro,
 * email, bookingEnabled, and bookingUrl. Visual line wraps are normalized to
 * spaces here.
 *
 * bookingLabel and bookingIntro copy hardcoded public rendering in
 * `src/routes/about/+page.svelte`; confirmationMessage copies the hardcoded
 * public success state in `src/lib/components/ContactForm.svelte`. Those three
 * values are host-rendered copy, not fields from the imported document.
 */
export const contactPageSeed: ContactPageDraftPayload = {
	heading: "Get in Touch",
	intro:
		"I'd love to hear from you. Whether you're looking to book a photo session, pick up some prints, or want to chat about a web project, drop me a line below. I build custom websites for photographers and creatives, so if you're looking for something like that too, let's talk. I'll get back to you as soon as I can.",
	email: "hello@angelsrest.online",
	confirmationMessage: "message sent !",
	bookingEnabled: true,
	bookingUrl: "https://cal.com/jesse-s1wmio/photosession",
	bookingLabel: "book a time",
	bookingIntro: "want to book a session or schedule a call?",
	inquiryChoices: [],
};
