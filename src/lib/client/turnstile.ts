const TURNSTILE_SCRIPT_URL =
	"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_SCRIPT_SELECTOR =
	'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]';
const TURNSTILE_LOAD_TIMEOUT_MS = 10_000;

interface TurnstileRenderOptions {
	sitekey: string;
	theme?: "auto" | "light" | "dark";
	action?: string;
	callback?: (token: string) => void;
	"error-callback"?: (errorCode: string) => boolean | undefined;
	"expired-callback"?: () => void;
}

export interface TurnstileApi {
	render: (container: string | HTMLElement, options: TurnstileRenderOptions) => string;
	reset: (widgetId?: string) => void;
	remove: (widgetId: string) => void;
}

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let loadPromise: Promise<TurnstileApi> | undefined;

function currentApi(): TurnstileApi | undefined {
	return (window as TurnstileWindow).turnstile;
}

export function loadTurnstile(): Promise<TurnstileApi> {
	const loaded = currentApi();
	if (loaded) return Promise.resolve(loaded);
	if (loadPromise) return loadPromise;

	loadPromise = new Promise<TurnstileApi>((resolve, reject) => {
		// With no API and no in-flight singleton promise, a matching script is
		// stale (for example, a prior failed load). Replace it so retries can
		// observe a fresh load/error event.
		document.querySelector<HTMLScriptElement>(TURNSTILE_SCRIPT_SELECTOR)?.remove();
		const script = document.createElement("script");
		script.src = TURNSTILE_SCRIPT_URL;
		script.async = true;
		script.defer = true;
		let settled = false;

		const timeout = window.setTimeout(() => {
			finish(() => reject(new Error("Timed out loading Turnstile")), true);
		}, TURNSTILE_LOAD_TIMEOUT_MS);

		function cleanup(removeScript: boolean) {
			window.clearTimeout(timeout);
			script.removeEventListener("load", handleLoad);
			script.removeEventListener("error", handleError);
			if (removeScript) script.remove();
		}

		function finish(result: () => void, removeScript = false) {
			if (settled) return;
			settled = true;
			cleanup(removeScript);
			result();
		}

		function handleLoad() {
			const api = currentApi();
			if (api) finish(() => resolve(api));
			else finish(() => reject(new Error("Turnstile loaded without exposing its API")), true);
		}

		function handleError() {
			finish(() => reject(new Error("Failed to load Turnstile")), true);
		}

		script.addEventListener("load", handleLoad, { once: true });
		script.addEventListener("error", handleError, { once: true });
		document.head.append(script);
	}).catch((error) => {
		loadPromise = undefined;
		throw error;
	});

	return loadPromise;
}
