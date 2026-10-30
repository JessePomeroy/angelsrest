import { siteSettingsContent } from "$lib/server/current/siteSettingsContent.server";
import { loadDraftPreview } from "$lib/server/draftPreview";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ url, cookies }) => {
	const draftPreview = await loadDraftPreview(url, cookies);
	return {
		siteSettings:
			draftPreview?.kind === "settings"
				? draftPreview.siteSettings
				: await siteSettingsContent.load(),
		...(draftPreview ? { draftPreview } : {}),
	};
};
