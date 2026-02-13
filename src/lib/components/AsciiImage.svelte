<!--
  AsciiImage Component
  
  Displays an image that transforms into ASCII art on hover.
  Uses canvas to sample pixels and map brightness to characters.
  On hover: scrambles randomly, then settles into the final ASCII art.
  
  Props:
  - src: image source URL
  - alt: alt text for accessibility
  - class: additional CSS classes for the image
  - charSet: characters to use (dark → light)
  - resolution: lower = more detailed ASCII (default 4)
  - settleDuration: how long the scramble → settle animation takes (ms)
-->

<script lang="ts">
  import { onMount } from "svelte";

  let {
    src,
    alt = "",
    class: className = "",
    charSet = " .,:;i1tfLCG08@",
    resolution = 4,
    settleDuration = 2000
  }: {
    src: string;
    alt?: string;
    class?: string;
    charSet?: string;
    resolution?: number;
    settleDuration?: number;
  } = $props();

  let canvas: HTMLCanvasElement;
  let finalAscii = $state("");        // The target ASCII art
  let displayedAscii = $state("");    // What's currently shown (scrambled → settled)
  let isHovering = $state(false);
  let imageLoaded = $state(false);
  let container: HTMLDivElement;
  
  let animationFrame: number | null = null;
  let settledIndices: Set<number> = new Set();

  // Calculate font size based on resolution
  const fontSize = $derived(resolution * 1.2);
  const lineHeight = $derived(resolution * 1.1);
  
  // Characters to use for scrambling (excluding spaces and newlines)
  const scrambleChars = $derived(charSet.replace(/\s/g, '') + "!@#$%^&*<>[]{}");

  onMount(() => {
    generateAscii();
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  });

  async function generateAscii() {
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const cols = Math.floor(img.width / resolution);
      const rows = Math.floor(img.height / (resolution * 1.8));

      canvas.width = cols;
      canvas.height = rows;

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
            result += " ";
          } else {
            const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            const charIndex = Math.floor(brightness * (charSet.length - 1));
            result += charSet[charIndex];
          }
        }
        result += "\n";
      }

      finalAscii = result;
      imageLoaded = true;
    };

    img.src = src;
  }

  function getRandomChar(): string {
    return scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
  }

  function startScrambleAnimation() {
    if (!finalAscii) return;
    
    // Cancel any existing animation
    if (animationFrame) cancelAnimationFrame(animationFrame);
    
    // Reset state
    settledIndices = new Set();
    const startTime = performance.now();
    const totalChars = finalAscii.length;
    
    // Create array of indices to settle (excluding newlines and spaces)
    const indicesToSettle: number[] = [];
    for (let i = 0; i < finalAscii.length; i++) {
      if (finalAscii[i] !== '\n' && finalAscii[i] !== ' ') {
        indicesToSettle.push(i);
      }
    }
    
    // Shuffle the indices for random settling order
    for (let i = indicesToSettle.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indicesToSettle[i], indicesToSettle[j]] = [indicesToSettle[j], indicesToSettle[i]];
    }

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / settleDuration, 1);
      
      // How many characters should be settled by now
      const shouldBeSettled = Math.floor(progress * indicesToSettle.length);
      
      // Settle new characters
      while (settledIndices.size < shouldBeSettled && settledIndices.size < indicesToSettle.length) {
        settledIndices.add(indicesToSettle[settledIndices.size]);
      }
      
      // Build the display string
      let result = "";
      for (let i = 0; i < finalAscii.length; i++) {
        const char = finalAscii[i];
        if (char === '\n' || char === ' ') {
          // Keep whitespace as-is
          result += char;
        } else if (settledIndices.has(i)) {
          // This character has settled
          result += char;
        } else {
          // Still scrambling
          result += getRandomChar();
        }
      }
      
      displayedAscii = result;
      
      // Continue animation if not complete and still hovering
      if (progress < 1 && isHovering) {
        animationFrame = requestAnimationFrame(animate);
      } else if (progress >= 1) {
        // Ensure final state is correct
        displayedAscii = finalAscii;
      }
    }
    
    animationFrame = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  function handleMouseEnter() {
    isHovering = true;
    startScrambleAnimation();
  }

  function handleMouseLeave() {
    isHovering = false;
    stopAnimation();
  }
</script>

<div
  bind:this={container}
  class="ascii-image-container relative overflow-hidden"
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  role="img"
  aria-label={alt}
>
  <!-- Original image -->
  <img
    {src}
    {alt}
    class="{className}"
    class:opacity-0={isHovering && imageLoaded}
  />
  
  <!-- ASCII overlay - only rendered on hover, no centering to prevent zoom -->
  {#if imageLoaded && isHovering}
    <pre
      class="ascii-overlay absolute top-0 left-0 overflow-hidden whitespace-pre font-mono pointer-events-none"
      style="font-size: {fontSize}px; line-height: {lineHeight}px;"
      aria-hidden="true"
    >{displayedAscii || finalAscii}</pre>
  {/if}
  
  <!-- Hidden canvas for pixel sampling -->
  <canvas bind:this={canvas} class="hidden" aria-hidden="true"></canvas>
</div>

<style>
  .ascii-image-container {
    cursor: pointer;
  }

  .ascii-overlay {
    color: currentColor;
    opacity: 0.9;
    background: var(--ascii-bg, transparent);
  }

  pre {
    margin: 0;
    padding: 0;
  }
</style>
