<script lang="ts">
import BlogPostPage from "@jessepomeroy/admin/pages/editor/BlogPostPage";

let { data } = $props();
</script>

<BlogPostPage documentId={data.params.documentId} />
