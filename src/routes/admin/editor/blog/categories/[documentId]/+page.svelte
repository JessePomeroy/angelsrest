<script lang="ts">
import { BlogSupportingPage } from "@jessepomeroy/admin";

let { data } = $props();
</script>

<BlogSupportingPage documentId={data.params.documentId} kind="category" />
