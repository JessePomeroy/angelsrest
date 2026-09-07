<script lang="ts">
import DeliveryGallery from "../../../src/routes/delivery/[token]/+page.svelte";
import Toaster from "../../../src/lib/components/Toaster.svelte";
import { deliveryData } from "./data";
let mounted = $state(true);
const large = new URLSearchParams(window.location.search).has("large");
const data = {
 ...deliveryData,
 accessGrant: "fixture-grant",
 workerUrl: "http://127.0.0.1:5196",
 gallery: { ...deliveryData.gallery, downloadEnabled: true, favoritesEnabled: true },
 images: deliveryData.images.map((image, index) => ({ ...image, isFavorite: index < 2, sizeBytes: large ? 1024 ** 3 : 100, downloadUrl: `/fixture-download/${index}` })),
};
</script>
<button type="button" onclick={() => mounted = !mounted}>{mounted ? "Unmount gallery" : "Mount gallery"}</button>
{#if mounted}<DeliveryGallery {data} form={null} />{/if}
<Toaster />
