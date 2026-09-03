import { siteSettingsContent } from "$lib/server/siteSettingsContent.server";

export async function load() {
	return { siteSettings: await siteSettingsContent.load() };
}
