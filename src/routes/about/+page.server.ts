import {
	aboutContactContent,
	projectSiteSettingsInstagramUrl,
} from "$lib/server/current/aboutContactContent.server";

export const load = async ({ parent }) => {
	const { siteSettings } = await parent();
	return {
		content: await aboutContactContent.load(),
		instagramUrl: projectSiteSettingsInstagramUrl(siteSettings),
	};
};
