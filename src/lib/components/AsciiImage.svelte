<!--
  AsciiImage Component
  
  Displays an image that transforms into ASCII art on hover.
  Uses canvas to sample pixels and map brightness to characters.
  
  Props:
  - src: image source URL
  - alt: alt text for accessibility
  - class: additional CSS classes for the image
  - charSet: characters to use (dark → light)
  - resolution: lower = more detailed ASCII (default 4)
-->

<script lang="ts">
  import { onMount } from "svelte";

  let {
    src,
    alt = "",
    class: className = "",
    charSet = " .,:;i1tfLCG08@",
    resolution = 4
  }: {
    src: string;
    alt?: string;
    class?: string;
    charSet?: string;
    resolution?: number;
  } = $props();

  let canvas: HTMLCanvasElement;
  let asciiArt = $state("");
  let isHovering = $state(false);
  let imageLoaded = $state(false);
  let containerWidth = $state(0);
  let containerHeight = $state(0);
  let container: HTMLDivElement;

  // Calculate font size based on resolution and container size
  const fontSize = $derived(resolution * 1.2);
  const lineHeight = $derived(resolution * 1.1);

  onMount(() => {
    generateAscii();
    
    // Observe container size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth = entry.contentRect.width;
        containerHeight = entry.contentRect.height;
      }
    });
    
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  });

  async function generateAscii() {
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Scale down for ASCII sampling
      const aspectRatio = img.width / img.height;
      const cols = Math.floor(img.width / resolution);
      // Characters are taller than wide, so compensate
      const rows = Math.floor(img.height / (resolution * 1.8));

      canvas.width = cols;
      canvas.height = rows;

      // Draw scaled image to canvas
      ctx.drawImage(img, 0, 0, cols, rows);
      const imageData = ctx.getImageData(0, 0, cols, rows);
      const pixels = imageData.data;

      let result = "";
      
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = (y * cols + x) * 4;
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];

          if (a < 128) {
            // Transparent pixel
            result += " ";
          } else {
            // Calculate perceived brightness (human eye is more sensitive to green)
            const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            // Map brightness to character (inverted: bright = sparse char)
            const charIndex = Math.floor(brightness * (charSet.length - 1));
            result += charSet[charIndex];
          }
        }
        result += "\n";
      }

      asciiArt = result;
      imageLoaded = true;
    };

    img.src = src;
  }
</script>

<div
  bind:this={container}
  class="ascii-image-container relative overflow-hidden"
  onmouseenter={() => isHovering = true}
  onmouseleave={() => isHovering = false}
  role="img"
  aria-label={alt}
>
  <!-- Original image -->
  <img
    {src}
    {alt}
    class="{className} transition-opacity duration-500 ease-out"
    class:opacity-0={isHovering && imageLoaded}
  />
  
  <!-- ASCII overlay -->
  {#if imageLoaded}
    <pre
      class="ascii-overlay absolute inset-0 overflow-hidden whitespace-pre font-mono
             transition-opacity duration-500 ease-out pointer-events-none
             flex items-center justify-center text-center"
      class:opacity-0={!isHovering}
      style="font-size: {fontSize}px; line-height: {lineHeight}px;"
      aria-hidden="true"
    >{asciiArt}</pre>
  {/if}
  
  <!-- Hidden canvas for pixel sampling -->
  <canvas bind:this={canvas} class="hidden" aria-hidden="true"></canvas>
</div>

<style>
  .ascii-image-container {
    cursor: pointer;
  }

  .ascii-overlay {
    /* Match the image's visual appearance */
    color: currentColor;
    opacity: 0.9;
    background: var(--ascii-bg, transparent);
  }

  /* Ensure ASCII art fills the container properly */
  pre {
    margin: 0;
    padding: 0;
  }
</style>
