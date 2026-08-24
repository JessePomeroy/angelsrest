import { siteSettingsContent } from "$lib/server/siteSettingsContent.server";

export async function load({ locals }) {
	const siteSettings = await siteSettingsContent.load(locals.isPreview ?? false);

	return {
		isPreview: locals.isPreview ?? false,
		siteSettings,
	};
}
