import type { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminRouteLayout from "../+layout.svelte";

const convexHarness = vi.hoisted(() => ({
	client: null as ConvexClient | null,
}));

vi.mock("convex-svelte", async () => {
	const { ConvexClient } = await import("convex/browser");

	return {
		setupConvex: (url: string) => {
			const client = new ConvexClient(url, {
				logger: false,
				unsavedChangesWarning: false,
				webSocketConstructor: WebSocket,
			});
			convexHarness.client = client;
			return client;
		},
		setupAuth: (
			authProvider: () => {
				fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
			},
			options?: { initialState?: { isAuthenticated: boolean } },
		) => {
			// Model convex-svelte's synchronous initialState contract. The real
			// ConvexClient below generates all WebSocket protocol messages.
			if (!options?.initialState?.isAuthenticated) return;
			const { fetchAccessToken } = authProvider();
			convexHarness.client?.setAuth(fetchAccessToken, () => undefined);
		},
	};
});

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$app/navigation", () => ({ invalidateAll: vi.fn() }));
vi.mock("$lib/auth/client", () => ({ authClient: null }));
vi.mock("$lib/config/admin", () => ({ adminConfig: {} }));
vi.mock("@jessepomeroy/admin", () => {
	const renderChildren = (payload: unknown, props: { children?: (payload: unknown) => void }) =>
		props.children?.(payload);

	return {
		AdminLayout: renderChildren,
		AuthGuard: renderChildren,
		LoadingState: () => undefined,
		isTenantAdminServerAuthorized: (session: { status?: string } | undefined) =>
			session?.status === "authorized",
		setAdminConfig: vi.fn(),
	};
});

type ClientMessage = {
	type: string;
	tokenType?: string;
	modifications?: Array<{
		type: string;
		udfPath?: string;
	}>;
};

function parseClientMessage(data: unknown): ClientMessage {
	if (typeof data !== "string") {
		throw new Error("Expected a text WebSocket message");
	}

	const value: unknown = JSON.parse(data);
	if (!value || typeof value !== "object" || !("type" in value) || typeof value.type !== "string") {
		throw new Error("Expected a Convex client message");
	}

	return value as ClientMessage;
}

function addsQuery(message: ClientMessage, udfPath: string) {
	return (
		message.type === "ModifyQuerySet" &&
		message.modifications?.some(
			(modification) => modification.type === "Add" && modification.udfPath === udfPath,
		) === true
	);
}

function getClient() {
	if (!convexHarness.client) {
		throw new Error("Expected setupConvex to create a client");
	}
	return convexHarness.client;
}

describe("admin layout Convex auth ordering", () => {
	let clientMessages: ClientMessage[];

	beforeEach(() => {
		clientMessages = [];

		class InMemoryWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;

			onopen: (() => void) | null = null;
			onclose: ((event: { code: number; reason: string }) => void) | null = null;
			onerror: ((event: { message: string }) => void) | null = null;
			onmessage: ((event: { data: string }) => void) | null = null;
			readyState = InMemoryWebSocket.CONNECTING;

			constructor(_url: string | URL) {
				queueMicrotask(() => {
					if (this.readyState !== InMemoryWebSocket.CONNECTING) return;
					this.readyState = InMemoryWebSocket.OPEN;
					this.onopen?.();
				});
			}

			send(data: unknown) {
				clientMessages.push(parseClientMessage(data));
			}

			close(code = 1000, reason = "") {
				if (this.readyState === InMemoryWebSocket.CLOSED) return;
				this.readyState = InMemoryWebSocket.CLOSED;
				this.onclose?.({ code, reason });
			}
		}

		vi.stubGlobal("WebSocket", InMemoryWebSocket as unknown as typeof WebSocket);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ token: "header.payload.signature" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		);
	});

	afterEach(async () => {
		await convexHarness.client?.close();
		convexHarness.client = null;
		vi.unstubAllGlobals();
	});

	it("uses hydrated server auth before protected subscriptions and preserves it across navigation", async () => {
		const listProducts = makeFunctionReference<"query", Record<string, never>, unknown>(
			"products:list",
		);
		const getProduct = makeFunctionReference<"query", { productId: string }, unknown>(
			"products:get",
		);
		let unsubscribeList: (() => void) | undefined;
		const children = createRawSnippet(() => {
			unsubscribeList = getClient().onUpdate(listProducts, {}, () => undefined);
			return { render: () => "<div data-protected-query></div>" };
		});

		await render(AdminRouteLayout, {
			props: {
				data: {
					isPreview: false,
					siteSettings: null,
					adminSession: {
						status: "authorized",
						email: "creator@example.com",
						tier: "full",
						isCreator: true,
					},
				},
				children,
			},
		});

		await vi.waitFor(() => {
			expect(clientMessages.some((message) => addsQuery(message, "products:list"))).toBe(true);
		});

		const authenticateIndex = clientMessages.findIndex(
			(message) => message.type === "Authenticate" && message.tokenType === "User",
		);
		const firstProtectedQueryIndex = clientMessages.findIndex((message) =>
			addsQuery(message, "products:list"),
		);
		expect(authenticateIndex).toBeGreaterThan(-1);
		expect(authenticateIndex).toBeLessThan(firstProtectedQueryIndex);

		const navigationStart = clientMessages.length;
		unsubscribeList?.();
		const unsubscribeDetail = getClient().onUpdate(
			getProduct,
			{ productId: "product-1" },
			() => undefined,
		);
		unsubscribeDetail();
		const unsubscribeBack = getClient().onUpdate(listProducts, {}, () => undefined);

		await vi.waitFor(() => {
			const navigationMessages = clientMessages.slice(navigationStart);
			expect(navigationMessages.some((message) => addsQuery(message, "products:get"))).toBe(true);
			expect(navigationMessages.some((message) => addsQuery(message, "products:list"))).toBe(true);
		});

		const navigationMessages = clientMessages.slice(navigationStart);
		expect(navigationMessages.every((message) => message.type === "ModifyQuerySet")).toBe(true);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		unsubscribeBack();
	});
});
