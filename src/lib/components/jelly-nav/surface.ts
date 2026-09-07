import {
	ACESFilmicToneMapping,
	Mesh,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	Vector2,
	Vector3,
	Vector4,
	WebGLRenderer,
} from "three";
import { BUBBLE_RADIUS, DOCK_RADIUS, type Point } from "./motion";
import fragmentShader from "./surface.frag.glsl?raw";

interface SurfaceFrame {
	center: Point;
	drops: readonly Point[];
	open: number;
	velocity: Point;
	compression: Point;
	viewport: { width: number; height: number };
	time: number;
	agitation: number;
	ambientRipple: number;
	dark: boolean;
	warmth: number;
}

export interface WaterSurface {
	draw(frame: SurfaceFrame): boolean;
	dispose(): void;
}

// Kept behind a mobile-only dynamic import. Navigation remains ordinary DOM
// controls if WebGL is unavailable, the shader fails, or the context is lost.
export function createWaterSurface(
	canvas: HTMLCanvasElement,
	size: number,
	invalidate: () => void,
): WaterSurface | null {
	const context = canvas.getContext("webgl2", {
		alpha: true,
		antialias: true,
		powerPreference: "low-power",
	});
	if (!context) return null;

	const renderer = new WebGLRenderer({ canvas, context, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(size, size, false);
	renderer.setClearColor(0x000000, 0);
	renderer.toneMapping = ACESFilmicToneMapping;
	let shaderFailed = false;
	renderer.debug.onShaderError = () => {
		shaderFailed = true;
		console.warn("Water navigation shader unavailable; using accessible fallback.");
	};

	const uniforms = {
		uSize: { value: new Vector2(size, size) },
		uDrops: { value: Array.from({ length: 7 }, () => new Vector3()) },
		uVelocity: { value: new Vector2() },
		uCompression: { value: new Vector2() },
		uWalls: { value: new Vector4() },
		uOpen: { value: 0 },
		uTime: { value: 0 },
		uAgitation: { value: 0 },
		uAmbientRipple: { value: 0 },
		uDark: { value: 0 },
		uWarmth: { value: 0 },
	};
	const material = new ShaderMaterial({
		uniforms,
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4(position.xy, 0.0, 1.0);
			}
		`,
		fragmentShader,
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	const geometry = new PlaneGeometry(2, 2);
	const scene = new Scene();
	scene.add(new Mesh(geometry, material));
	const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

	function contextLost(event: Event) {
		event.preventDefault();
		invalidate();
	}
	function contextRestored() {
		shaderFailed = false;
		invalidate();
	}
	canvas.addEventListener("webglcontextlost", contextLost);
	canvas.addEventListener("webglcontextrestored", contextRestored);

	return {
		draw(frame) {
			if (context.isContextLost() || shaderFailed) return false;
			uniforms.uDrops.value[0].set(0, 0, DOCK_RADIUS - frame.open * 11);
			for (let i = 0; i < frame.drops.length; i++) {
				const drop = frame.drops[i];
				uniforms.uDrops.value[i + 1].set(
					drop.x - frame.center.x,
					frame.center.y - drop.y,
					8 + (BUBBLE_RADIUS - 8) * frame.open,
				);
			}
			uniforms.uVelocity.value.set(frame.velocity.x, -frame.velocity.y);
			uniforms.uCompression.value.set(frame.compression.x, frame.compression.y);
			uniforms.uWalls.value.set(
				2 - frame.center.x,
				frame.viewport.width - frame.center.x - 2,
				frame.center.y - frame.viewport.height + 2,
				frame.center.y - 2,
			);
			uniforms.uOpen.value = frame.open;
			uniforms.uTime.value = frame.time;
			uniforms.uAgitation.value = frame.agitation;
			uniforms.uAmbientRipple.value = frame.ambientRipple;
			uniforms.uDark.value = frame.dark ? 1 : 0;
			uniforms.uWarmth.value = frame.warmth;
			renderer.render(scene, camera);
			return !shaderFailed;
		},
		dispose() {
			canvas.removeEventListener("webglcontextlost", contextLost);
			canvas.removeEventListener("webglcontextrestored", contextRestored);
			geometry.dispose();
			material.dispose();
			renderer.dispose();
			renderer.forceContextLoss();
		},
	};
}
