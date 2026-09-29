/** Explicit operator tool. Credentials come from the environment and are never printed. */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../packages/crm-api/convex/_generated/api";
import type { Id } from "../../packages/crm-api/convex/_generated/dataModel";

const args = process.argv.slice(2);
const value = (flag: string) => {
	const index = args.indexOf(flag);
	if (index < 0) return undefined;
	const next = args[index + 1];
	if (!next || next.startsWith("--")) throw new Error(`Missing value for ${flag}`);
	return next;
};
const siteUrl = value("--site"),
	galleryId = value("--gallery");
if (Boolean(siteUrl) === Boolean(galleryId))
	throw new Error("Choose exactly one: --site <tenant domain> or --gallery <gallery ID>.");
const url = process.env.PUBLIC_CONVEX_URL,
	token = process.env.ADMIN_CONVEX_JWT;
if (!url || !token)
	throw new Error("PUBLIC_CONVEX_URL and a current authorized ADMIN_CONVEX_JWT are required.");
const client = new ConvexHttpClient(url, { logger: false });
client.setAuth(token);
const apply = args.includes("--apply");
if (siteUrl) {
	let state = await client.query(api.orders.dashboardBackfillStatus, { siteUrl });
	console.log({
		phase: state?.phase ?? "not started",
		copied: state?.copied ?? 0,
		verified: state?.verified ?? 0,
		apply,
	});
	if (apply) {
		for (let batch = 0; batch < 10_000 && state?.phase !== "ready"; batch++) {
			state = await client.mutation(api.orders.advanceDashboardBackfill, {
				siteUrl,
				cursor: state?.cursor ?? null,
				phase: state?.phase ?? "copy",
			});
			console.log({ phase: state.phase, copied: state.copied, verified: state.verified });
		}
		if (state?.phase !== "ready") throw new Error("Batch limit reached; rerun to resume.");
	}
} else if (galleryId) {
	const id = galleryId as Id<"galleries">;
	const gallery = await client.query(api.galleries.get, { id });
	let state = {
		isDone: gallery.previewIndexVersion === 1,
		cursor: gallery.previewIndexCursor ?? null,
	};
	console.log({ ready: state.isDone, apply });
	if (apply) {
		for (let batch = 0; batch < 10_000 && !state.isDone; batch++) {
			state = await client.mutation(api.galleries.backfillPreviewIndex, {
				galleryId: id,
				cursor: state.cursor,
			});
			console.log({ batch: batch + 1, ready: state.isDone });
		}
		if (!state.isDone) throw new Error("Batch limit reached; rerun to resume.");
	}
}
