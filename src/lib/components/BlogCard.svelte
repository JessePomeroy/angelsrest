<script lang="ts">
import type { BlogPostSummary } from "$lib/blog/content";
import { formatDate } from "$lib/utils/format";

let { post }: { post: BlogPostSummary } = $props();
</script>

<a
  href="/blog/{post.slug}"
  class="group block bg-surface-500/10 border border-surface-500/20 rounded-lg overflow-hidden hover:border-surface-400/40 transition-all"
>
  {#if post.mainImage}
    <div class="aspect-[16/9] overflow-hidden">
      <img
        src={post.mainImage.src}
        alt={post.mainImage.alt}
        width={post.mainImage.width}
        height={post.mainImage.height}
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
    </div>
  {/if}

  <div class="p-5">
    {#if post.categories.length > 0}
      <div class="flex gap-2 mb-2">
        {#each post.categories as category (category.title)}
          <span class="text-xs text-surface-500 tracking-wider">
            {category.title}
          </span>
        {/each}
      </div>
    {/if}

    <h2 class="text-lg font-medium mb-2 group-hover:text-surface-200 transition-colors">
      {post.title}
    </h2>

    {#if post.excerpt}
      <p class="text-surface-400 text-sm mb-4 line-clamp-2">
        {post.excerpt}
      </p>
    {/if}

    <div class="flex items-center gap-3 text-xs text-surface-500">
      {#if post.author}
        <span>{post.author.name}</span>
        <span>•</span>
      {/if}
      <span>{formatDate(post.publishedAt)}</span>
    </div>
  </div>
</a>
