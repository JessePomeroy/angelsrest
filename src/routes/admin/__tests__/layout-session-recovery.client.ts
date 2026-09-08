import type { TenantAdminServerSession } from "@jessepomeroy/admin";
import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Harness from "./AdminSessionHarness.svelte";

type ClientSession = { data: { user: { email: string } } | null; isPending: boolean };
const boundary = vi.hoisted(() => {
	const subscribers = new Set<(value: ClientSession) => void>();
	let value: ClientSession;
	return {
		invalidate: vi.fn<() => Promise<void>>(),
		signOut: vi.fn<() => Promise<unknown>>(),
		close: vi.fn<() => Promise<void>>(),
		reload: vi.fn(),
		subscribe(callback: (value: ClientSession) => void) {
			subscribers.add(callback);
			callback(value);
			return () => subscribers.delete(callback);
		},
		emit(next: ClientSession) {
			value = next;
			for (const callback of subscribers) callback(value);
		},
	};
});

vi.mock("$app/navigation", () => ({ invalidateAll: boundary.invalidate }));
vi.mock("$lib/adminFullPageReload", () => ({ reloadAdminRoot: boundary.reload }));
vi.mock("$lib/auth/client", () => ({
	authClient: {
		useSession: () => ({ subscribe: boundary.subscribe }),
		signOut: boundary.signOut,
		convex: { token: vi.fn() },
	},
}));
vi.mock("$lib/config/admin", () => ({
	adminConfig: { isCreator: true, siteUrl: "angelsrest.online", siteName: "Test admin", api: {} },
}));
vi.mock("convex-svelte", () => ({
	closeConvex: boundary.close,
	setupConvex: vi.fn(),
	setupAuth: vi.fn(),
	useAuth: () => ({ isLoading: false, isAuthenticated: true }),
	useQuery: () => {
		throw new Error("Creator guard should not query browser membership");
	},
}));
// Keep the installed guard, login, loading UI and session helpers real. Existing
// protocol tests separately keep Convex itself real at its WebSocket boundary.
vi.mock("@jessepomeroy/admin", async () => ({
	...(await import("../../../../node_modules/@jessepomeroy/admin/dist/adminSession.js")),
	...(await import("../../../../node_modules/@jessepomeroy/admin/dist/config.js")),
	AuthGuard: (
		await import("../../../../node_modules/@jessepomeroy/admin/dist/components/AuthGuard.svelte")
	).default,
	LoadingState: (
		await import("../../../../node_modules/@jessepomeroy/admin/dist/components/LoadingState.svelte")
	).default,
	AdminLayout: (anchor: unknown, props: { children?: (anchor: unknown) => void }) =>
		props.children?.(anchor),
}));

const authorized: TenantAdminServerSession = {
	status: "authorized",
	email: "member@example.test",
	tier: "full",
	isCreator: true,
};
const denied: TenantAdminServerSession = { status: "unauthorized", email: "member@example.test" };
let component: ReturnType<typeof Harness> | undefined;

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
async function settle() {
	await tick();
	await tick();
	await tick();
}
async function open(session: TenantAdminServerSession = denied) {
	component = mount(Harness, { target: document.body, props: { initialSession: session } });
	await settle();
}
function button(name: string) {
	const target = Array.from(document.querySelectorAll("button")).find(
		(element) => element.textContent?.trim() === name,
	);
	if (!target) throw new Error(`Missing button: ${name}`);
	return target;
}
function expectNoChildren() {
	expect(document.querySelector("[data-protected-child]")).toBeNull();
}

beforeEach(() => {
	vi.resetAllMocks();
	boundary.emit({ data: { user: { email: "member@example.test" } }, isPending: false });
	boundary.invalidate.mockResolvedValue();
	boundary.signOut.mockResolvedValue({ data: { success: true }, error: null });
	boundary.close.mockResolvedValue();
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Unexpected live request");
		}),
	);
});
afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

