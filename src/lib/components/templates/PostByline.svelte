<script lang="ts">
import type { BlogPostDetail } from "$lib/blog/content";
import { formatDate } from "$lib/utils/format";

let {
	post,
	centered = false,
	portrait = false,
	authorPrefix = "",
	alwaysDate = false,
}: {
	post: BlogPostDetail;
	centered?: boolean;
	portrait?: boolean;
	authorPrefix?: string;
	alwaysDate?: boolean;
} = $props();
</script>

{#if post.author || post.publishedAt || alwaysDate}
	<div class="byline" class:centered>
		{#if post.author}
			{#if portrait}
				<div class="author">
					{#if post.author.image}<img src={post.author.image.src} alt={post.author.image.alt} class="author-avatar" />{/if}
					<span>{authorPrefix}{post.author.name}</span>
				</div>
			{:else}
				<span>{authorPrefix}{post.author.name}</span>
			{/if}
			{#if post.publishedAt || alwaysDate}<span>•</span>{/if}
		{/if}
		{#if post.publishedAt || alwaysDate}<span>{formatDate(post.publishedAt)}</span>{/if}
	</div>
{/if}

<style>
.byline { display: flex; align-items: center; gap: 1rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-400); }
.byline.centered { justify-content: center; }
.author { display: flex; align-items: center; gap: .5rem; }
.author-avatar { width: 2rem; height: 2rem; border-radius: 50%; object-fit: cover; }
</style>
