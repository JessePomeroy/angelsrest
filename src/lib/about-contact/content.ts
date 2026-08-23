export type AboutContactSeo = {
	description: string | null;
	imageUrl: string | null;
};

export type AboutContactPortrait = {
	src: string;
	altText: string;
	sourceSha256: string | null;
};

export type AboutContactAbout = {
	displayName: string;
	introduction: string;
	portrait: AboutContactPortrait;
	instagramUrl: string | null;
	seo: AboutContactSeo;
};

export type AboutContactBooking = {
	enabled: boolean;
	url: string | null;
	calLink: string | null;
	label: string;
	intro: string;
};

export type AboutContactContact = {
	heading: string;
	intro: string[];
	email: string;
	phone: string | null;
	confirmationMessage: string;
	booking: AboutContactBooking;
	inquiryChoices: string[];
};

/** Provider-neutral content consumed by the single public About route. */
export type AboutContactContent = {
	siteUrl: string;
	about: AboutContactAbout;
	contact: AboutContactContact;
};
