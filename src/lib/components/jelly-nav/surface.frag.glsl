precision highp float;

uniform vec2 uSize;
uniform vec3 uDrops[7];
uniform vec2 uVelocity;
uniform vec2 uCompression;
uniform vec4 uWalls;
uniform float uOpen;
uniform float uTime;
uniform float uAgitation;
uniform float uAmbientRipple;
uniform float uDark;
varying vec2 vUv;

// Smooth union gives the separating drops a shared surface and a thinning
// neck. On return, their normals merge continuously instead of overlapping.
float joinDrops(float a, float b, float softness) {
	float h = max(softness - abs(a - b), 0.0) / softness;
	return min(a, b) - h * h * softness * 0.25;
}

float surface(vec3 p) {
	float distanceToSurface = 1000.0;
	for (int i = 0; i < 7; i++) {
		vec3 drop = uDrops[i];
		vec3 local = p - vec3(drop.xy, 0.0);
		// Stretch along the smoothed flow, then flatten and spread at contact.
		// Opposing transverse scales keep the apparent volume approximately constant.
		float speed = length(uVelocity);
		vec2 direction = uVelocity / max(speed, 1.0);
		float stretch = 1.0 + min(speed / 2400.0, 0.22) * (1.0 - uOpen);
		float along = dot(local.xy, direction);
		local.xy += direction * along * (1.0 / stretch - 1.0);
		local.z *= stretch;
		vec2 compression = clamp(uCompression, vec2(0.0), vec2(0.45)) * (1.0 - uOpen);
		vec2 scale = vec2(1.0) - compression * 0.45 + compression.yx * 0.5;
		local.xy /= scale;
		local.z *= scale.x * scale.y;
		local.xy -= uVelocity * local.z * 0.00016;
		float ripple = sin(local.x * 0.11 + uTime * 2.2)
			* sin(local.y * 0.085 - uTime * 1.8)
			* sin(local.z * 0.10 + uTime * 1.4);
		// Broad, slow waves keep the surface alive even after its position settles.
		float swell = sin(local.x * 0.075 + uTime * 0.85)
			* cos(local.y * 0.065 - uTime * 0.65)
			* sin(local.z * 0.055 + uTime * 0.55);
		float d = length(local) - drop.z + ripple * uAgitation * 1.1
			+ swell * uAmbientRipple * 1.6;
		distanceToSurface = joinDrops(distanceToSurface, d, 15.0);
	}
	// A rounded intersection with the viewport planes gives contact a flat
	// face instead of letting the liquid disappear beyond the screen edge.
	float wall = max(max(uWalls.x - p.x, p.x - uWalls.y), max(uWalls.z - p.y, p.y - uWalls.w));
	return -joinDrops(-distanceToSurface, -wall, 3.0);
}

vec3 normalAt(vec3 p) {
	vec2 e = vec2(0.35, 0.0);
	return normalize(vec3(
		surface(p + e.xyy) - surface(p - e.xyy),
		surface(p + e.yxy) - surface(p - e.yxy),
		surface(p + e.yyx) - surface(p - e.yyx)
	));
}

// Small travelling surface slopes bend the reflected window and light strips
// without exaggerating the silhouette. Tangent projection keeps the lighting
// continuous across the shared surface when droplets merge.
vec3 rippledNormal(vec3 p, vec3 normal) {
	vec3 waveA = normalize(vec3(0.8, 0.35, 0.5));
	vec3 waveB = normalize(vec3(-0.3, 0.9, 0.4));
	vec3 waveC = normalize(vec3(0.45, -0.4, 0.8));
	vec3 slope = waveA * cos(dot(p, waveA) * 0.13 - uTime * 0.8) * 0.20
		+ waveB * cos(dot(p, waveB) * 0.105 + uTime * 0.65) * 0.15
		+ waveC * cos(dot(p, waveC) * 0.18 - uTime * 1.05) * 0.07;
	vec3 tangentSlope = slope - normal * dot(slope, normal);
	float strength = (uAmbientRipple * 0.85 + uAgitation * 0.35)
		* smoothstep(0.1, 0.55, normal.z);
	return normalize(normal - tangentSlope * strength);
}

// A quiet photographic lighting environment: broad window, dark horizon,
// narrow overhead strip. Reflections are evaluated on the 3D liquid normal.
vec3 environment(vec3 ray) {
	float sky = smoothstep(-0.45, 0.7, ray.y);
	vec3 color = mix(vec3(0.035, 0.045, 0.05), vec3(0.48, 0.51, 0.52), sky);
	float windowLight = (1.0 - smoothstep(0.28, 0.34, abs(ray.x + 0.42)))
		* (1.0 - smoothstep(0.30, 0.36, abs(ray.y - 0.55)));
	float strip = exp(-pow((ray.x - 0.5) * 15.0, 2.0)
		- pow((ray.y - 0.12) * 1.8, 2.0));
	float lowerLight = exp(-pow((ray.x - 0.1) * 2.0, 2.0)
		- pow((ray.y + 0.75) * 14.0, 2.0));
	return color + vec3(1.0, 0.99, 0.96) * windowLight * 1.7
		+ vec3(0.94, 0.97, 1.0) * strip * 1.0 + lowerLight * 0.55;
}

void main() {
	vec2 xy = (vUv - 0.5) * uSize;
	// Reject empty pixels before the ray march; the canvas is cropped to the
	// orbit, so mobile GPUs never ray-march the entire page.
	float nearest = 1000.0;
	for (int i = 0; i < 7; i++) {
		nearest = min(nearest, length(xy - uDrops[i].xy) - uDrops[i].z);
	}
	if (nearest > 28.0) discard;

	vec3 ray = vec3(0.0, 0.0, -1.0);
	vec3 origin = vec3(xy, 90.0);
	float travel = 0.0;
	float d = 0.0;
	vec3 p = origin;
	for (int i = 0; i < 48; i++) {
		p = origin + ray * travel;
		d = surface(p);
		if (d < 0.18 || travel > 155.0) break;
		travel += max(d * 0.8, 0.15);
	}
	if (d > 0.5 || travel > 155.0) discard;

	vec3 normal = normalAt(p);
	vec3 lightNormal = rippledNormal(p, normal);
	float facing = clamp(dot(normal, -ray), 0.0, 1.0);
	// Water's index of refraction is 1.333; the reflection grows at grazing
	// angles while the center remains transparent to the page below.
	float fresnel = 0.0204 + 0.9796 * pow(1.0 - facing, 5.0);
	vec3 reflection = environment(reflect(ray, lightNormal));
	vec3 transmission = environment(refract(ray, lightNormal, 1.0 / 1.333));
	float rim = pow(1.0 - facing, 2.5);
	vec3 lightDirection = normalize(vec3(-0.55, 0.75, 1.0));
	float specular = pow(max(dot(lightNormal, normalize(lightDirection - ray)), 0.0), 110.0);
	vec3 color = mix(transmission, reflection, 0.56 + fresnel * 0.44);
	color += vec3(specular * 1.1);
	color = mix(color, color * vec3(0.96, 0.99, 1.0), 0.2);
	float reflectedLight = smoothstep(0.6, 1.6, max(reflection.r, max(reflection.g, reflection.b)));
	float alpha = clamp(0.20 + rim * 0.57 + specular * 0.48 + reflectedLight * 0.5 + uDark * 0.04, 0.0, 0.92);
	gl_FragColor = vec4(color, alpha);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
