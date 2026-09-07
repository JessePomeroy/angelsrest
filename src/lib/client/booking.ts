// Cal's command queue is the provider boundary; Svelte owns the visible button.
// Protocol: https://cal.com/help/embedding/embed-instructions
const SCRIPT_URL = "https://app.cal.com/embed/embed.js";
const NAMESPACE = "photosession";

type Command =
	| ["init", string, { origin: string }]
	| ["initNamespace", string]
	| [
			"ui",
			{ hideEventTypeDetails: boolean; layout: "month_view"; useSlotsViewOnSmallScreen: boolean },
	  ]
	| ["modal", { calLink: string }]
	| ["closeModal"];
export type BookingApi = (...command: Command) => void;
type QueuedApi = BookingApi & { q: Command[]; instance?: unknown };
type CalGlobal = QueuedApi & { ns: Record<string, QueuedApi>; loaded?: boolean };
type CalWindow = Window & { Cal?: CalGlobal };
let loading: Promise<BookingApi> | undefined;

function commandQueue(): QueuedApi {
	const api: QueuedApi = Object.assign(
		(...command: Command) => {
			api.q.push(command);
		},
		{ q: [] as Command[] },
	);
	return api;
}

export function loadBooking(): Promise<BookingApi> {
	if (loading) return loading;
	const host = window as CalWindow;
	const cal: CalGlobal = host.Cal ?? Object.assign(commandQueue(), { ns: {} });
	host.Cal = cal;
	if (!cal.ns[NAMESPACE]) {
		cal.ns[NAMESPACE] = commandQueue();
		cal.ns[NAMESPACE]("init", NAMESPACE, { origin: "https://app.cal.com" });
		cal("initNamespace", NAMESPACE);
	}
	if (cal.ns[NAMESPACE].instance) return Promise.resolve(cal.ns[NAMESPACE]);

	loading = new Promise<BookingApi>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
		const script = existing ?? document.createElement("script");
		const timeout = window.setTimeout(() => finish(new Error("Booking widget timed out")), 10_000);
		let settled = false;
		function finish(error?: Error) {
			if (settled) return;
			settled = true;
			window.clearTimeout(timeout);
			script.removeEventListener("load", loaded);
			script.removeEventListener("error", failed);
			if (error) {
				if (!existing) script.remove();
				reject(error);
			} else resolve(cal.ns[NAMESPACE]);
		}
		function loaded() {
			finish(
				cal.ns[NAMESPACE].instance ? undefined : new Error("Booking widget did not initialize"),
			);
		}
		function failed() {
			finish(new Error("Booking widget could not load"));
		}
		script.addEventListener("load", loaded, { once: true });
		script.addEventListener("error", failed, { once: true });
		if (!existing) {
			cal.loaded = true;
			script.src = SCRIPT_URL;
			script.async = true;
			document.head.append(script);
		}
	}).catch((error: unknown) => {
		loading = undefined;
		throw error;
	});
	return loading;
}
