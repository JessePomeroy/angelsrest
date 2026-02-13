<!--
  AsciiImage Component
  
  Displays an image that transforms into ASCII art on hover.
  Renders ASCII to canvas so both image and ASCII use identical object-cover behavior.
-->

<script lang="ts">
  import { onMount } from "svelte";

  let {
    src,
    alt = "",
    class: className = "",
    charSet = " .,:;i1tfLCG08@",
    resolution = 4,
    settleDuration = 2000,
  }: {
    src: string;
    alt?: string;
    class?: string;
    charSet?: string;
    resolution?: number;
    settleDuration?: number;
  } = $props();

  let sourceCanvas: HTMLCanvasElement;
  let asciiCanvas: HTMLCanvasElement;
  let asciiDataUrl = $state("");
  let displayedAsciiUrl = $state("");
  let isHovering = $state(false);
  let imageLoaded = $state(false);

  let animationFrame: number | null = null;
  let asciiChars: string[] = [];
  let settledIndices: Set<number> = new Set();
  let asciiCols = 0;
  let asciiRows = 0;

  const scrambleChars = $derived(charSet.replace(/\s/g, "") + "!@#$%^&*<>[]{}");

  onMount(() => {
    generateAscii();
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  });

  function generateAscii() {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const ctx = sourceCanvas.getContext("2d");
      if (!ctx) return;

      // Store original image dimensions
      const imgWidth = img.width;
      const imgHeight = img.height;

      // Calculate ASCII grid
      asciiCols = Math.floor(imgWidth / resolution);
      asciiRows = Math.floor(imgHeight / (resolution * 1.8));

      sourceCanvas.width = asciiCols;
      sourceCanvas.height = asciiRows;

      ctx.drawImage(img, 0, 0, asciiCols, asciiRows);

      // Store original dimensions for canvas rendering
      (window as any).__asciiImgWidth = imgWidth;
      (window as any).__asciiImgHeight = imgHeight;
      const imageData = ctx.getImageData(0, 0, asciiCols, asciiRows);
      const pixels = imageData.data;

      // Build ASCII character array
      asciiChars = [];
      for (let y = 0; y < asciiRows; y++) {
        for (let x = 0; x < asciiCols; x++) {
          const i = (y * asciiCols + x) * 4;
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          const a = pixels[i + 3];

          if (a < 128) {
            asciiChars.push(" ");
          } else {
            const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            const charIndex = Math.floor(brightness * (charSet.length - 1));
            asciiChars.push(charSet[charIndex]);
          }
        }
      }

      // Render final ASCII to canvas and get data URL
      asciiDataUrl = renderAsciiToCanvas(asciiChars);
      imageLoaded = true;
    };

    img.src = src;
  }

  function renderAsciiToCanvas(chars: string[]): string {
    // Use original image dimensions so object-cover behaves identically
    const width = (window as any).__asciiImgWidth || 800;
    const height = (window as any).__asciiImgHeight || 1000;

    const charWidth = width / asciiCols;
    const charHeight = height / asciiRows;
    const fontSize = Math.min(charWidth, charHeight) * 1.2;

    asciiCanvas.width = width;
    asciiCanvas.height = height;

    const ctx = asciiCanvas.getContext("2d");
    if (!ctx) return "";

    // Dark background
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, width, height);

    // Draw ASCII text
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = "top";

    for (let y = 0; y < asciiRows; y++) {
      for (let x = 0; x < asciiCols; x++) {
        const char = chars[y * asciiCols + x];
        ctx.fillText(char, x * charWidth, y * charHeight);
      }
    }

    return asciiCanvas.toDataURL();
  }

  function getRandomChar(): string {
    return scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
  }

  function startScrambleAnimation() {
    if (!asciiChars.length) return;

    if (animationFrame) cancelAnimationFrame(animationFrame);

    settledIndices = new Set();
    const startTime = performance.now();

    // Create shuffled indices for random settling
    const indicesToSettle: number[] = [];
    for (let i = 0; i < asciiChars.length; i++) {
      if (asciiChars[i] !== " ") {
        indicesToSettle.push(i);
      }
    }
    for (let i = indicesToSettle.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indicesToSettle[i], indicesToSettle[j]] = [
        indicesToSettle[j],
        indicesToSettle[i],
      ];
    }

    function animate(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / settleDuration, 1);

      const shouldBeSettled = Math.floor(progress * indicesToSettle.length);

      while (
        settledIndices.size < shouldBeSettled &&
        settledIndices.size < indicesToSettle.length
      ) {
        settledIndices.add(indicesToSettle[settledIndices.size]);
      }

      // Build current frame's characters
      const currentChars: string[] = [];
      for (let i = 0; i < asciiChars.length; i++) {
        if (asciiChars[i] === " ") {
          currentChars.push(" ");
        } else if (settledIndices.has(i)) {
          currentChars.push(asciiChars[i]);
        } else {
          currentChars.push(getRandomChar());
        }
      }

      displayedAsciiUrl = renderAsciiToCanvas(currentChars);

      if (progress < 1 && isHovering) {
        animationFrame = requestAnimationFrame(animate);
      } else if (progress >= 1) {
        displayedAsciiUrl = asciiDataUrl;
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
    class={className}
    style="visibility: {isHovering && imageLoaded ? 'hidden' : 'visible'};"
  />

  <!-- ASCII as image - uses same object-cover as original -->
  {#if imageLoaded && isHovering}
    <img
      src={displayedAsciiUrl || asciiDataUrl}
      alt=""
      class="{className} absolute inset-0"
      aria-hidden="true"
    />
  {/if}

  <!-- Hidden canvases -->
  <canvas bind:this={sourceCanvas} class="hidden"></canvas>
  <canvas bind:this={asciiCanvas} class="hidden"></canvas>
</div>

<style>
  .ascii-image-container {
    cursor: pointer;
  }
</style>
