<!--
  WebGL Film Grain Overlay

  Per-pixel noise via a fragment shader — no tiling, no textures,
  no SVG filters. Renders with capped device-pixel scaling and updates at ~8fps
  for authentic film grain cadence with minimal GPU cost.
-->

<script lang="ts">
import { onMount } from "svelte";

let canvas: HTMLCanvasElement;

onMount(() => {
	const context = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
	if (!context) return;
	const gl = context;
	const vs = gl.createShader(gl.VERTEX_SHADER);
	const fs = gl.createShader(gl.FRAGMENT_SHADER);
	const prog = gl.createProgram();
	const buf = gl.createBuffer();
	function releaseResources() {
		gl.useProgram(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		if (buf) gl.deleteBuffer(buf);
		if (prog) gl.deleteProgram(prog);
		if (vs) gl.deleteShader(vs);
		if (fs) gl.deleteShader(fs);
	}
	if (!vs || !fs || !prog || !buf) {
		releaseResources();
		return;
	}
	gl.shaderSource(vs, `
		attribute vec2 p;
		void main() { gl_Position = vec4(p, 0, 1); }
	`);
	gl.compileShader(vs);
	gl.shaderSource(fs, `
		precision highp float;
		uniform float seed;
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
	if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS) || !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
		releaseResources();
		return;
	}
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		releaseResources();
		return;
	}
	gl.useProgram(prog);
	const seedLoc = gl.getUniformLocation(prog, "seed");
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
	const pLoc = gl.getAttribLocation(prog, "p");
	if (pLoc < 0) {
		releaseResources();
		return;
	}
	gl.enableVertexAttribArray(pLoc);
	gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

	const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
	let frame: number | undefined;
	let lastTime = 0;
	let disposed = false;
	function draw() {
		gl.uniform1f(seedLoc, Math.random() * 100);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}
	function resize() {
		const dpr = Math.min(window.devicePixelRatio, 2);
		canvas.width = Math.round(window.innerWidth * dpr);
		canvas.height = Math.round(window.innerHeight * dpr);
		gl.viewport(0, 0, canvas.width, canvas.height);
		draw();
	}
	function render(time: number) {
		frame = undefined;
		if (disposed || motion.matches) return;
		if (time - lastTime > 125) {
			draw();
			lastTime = time;
		}
		frame = requestAnimationFrame(render);
	}
	function syncMotion() {
		if (frame !== undefined) cancelAnimationFrame(frame);
		frame = undefined;
		if (!motion.matches) frame = requestAnimationFrame(render);
	}
	resize();
	syncMotion();
	window.addEventListener("resize", resize, { passive: true });
	motion.addEventListener("change", syncMotion);
	return () => {
		disposed = true;
		if (frame !== undefined) cancelAnimationFrame(frame);
		window.removeEventListener("resize", resize);
		motion.removeEventListener("change", syncMotion);
		releaseResources();
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
