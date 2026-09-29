<script lang="ts">
import PortfolioGalleryPage from "@jessepomeroy/admin/pages/editor/PortfolioGalleryPage";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
</script>

<PortfolioGalleryPage galleryId={data.galleryId} />
