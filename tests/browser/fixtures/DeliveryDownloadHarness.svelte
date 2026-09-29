<script lang="ts">
import { onDestroy } from "svelte";
import { configureGalleryPages } from "./convex";
import type { Id } from "$convex/dataModel";
import DeliveryGallery from "../../../src/routes/delivery/[token]/+page.svelte";
import Toaster from "../../../src/lib/components/Toaster.svelte";
import { deliveryData } from "./data";
let mounted = $state(true);
const params = new URLSearchParams(window.location.search);
const large = params.has("large");
const filename = params.get("filename");
const raw = params.has("raw");
const video = params.has("video");
const portraitPreview = params.has("portrait")
 ? "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="960"><rect width="480" height="960" fill="#74828f"/></svg>')
 : null;
const completeData = {
 ...deliveryData,
 accessGrant: "fixture-grant",
 workerUrl: "http://127.0.0.1:5196",
 gallery: { ...deliveryData.gallery, downloadEnabled: params.get("downloads") !== "false", favoritesEnabled: params.get("favorites") !== "false" },
 images: Array.from({ length: Number(params.get("count")) || deliveryData.images.length }, (_, index) => deliveryData.images[index % deliveryData.images.length]).map((image, index) => ({
  ...image,
  _id: params.has("count") ? `fixture-image-${index}` as Id<"galleryImages"> : image._id,
  filename: filename ?? image.filename,
  canPreview: !raw,
  fileLabel: raw ? filename?.split(".").at(-1)?.toUpperCase() ?? "RAW" : video ? "MP4" : image.fileLabel,
  previewUrl: video
   ? `https://gallery-worker.thinkingofview.workers.dev/image/fixture-${index}.mp4?token=fixture-token`
   : portraitPreview ?? image.previewUrl,
  isVideo: video,
  isFavorite: index < 2,
  sizeBytes: large ? 1024 ** 3 : 100,
  downloadUrl: `/fixture-download/${index}`,
 })),
};
const paginated = params.has("paged");
const data = { ...completeData,
	imagePage: paginated ? { cursor: "48", isDone: completeData.images.length <= 48 } : null,
	gallery: { ...completeData.gallery, imageCount: completeData.images.length },
	images: paginated ? completeData.images.slice(0, 48) : completeData.images,
};
const requests: Array<{ cursor: string | null; selection: unknown }> = [];
Object.defineProperty(window, "galleryPageRequests", { value: requests, configurable: true });
let failedOnce = false;
onDestroy(configureGalleryPages(async (args) => {
	requests.push({ cursor: args.cursor, selection: args.selection });
	if (params.has("slow-pages")) await new Promise((resolve) => setTimeout(resolve, 500));
	if (params.has("fail-page-once") && !failedOnce) { failedOnce = true; throw new Error("Synthetic page failure"); }
	const offset = Number(args.cursor ?? 0);
	const selection = args.selection;
	return { page: completeData.images.slice(offset, offset + 48).filter((image) => !selection || (selection.kind === "all"
		? !selection.excludedIds.includes(image._id) : selection.kind === "selected" ? selection.ids.includes(image._id) : image.isFavorite)),
		isDone: offset + 48 >= completeData.images.length, continueCursor: String(offset + 48),
		totalCount: completeData.images.length, previewSources: [],
	};
}));

</script>
<button type="button" onclick={() => mounted = !mounted}>{mounted ? "Unmount gallery" : "Mount gallery"}</button>
{#if mounted}<DeliveryGallery {data} form={null} />{/if}
<Toaster />
