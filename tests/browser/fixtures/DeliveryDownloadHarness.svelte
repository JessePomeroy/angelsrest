<script lang="ts">
import { onDestroy, tick } from "svelte";
import { configureFavoriteMutation, configureGalleryPages } from "./convex";
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
const initialData = { ...completeData,
	imagePage: paginated ? { cursor: "48", isDone: completeData.images.length <= 48 } : null,
	gallery: { ...completeData.gallery, imageCount: completeData.images.length },
	images: paginated ? completeData.images.slice(0, 48) : completeData.images,
};
let data = $state.raw(initialData);
const replacementData = { ...completeData,
 token: "fixture-token-b", accessGrant: "fixture-grant-b",
 gallery: { ...completeData.gallery, _id: "fixture-gallery-b" as Id<"galleries">, name: "Replacement gallery", imageCount: 60 },
 imagePage: null,
 images: Array.from({ length: 60 }, (_, index) => completeData.images[index % completeData.images.length]).map((image, index) => ({ ...image,
  _id: `fixture-b-image-${index}` as Id<"galleryImages">, filename: `replacement-${index + 1}.jpg`,
 })),
};
const pendingFavorites: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
const pendingPages: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
Object.defineProperty(window, "galleryFixture", { configurable: true, value: {
 async replace(source: "a" | "b") { data = source === "a" ? initialData : replacementData; await tick(); },
 async renewGrant() { data = { ...data, accessGrant: `${data.accessGrant}-renewed` }; await tick(); },
 async refresh() { data = { ...data, images: [...data.images] }; await tick(); },
 async releasePage(fail = false) {
  const pending = pendingPages.shift();
  if (!pending) throw new Error("No held page request");
  if (fail) pending.reject(new Error("Synthetic held page failure")); else pending.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
 },
 async releaseFavorite(fail = false) {
  const pending = pendingFavorites.shift();
  if (!pending) throw new Error("No held favorite request");
  if (fail) pending.reject(new Error("Synthetic held favorite failure")); else pending.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
 },
 get heldFavorites() { return pendingFavorites.length; },
 get heldPages() { return pendingPages.length; },
} });
const requests: Array<{ cursor: string | null; selection: unknown }> = [];
Object.defineProperty(window, "galleryPageRequests", { value: requests, configurable: true });
let failedOnce = false;
onDestroy(configureFavoriteMutation(async () => {
 if (!params.has("hold-favorites")) throw new Error("Unexpected favorite mutation in browser fixture");
 await new Promise<void>((resolve, reject) => pendingFavorites.push({ resolve, reject }));
 return null;
}));
onDestroy(configureGalleryPages(async (args) => {
	requests.push({ cursor: args.cursor, selection: args.selection });
 if (params.has("hold-pages")) await new Promise<void>((resolve, reject) => pendingPages.push({ resolve, reject }));
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
