import { internalMutation } from "./_generated/server";
import type { AboutPageDraftPayload } from "./helpers/aboutPageValidators";
import { serializeAboutPagePayload } from "./helpers/aboutPageValidators";

type LegacyAboutPortrait = NonNullable<AboutPageDraftPayload["portraits"]>[number] & {
	focalPoint?: { x: number; y: number };
};

type LegacyAboutPayload = Omit<AboutPageDraftPayload, "portraits"> & {
	portraits?: LegacyAboutPortrait[];
};

async function checksumPayload(serialized: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(serialized),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function stripFocalPoints(payload: LegacyAboutPayload): AboutPageDraftPayload | null {
	const portraits = payload.portraits ?? [];
	if (!portraits.some((portrait) => "focalPoint" in portrait)) return null;
	return {
		...payload,
		portraits: portraits.map((portrait) => ({
			key: portrait.key,
			assetId: portrait.assetId,
			decorative: portrait.decorative,
			...(portrait.altText === undefined ? {} : { altText: portrait.altText }),
		})),
	};
}

/**
 * One-time internal migration for the About focal-point retirement.
 * Rewrites only semantically equivalent historical payloads and their checksums.
 */
export const stripAboutPortraitFocalPoints = internalMutation({
	args: {},
	handler: async (ctx) => {
		const revisions = await ctx.db.query("contentRevisions").collect();
		const changedRevisionIds = [];
		for (const revision of revisions) {
			if (revision.kind !== "aboutPage") continue;
			const payload = stripFocalPoints(revision.payload as LegacyAboutPayload);
			if (!payload) continue;
			await ctx.db.patch(revision._id, {
				payload,
				checksum: await checksumPayload(serializeAboutPagePayload(payload)),
			});
			changedRevisionIds.push(revision._id);
		}
		return {
			scanned: revisions.length,
			changed: changedRevisionIds.length,
			changedRevisionIds,
		};
	},
});
