import type { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { createRawSnippet } from "svelte";
import { render } from "svelte/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminRouteLayout from "../+layout.svelte";

type SessionValue = {
	data: { user: { email: string } } | null;
	isPending: boolean;
};

type AuthProvider = () => {
	isLoading: boolean;
	isAuthenticated: boolean;
	fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
};

const authHarness = vi.hoisted(() => {
	const subscribers = new Set<(value: SessionValue) => void>();
	let session: SessionValue = {
		data: { user: { email: "creator@example.com" } },
		isPending: false,
	};
	const signOut = vi.fn<(...args: unknown[]) => Promise<unknown>>();
	const unchangedMethod = vi.fn();
	const client = {
		signOut,
		unchangedMethod,
		useSession: () => ({
			subscribe(callback: (value: SessionValue) => void) {
				subscribers.add(callback);
				callback(session);
				return () => subscribers.delete(callback);
			},
		}),
	};

	return {
		client,
		signOut,
		unchangedMethod,
		configuredClient: null as typeof client | null,
		emitSession(value: SessionValue) {
			session = value;
			for (const subscriber of subscribers) subscriber(value);
		},
		resetSession(value: SessionValue) {
			subscribers.clear();
			session = value;
		},
	};
});

const convexHarness = vi.hoisted(() => ({
	client: null as ConvexClient | null,
	authProvider: null as AuthProvider | null,
	lastProviderAuth: null as boolean | null,
}));

const navigationHarness = vi.hoisted(() => ({
	invalidateAll: vi.fn<() => Promise<void>>(),
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
			authProvider: AuthProvider,
			options?: { initialState?: { isAuthenticated: boolean } },
		) => {
			convexHarness.authProvider = authProvider;
			convexHarness.lastProviderAuth = options?.initialState?.isAuthenticated ?? false;

			// Model convex-svelte's synchronous initialState contract. The real
			// ConvexClient below generates all WebSocket protocol messages.
			if (!convexHarness.lastProviderAuth) return;
			const { fetchAccessToken } = authProvider();
			convexHarness.client?.setAuth(fetchAccessToken, () => undefined);
		},
	};
});

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$app/navigation", () => ({ invalidateAll: navigationHarness.invalidateAll }));
vi.mock("$lib/auth/client", () => ({ authClient: authHarness.client }));
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
		setAdminConfig: (config: { authClient?: typeof authHarness.client }) => {
			authHarness.configuredClient = config.authClient ?? null;
		},
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

function authenticatesUser(message: ClientMessage) {
	return message.type === "Authenticate" && message.tokenType === "User";
}

function revokesUser(message: ClientMessage) {
	return message.type === "Authenticate" && message.tokenType === "None";
}

function getClient() {
	if (!convexHarness.client) {
		throw new Error("Expected setupConvex to create a client");
	}
	return convexHarness.client;
}

function getAuthProvider() {
	if (!convexHarness.authProvider) {
		throw new Error("Expected setupAuth to capture its provider");
	}
	return convexHarness.authProvider;
}

function getConfiguredAuthClient() {
	if (!authHarness.configuredClient) {
		throw new Error("Expected setAdminConfig to receive an auth client");
	}
	return authHarness.configuredClient;
}

function reconcileConvexAuth() {
	const authProvider = getAuthProvider();
	const nextAuth = authProvider().isAuthenticated;
	if (nextAuth === convexHarness.lastProviderAuth) return;

	convexHarness.lastProviderAuth = nextAuth;
	if (nextAuth) {
		getClient().setAuth(authProvider().fetchAccessToken, () => undefined);
	} else {
		// Model setupAuth's public null-token cleanup. The layout owns the
		// synchronous BaseConvexClient clear that emits Authenticate(None).
		getClient().setAuth(
			async () => null,
			() => undefined,
		);
	}
}

const authorizedData = {
	isPreview: false,
	siteSettings: null,
	adminSession: {
		status: "authorized" as const,
		email: "creator@example.com",
		tier: "full" as const,
		isCreator: true,
	},
};

async function renderAuthorizedLayout(
	children = createRawSnippet(() => ({ render: () => "<div data-admin-child></div>" })),
) {
	await render(AdminRouteLayout, {
		props: {
			data: authorizedData,
			children,
		},
	});
}

