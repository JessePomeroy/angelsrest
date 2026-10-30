import {
	aboutContactContent,
	projectSiteSettingsInstagramUrl,
} from "$lib/server/current/aboutContactContent.server";

export const load = async ({ parent }) => {
	const { siteSettings, draftPreview } = await parent();
	return {
		content:
			draftPreview?.kind === "about" || draftPreview?.kind === "contact"
				? draftPreview.content
				: await aboutContactContent.load(),
		instagramUrl: projectSiteSettingsInstagramUrl(siteSettings),
	};
};
