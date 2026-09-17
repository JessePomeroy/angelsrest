<script lang="ts">
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
const data = {
 ...deliveryData,
 accessGrant: "fixture-grant",
 workerUrl: "http://127.0.0.1:5196",
 gallery: { ...deliveryData.gallery, downloadEnabled: params.get("downloads") !== "false", favoritesEnabled: params.get("favorites") !== "false" },
 images: deliveryData.images.map((image, index) => ({
  ...image,
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
</script>
<button type="button" onclick={() => mounted = !mounted}>{mounted ? "Unmount gallery" : "Mount gallery"}</button>
{#if mounted}<DeliveryGallery {data} form={null} />{/if}
<Toaster />
