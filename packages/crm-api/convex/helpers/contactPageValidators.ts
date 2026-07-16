import type { Infer } from "convex/values";
import { v } from "convex/values";

/**
 * Contact drafts contain business-facing copy and public destinations only.
 * Form fields, recipients, abuse protection, delivery, and integrations remain
 * host/platform configuration and cannot enter this payload.
 */
export const contactPageDraftPayloadValidator = v.object({
	heading: v.optional(v.string()),
	intro: v.optional(v.string()),
	email: v.optional(v.string()),
	phone: v.optional(v.string()),
	availability: v.optional(v.string()),
	responseTime: v.optional(v.string()),
	confirmationMessage: v.optional(v.string()),
	bookingEnabled: v.optional(v.boolean()),
	bookingUrl: v.optional(v.string()),
	bookingLabel: v.optional(v.string()),
	bookingIntro: v.optional(v.string()),
	inquiryChoices: v.optional(v.array(v.string())),
});

export type ContactPageDraftPayload = Infer<
	typeof contactPageDraftPayloadValidator
>;

export type PublishedContactPage = {
	heading: string;
	intro: string;
	email: string;
	phone?: string;
	availability?: string;
	responseTime?: string;
	confirmationMessage: string;
	booking: {
		enabled: boolean;
		url?: string;
		label: string;
		intro: string;
	};
	inquiryChoices: string[];
};

const LIMITS = {
	heading: 120,
	intro: 2_000,
	email: 254,
	phone: 80,
	availability: 500,
	responseTime: 300,
	confirmationMessage: 500,
	bookingUrl: 2_048,
	bookingLabel: 120,
	bookingIntro: 1_000,
	inquiryChoices: 12,
	inquiryChoice: 120,
} as const;

const ALLOWED_KEYS = new Set([
	"heading",
	"intro",
	"email",
	"phone",
	"availability",
	"responseTime",
	"confirmationMessage",
	"bookingEnabled",
	"bookingUrl",
	"bookingLabel",
	"bookingIntro",
	"inquiryChoices",
]);

function assertMaximum(value: string | undefined, maximum: number, field: string) {
	if (value !== undefined && value.length > maximum) {
		throw new Error(`${field} must be ${maximum} characters or fewer`);
	}
}

/** Bound autosaved drafts without requiring them to be publishable yet. */
export function validateContactPageDraft(payload: ContactPageDraftPayload) {
	for (const key of Object.keys(payload)) {
		if (!ALLOWED_KEYS.has(key)) {
			throw new Error("Contact page payload contains an unsupported field");
		}
	}

	assertMaximum(payload.heading, LIMITS.heading, "Contact heading");
	assertMaximum(payload.intro, LIMITS.intro, "Contact introduction");
	assertMaximum(payload.email, LIMITS.email, "Public contact email");
	assertMaximum(payload.phone, LIMITS.phone, "Public contact phone");
	assertMaximum(payload.availability, LIMITS.availability, "Availability guidance");
	assertMaximum(payload.responseTime, LIMITS.responseTime, "Response-time guidance");
	assertMaximum(
		payload.confirmationMessage,
		LIMITS.confirmationMessage,
		"Confirmation message",
	);
	assertMaximum(payload.bookingUrl, LIMITS.bookingUrl, "Booking URL");
	assertMaximum(payload.bookingLabel, LIMITS.bookingLabel, "Booking label");
	assertMaximum(payload.bookingIntro, LIMITS.bookingIntro, "Booking introduction");

	const inquiryChoices = payload.inquiryChoices ?? [];
	if (inquiryChoices.length > LIMITS.inquiryChoices) {
		throw new Error(
			`Inquiry choices cannot contain more than ${LIMITS.inquiryChoices} items`,
		);
	}
	for (const choice of inquiryChoices) {
		assertMaximum(choice, LIMITS.inquiryChoice, "Inquiry choice");
	}
}

function requireText(value: string | undefined, field: string, maximum: number) {
	const normalized = value?.trim() ?? "";
	if (!normalized) throw new Error(`${field} is required before publishing`);
	assertMaximum(normalized, maximum, field);
	return normalized;
}

function optionalText(value: string | undefined, field: string, maximum: number) {
	const normalized = value?.trim();
	if (!normalized) return undefined;
	assertMaximum(normalized, maximum, field);
	return normalized;
}

function requireEmail(value: string | undefined) {
	const email = requireText(value, "Public contact email", LIMITS.email);
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new Error("Public contact email must be a valid email address");
	}
	return email;
}

function requirePublicUrl(value: string | undefined) {
	const normalized = requireText(value, "Booking URL", LIMITS.bookingUrl);
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new Error("Booking URL must be a valid public URL");
	}
	if (
		(parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
		parsed.username ||
		parsed.password
	) {
		throw new Error("Booking URL must be a valid public URL");
	}
	return normalized;
}

function normalizeInquiryChoices(values: string[] | undefined) {
	const choices = (values ?? []).map((value, index) =>
		requireText(value, `Inquiry choice ${index + 1}`, LIMITS.inquiryChoice),
	);
	const distinct = new Set(choices.map((choice) => choice.toLocaleLowerCase()));
	if (distinct.size !== choices.length) {
		throw new Error("Inquiry choices must be unique");
	}
	return choices;
}

/** Project only normalized client-managed content into the public provider. */
export function toPublishedContactPage(
	payload: ContactPageDraftPayload,
): PublishedContactPage {
	validateContactPageDraft(payload);
	const bookingEnabled = payload.bookingEnabled === true;
	return {
		heading: requireText(payload.heading, "Contact heading", LIMITS.heading),
		intro: requireText(payload.intro, "Contact introduction", LIMITS.intro),
		email: requireEmail(payload.email),
		phone: optionalText(payload.phone, "Public contact phone", LIMITS.phone),
		availability: optionalText(
			payload.availability,
			"Availability guidance",
			LIMITS.availability,
		),
		responseTime: optionalText(
			payload.responseTime,
			"Response-time guidance",
			LIMITS.responseTime,
		),
		confirmationMessage: requireText(
			payload.confirmationMessage,
			"Confirmation message",
			LIMITS.confirmationMessage,
		),
		booking: {
			enabled: bookingEnabled,
			url: bookingEnabled ? requirePublicUrl(payload.bookingUrl) : undefined,
			label: requireText(payload.bookingLabel, "Booking label", LIMITS.bookingLabel),
			intro: requireText(
				payload.bookingIntro,
				"Booking introduction",
				LIMITS.bookingIntro,
			),
		},
		inquiryChoices: normalizeInquiryChoices(payload.inquiryChoices),
	};
}

/** Stable serialization keeps revision identity independent of input key order. */
export function serializeContactPagePayload(payload: ContactPageDraftPayload) {
	return JSON.stringify({
		heading: payload.heading ?? null,
		intro: payload.intro ?? null,
		email: payload.email ?? null,
		phone: payload.phone ?? null,
		availability: payload.availability ?? null,
		responseTime: payload.responseTime ?? null,
		confirmationMessage: payload.confirmationMessage ?? null,
		bookingEnabled: payload.bookingEnabled ?? null,
		bookingUrl: payload.bookingUrl ?? null,
		bookingLabel: payload.bookingLabel ?? null,
		bookingIntro: payload.bookingIntro ?? null,
		inquiryChoices: payload.inquiryChoices ?? [],
	});
}
