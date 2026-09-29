<script lang="ts">
import ClientGalleriesPage from "@jessepomeroy/admin/pages/gallery-delivery/GalleryDeliveryPage";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
</script>

<ClientGalleriesPage adminSession={data.adminSession} />