describe("real shared guard with host server-session recovery", () => {
	it("waits for the browser session before one automatic recovery", async () => {
		boundary.emit({ data: null, isPending: true });
		await open();
		expect(document.querySelector(".auth-loading")).not.toBeNull();
		expect(boundary.invalidate).not.toHaveBeenCalled();
		expectNoChildren();
		boundary.emit({ data: { user: { email: "member@example.test" } }, isPending: false });
		await settle();
		expect(boundary.invalidate).toHaveBeenCalledTimes(1);
		expect(button("retry")).toBeDefined();
		expectNoChildren();
	});

	it("leaves a genuinely logged-out session with the real login form", async () => {
		boundary.emit({ data: null, isPending: false });
		await open({ status: "unauthenticated" });
		expect(document.querySelector(".login-form")).not.toBeNull();
		expect(boundary.invalidate).not.toHaveBeenCalled();
		expectNoChildren();
	});

	it.each([
		"unauthorized",
		"unauthenticated",
	] as const)("leaves loading after completed %s recovery without exposing children", async (status) => {
		await open(status === "unauthorized" ? denied : { status });
		expect(boundary.invalidate).toHaveBeenCalledTimes(1);
		expect(document.querySelector(".admin-session-loading")).toBeNull();
		expect(button("retry")).toBeDefined();
		expect(button("sign out")).toBeDefined();
		expect(document.body.textContent).toContain(
			status === "unauthorized" ? "not authorized" : "could not verify",
		);
		expectNoChildren();
		await settle();
		expect(boundary.invalidate).toHaveBeenCalledTimes(1);
	});

	it("holds children during refresh, then honors newer server authorization", async () => {
		const refresh = deferred();
		boundary.invalidate.mockReturnValue(refresh.promise);
		await open();
		expect(document.querySelector(".admin-session-loading")).not.toBeNull();
		expectNoChildren();
		component?.setServerSession(authorized);
		await settle();
		expect(document.querySelector("[data-protected-child]")).not.toBeNull();
		refresh.resolve();
		await settle();
		expect(document.querySelector("[data-protected-child]")).not.toBeNull();
	});

	it("handles rejected refresh and a single explicit retry that becomes authorized", async () => {
		boundary.invalidate.mockRejectedValueOnce(new Error("Synthetic network failure"));
		await open({ status: "unauthenticated" });
		expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not refresh");
		expectNoChildren();
		const retry = deferred();
		boundary.invalidate.mockReturnValueOnce(retry.promise);
		const retryButton = button("retry");
		retryButton.click();
		retryButton.click();
		await settle();
		expect(boundary.invalidate).toHaveBeenCalledTimes(2);
		expect(document.querySelector(".admin-session-loading")).not.toBeNull();
		expectNoChildren();
		component?.setServerSession(authorized);
		retry.resolve();
		await settle();
		expect(document.querySelector("[data-protected-child]")).not.toBeNull();
		expect(document.querySelector('[role="alert"]')).toBeNull();
	});

	it("keeps a refused manual retry terminal without an automatic retry loop", async () => {
		await open();
		button("retry").click();
		await settle();
		expect(boundary.invalidate).toHaveBeenCalledTimes(2);
		expect(button("retry")).toBeDefined();
		expectNoChildren();
	});

	it("ignores an old refresh completion after the browser session changes", async () => {
		const oldRefresh = deferred();
		const newRefresh = deferred();
		boundary.invalidate
			.mockReturnValueOnce(oldRefresh.promise)
			.mockReturnValueOnce(newRefresh.promise);
		await open();
		boundary.emit({ data: { user: { email: "new@example.test" } }, isPending: false });
		await settle();
		expect(boundary.invalidate).toHaveBeenCalledTimes(2);
		oldRefresh.reject(new Error("Old session failed"));
		await settle();
		expect(document.querySelector(".admin-session-loading")).not.toBeNull();
		expect(document.querySelector('[role="alert"]')).toBeNull();
		expectNoChildren();
		newRefresh.resolve();
		await settle();
		expect(button("retry")).toBeDefined();
	});

	it("uses sign-out's close-before-reload boundary and disables duplicate actions", async () => {
		await open();
		const close = deferred();
		boundary.close.mockReturnValue(close.promise);
		const signOut = button("sign out");
		signOut.click();
		signOut.click();
		await settle();
		expect(boundary.signOut).toHaveBeenCalledTimes(1);
		expect(boundary.close).toHaveBeenCalledTimes(1);
		expect(boundary.reload).not.toHaveBeenCalled();
		expect(button("retry").disabled).toBe(true);
		expectNoChildren();
		close.resolve();
		await settle();
		expect(boundary.reload).toHaveBeenCalledTimes(1);
	});

	it.each([
		"rejection",
		"error result",
		"non-success",
	] as const)("keeps recovery usable after sign-out %s", async (mode) => {
		if (mode === "rejection")
			boundary.signOut.mockRejectedValue(new Error("Synthetic sign-out failure"));
		else
			boundary.signOut.mockResolvedValue(
				mode === "error result"
					? { data: null, error: { message: "Synthetic denial" } }
					: { data: { success: false }, error: null },
			);
		await open();
		button("sign out").click();
		await settle();
		expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not sign out");
		expect(button("retry").disabled).toBe(false);
		expect(button("sign out").disabled).toBe(false);
		expect(boundary.close).not.toHaveBeenCalled();
		expect(boundary.reload).not.toHaveBeenCalled();
		expectNoChildren();
	});
});
