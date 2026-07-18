<script lang="ts">
import { BlogPostPage } from "@jessepomeroy/admin";

let { data } = $props();
</script>

<BlogPostPage documentId={data.params.documentId} />