describe("admin layout Convex auth ordering", () => {
	let clientMessages: ClientMessage[];

	beforeEach(() => {
		clientMessages = [];
		authHarness.resetSession({
			data: { user: { email: "creator@example.com" } },
			isPending: false,
		});
		authHarness.signOut.mockReset();
		authHarness.unchangedMethod.mockReset();
		authHarness.configuredClient = null;
		convexHarness.authProvider = null;
		convexHarness.lastProviderAuth = null;
		navigationHarness.invalidateAll.mockReset();
		navigationHarness.invalidateAll.mockImplementation(async () => {
			reconcileConvexAuth();
			await Promise.resolve();
		});

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
			vi.fn().mockImplementation(
				async () =>
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

		await renderAuthorizedLayout(children);

		await vi.waitFor(() => {
			expect(clientMessages.some((message) => addsQuery(message, "products:list"))).toBe(true);
		});

		const authenticateIndex = clientMessages.findIndex(authenticatesUser);
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

	it("revokes protocol auth and reloads server state before a later protected query", async () => {
		await renderAuthorizedLayout();
		await vi.waitFor(() => expect(clientMessages.some(authenticatesUser)).toBe(true));

		const configuredClient = getConfiguredAuthClient();
		const signOutResult = { data: { success: true }, error: null };
		const signOutArgs = { fetchOptions: { headers: { "x-test-sign-out": "true" } } };
		authHarness.signOut.mockResolvedValue(signOutResult);

		expect(configuredClient.unchangedMethod).toBe(authHarness.unchangedMethod);
		const result = await configuredClient.signOut(signOutArgs);
		expect(result).toBe(signOutResult);
		expect(authHarness.signOut).toHaveBeenCalledWith(signOutArgs);
		expect(navigationHarness.invalidateAll).toHaveBeenCalledTimes(1);
		expect(getAuthProvider()().isAuthenticated).toBe(false);

		await vi.waitFor(() => expect(clientMessages.some(revokesUser)).toBe(true));
		const messagesBeforeQuery = clientMessages.length;
		const protectedQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"crm:listClients",
		);
		const unsubscribe = getClient().onUpdate(protectedQuery, {}, () => undefined);

		await vi.waitFor(() => {
			expect(clientMessages.some((message) => addsQuery(message, "crm:listClients"))).toBe(true);
		});

		const revokeIndex = clientMessages.findIndex(revokesUser);
		const protectedQueryIndex = clientMessages.findIndex((message) =>
			addsQuery(message, "crm:listClients"),
		);
		expect(revokeIndex).toBeLessThan(messagesBeforeQuery);
		expect(revokeIndex).toBeLessThan(protectedQueryIndex);
		unsubscribe();
	});

	it("preserves a rejected signOut without revoking or invalidating", async () => {
		await renderAuthorizedLayout();
		await vi.waitFor(() => expect(clientMessages.some(authenticatesUser)).toBe(true));

		const rejection = new Error("sign-out request failed");
		authHarness.signOut.mockRejectedValue(rejection);
		const messageStart = clientMessages.length;

		await expect(getConfiguredAuthClient().signOut()).rejects.toBe(rejection);
		expect(getAuthProvider()().isAuthenticated).toBe(true);
		expect(navigationHarness.invalidateAll).not.toHaveBeenCalled();
		expect(clientMessages.slice(messageStart).some(revokesUser)).toBe(false);
	});

	it("preserves a signOut error result without revoking or invalidating", async () => {
		await renderAuthorizedLayout();
		await vi.waitFor(() => expect(clientMessages.some(authenticatesUser)).toBe(true));

		const errorResult = {
			data: null,
			error: { message: "sign-out denied", status: 500, statusText: "Internal Server Error" },
		};
		authHarness.signOut.mockResolvedValue(errorResult);
		const messageStart = clientMessages.length;

		await expect(getConfiguredAuthClient().signOut()).resolves.toBe(errorResult);
		expect(getAuthProvider()().isAuthenticated).toBe(true);
		expect(navigationHarness.invalidateAll).not.toHaveBeenCalled();
		expect(clientMessages.slice(messageStart).some(revokesUser)).toBe(false);
	});

	it("does not revoke auth for transient null session emissions during navigation", async () => {
		await renderAuthorizedLayout();
		await vi.waitFor(() => expect(clientMessages.some(authenticatesUser)).toBe(true));
		const messageStart = clientMessages.length;

		authHarness.emitSession({ data: null, isPending: false });
		reconcileConvexAuth();
		expect(getAuthProvider()().isAuthenticated).toBe(true);

		const navigationQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"quotes:list",
		);
		const unsubscribe = getClient().onUpdate(navigationQuery, {}, () => undefined);
		authHarness.emitSession({
			data: { user: { email: "creator@example.com" } },
			isPending: false,
		});
		reconcileConvexAuth();

		await vi.waitFor(() => {
			expect(clientMessages.some((message) => addsQuery(message, "quotes:list"))).toBe(true);
		});
		expect(clientMessages.slice(messageStart).some(revokesUser)).toBe(false);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it("reauthenticates only after session clear and a later confirmed login", async () => {
		await renderAuthorizedLayout();
		await vi.waitFor(() => expect(clientMessages.some(authenticatesUser)).toBe(true));
		authHarness.signOut.mockResolvedValue({ data: { success: true }, error: null });

		await getConfiguredAuthClient().signOut();
		await vi.waitFor(() => expect(clientMessages.some(revokesUser)).toBe(true));
		const revokeIndex = clientMessages.findIndex(revokesUser);

		// A stale signed-in emission cannot undo the explicit sign-out.
		authHarness.emitSession({
			data: { user: { email: "creator@example.com" } },
			isPending: false,
		});
		reconcileConvexAuth();
		expect(getAuthProvider()().isAuthenticated).toBe(false);

		authHarness.emitSession({ data: null, isPending: false });
		authHarness.emitSession({
			data: { user: { email: "creator@example.com" } },
			isPending: false,
		});
		expect(getAuthProvider()().isAuthenticated).toBe(true);
		reconcileConvexAuth();

		await vi.waitFor(() => {
			expect(clientMessages.filter(authenticatesUser)).toHaveLength(2);
		});
		const loginAuthenticateIndex = clientMessages.findLastIndex(authenticatesUser);
		expect(loginAuthenticateIndex).toBeGreaterThan(revokeIndex);

		const postLoginQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"invoices:list",
		);
		const unsubscribe = getClient().onUpdate(postLoginQuery, {}, () => undefined);
		await vi.waitFor(() => {
			expect(clientMessages.some((message) => addsQuery(message, "invoices:list"))).toBe(true);
		});
		const queryIndex = clientMessages.findIndex((message) => addsQuery(message, "invoices:list"));
		expect(loginAuthenticateIndex).toBeLessThan(queryIndex);
		unsubscribe();
	});
});
