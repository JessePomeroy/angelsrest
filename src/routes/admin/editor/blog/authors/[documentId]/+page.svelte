<script lang="ts">
import BlogSupportingPage from "@jessepomeroy/admin/pages/editor/BlogSupportingPage";

let { data } = $props();
</script>

<BlogSupportingPage documentId={data.params.documentId} kind="author" />
