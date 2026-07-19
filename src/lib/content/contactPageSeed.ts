import type { ContactPageDraftPayload } from "@jessepomeroy/admin";

/**
 * Reversible snapshot verified 2026-07-19. Sanity returned exactly one
 * published `contactPage` document: `8cb60fab-7420-457d-b316-c6a3f99e9d2b`,
 * updated `2026-04-07T01:13:26Z`. It supplied heading, intro, email,
 * bookingEnabled, and bookingUrl. The intro was one normal Portable Text block
 * with one unmarked span; visual line wraps are normalized to spaces here.
 *
 * bookingLabel and bookingIntro copy hardcoded public rendering in
 * `src/routes/about/+page.svelte`; confirmationMessage copies the hardcoded
 * public success state in `src/lib/components/ContactForm.svelte`. Those three
 * values are host-rendered copy, not fields from the Sanity document.
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
