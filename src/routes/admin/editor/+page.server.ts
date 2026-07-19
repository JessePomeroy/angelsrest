import type { SiteSettingsDraftPayload } from "@jessepomeroy/admin";
import type { PageServerLoad } from "./$types";

type SanitySiteSettings = {
	artistName?: string | null;
	siteTitle?: string | null;
	tagline?: string | null;
	socialLinks?: Array<{
		platform?: string | null;
		url?: string | null;
	}> | null;
	seo?: {
		description?: string | null;
	} | null;
};

export const load: PageServerLoad = async ({ parent }) => {
	// The root layout already fetched the public Sanity document. Reuse that
	// inherited data so opening the protected workspace does not issue a second
	// provider query or create a second source of current settings.
	const { siteSettings } = await parent();
	const current = siteSettings as SanitySiteSettings | null | undefined;

	const siteSettingsEditorSeed = {
		artistName: current?.artistName ?? "",
		siteTitle: current?.siteTitle ?? "",
		tagline: current?.tagline ?? "",
		socialLinks: (current?.socialLinks ?? []).map((link) => ({
			platform: link.platform ?? "",
			url: link.url ?? "",
		})),
		seoDescription: current?.seo?.description ?? "",
	} satisfies SiteSettingsDraftPayload;

	return { siteSettingsEditorSeed };
};
