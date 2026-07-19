<script lang="ts">
import { ProductPage } from "@jessepomeroy/admin";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
</script>

<ProductPage productId={data.productId} />
