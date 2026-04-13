<!--
  WebGL Film Grain Overlay

  Per-pixel noise via a fragment shader — no tiling, no textures,
  no SVG filters. Renders at half resolution and updates at ~8fps
  for authentic film grain cadence with minimal GPU cost.
-->

<script lang="ts">
import { onMount } from "svelte";

let canvas: HTMLCanvasElement;

onMount(() => {
	const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
	if (!gl) return;

	// Render at half resolution for performance
	function resize() {
		const dpr = Math.min(window.devicePixelRatio, 2);
		const scale = 1.0;
		canvas.width = Math.round(window.innerWidth * dpr * scale);
		canvas.height = Math.round(window.innerHeight * dpr * scale);
		gl!.viewport(0, 0, canvas.width, canvas.height);
	}
	resize();
	window.addEventListener("resize", resize, { passive: true });

	const vs = gl.createShader(gl.VERTEX_SHADER)!;
	gl.shaderSource(vs, `
		attribute vec2 p;
		void main() { gl_Position = vec4(p, 0, 1); }
	`);
	gl.compileShader(vs);

	const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
	gl.shaderSource(fs, `
		precision highp float;
		uniform float seed;
		uniform vec2 resolution;
		float hash(vec2 p) {
			vec3 p3 = fract(vec3(p.xyx) * 0.1031);
			p3 += dot(p3, p3.yzx + 33.33);
			return fract((p3.x + p3.y) * p3.z);
		}
		void main() {
			float n = hash(gl_FragCoord.xy + seed * 171.0);
			gl_FragColor = vec4(vec3(n), 1.0);
		}
	`);
	gl.compileShader(fs);

	const prog = gl.createProgram()!;
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	gl.useProgram(prog);

	const seedLoc = gl.getUniformLocation(prog, "seed");
	const resLoc = gl.getUniformLocation(prog, "resolution");

	// Fullscreen quad
	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
	const pLoc = gl.getAttribLocation(prog, "p");
	gl.enableVertexAttribArray(pLoc);
	gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

	// Animate at ~8fps for filmic cadence
	let frame = 0;
	let lastTime = 0;
	function render(time: number) {
		if (time - lastTime > 125) {
			gl!.uniform1f(seedLoc, Math.random() * 100);
			gl!.uniform2f(resLoc, canvas.width, canvas.height);
			gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
			lastTime = time;
		}
		frame = requestAnimationFrame(render);
	}
	frame = requestAnimationFrame(render);

	return () => {
		cancelAnimationFrame(frame);
		window.removeEventListener("resize", resize);
	};
});
</script>

<canvas
	bind:this={canvas}
	class="grain-canvas"
	aria-hidden="true"
></canvas>

<style>
	.grain-canvas {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 1;
		opacity: var(--grain-opacity, 0.14);
		mix-blend-mode: var(--grain-blend, overlay);
	}
</style>
