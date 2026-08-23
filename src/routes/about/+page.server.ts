import {
	aboutContactContent,
	projectSiteSettingsInstagramUrl,
} from "$lib/server/aboutContactContent.server";

export const load = async ({ locals, parent }) => {
	const { siteSettings } = await parent();
	return {
		content: await aboutContactContent.load(locals.isPreview),
		instagramUrl: projectSiteSettingsInstagramUrl(siteSettings),
	};
};
