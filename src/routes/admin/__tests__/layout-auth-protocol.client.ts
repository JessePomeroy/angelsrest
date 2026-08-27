// Keep convex-svelte and Convex 1.42 real. The in-memory WebSocket is the
// transport boundary, and the test uses only installed public client APIs.
import { makeFunctionReference } from "convex/server";
import { closeConvex, getConvexClient } from "convex-svelte";
import { createRawSnippet, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminRouteLayout from "../+layout.svelte";

type SessionValue = {
	data: { user: { email: string } } | null;
	isPending: boolean;
};

type SignOutResult = {
	data: { success: boolean } | null;
	error: { message: string; status: number; statusText: string } | null;
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
		reset() {
			subscribers.clear();
			session = {
				data: { user: { email: "creator@example.com" } },
				isPending: false,
			};
		},
	};
});

const navigationHarness = vi.hoisted(() => ({
	invalidateAll: vi.fn<() => Promise<void>>(),
}));

const reloadHarness = vi.hoisted(() => ({
	reloadAdminRoot: vi.fn<() => void>(),
	events: [] as string[],
}));

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$app/navigation", () => ({ invalidateAll: navigationHarness.invalidateAll }));
vi.mock("$lib/adminFullPageReload", () => ({
	reloadAdminRoot: reloadHarness.reloadAdminRoot,
}));
vi.mock("$lib/auth/client", () => ({ authClient: authHarness.client }));
vi.mock("$lib/config/admin", () => ({ adminConfig: {} }));
vi.mock("@jessepomeroy/admin", () => {
	const renderChildren = (anchor: unknown, props: { children?: (anchor: unknown) => void }) =>
		props.children?.(anchor);

	return {
		AdminLayout: renderChildren,
		AuthGuard: renderChildren,
		LoadingState: () => undefined,
		isTenantAdminServerAuthorized: (session: { status?: string } | undefined) =>
			session?.status === "authorized",
		shouldRefreshAdminServerSession: (input: {
			hasBrowser: boolean;
			hasAuthClient: boolean;
			sessionPending: boolean;
			sessionEmail: string | null | undefined;
			serverAuthorized: boolean;
			refreshAttempted: boolean;
			refreshInFlight: boolean;
		}) =>
			input.hasBrowser &&
			input.hasAuthClient &&
			!input.sessionPending &&
			Boolean(input.sessionEmail) &&
			!input.serverAuthorized &&
			!input.refreshAttempted &&
			!input.refreshInFlight,
		shouldHoldAdminShellForServerSession: (input: {
			hasAuthClient: boolean;
			sessionPending: boolean;
			sessionEmail: string | null | undefined;
			serverAuthorized: boolean;
		}) =>
			input.hasAuthClient &&
			!input.sessionPending &&
			Boolean(input.sessionEmail) &&
			!input.serverAuthorized,
		setAdminConfig: (config: { authClient?: typeof authHarness.client }) => {
			authHarness.configuredClient = config.authClient ?? null;
		},
	};
});

type ClientMessage = {
	type: string;
	tokenType?: string;
	value?: string;
	modifications?: Array<{
		type: string;
		udfPath?: string;
	}>;
};

type ServerMessage = {
	type: "Transition";
	startVersion: { querySet: number; identity: number; ts: string };
	endVersion: { querySet: number; identity: number; ts: string };
	modifications: Array<{
		type: "QueryUpdated";
		queryId: number;
		value: unknown;
		logLines: string[];
		journal: null;
	}>;
};

type RecordedMessage = {
	socketId: number;
	message: ClientMessage;
};

function parseClientMessage(data: unknown): ClientMessage {
	if (typeof data !== "string") throw new Error("Expected a text WebSocket message");

	const value: unknown = JSON.parse(data);
	if (!value || typeof value !== "object" || !("type" in value)) {
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

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function makeToken(index: number) {
	const payload = btoa(JSON.stringify({ iat: 2_000_000_000, exp: 2_100_000_000 }))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
	return `eyJhbGciOiJub25lIn0.${payload}.test-${index}`;
}

function getConfiguredAuthClient() {
	if (!authHarness.configuredClient) {
		throw new Error("Expected setAdminConfig to receive an auth client");
	}
	return authHarness.configuredClient;
}

const authorizedData = {
	isPreview: false,
	siteSettings: {
		artistName: "Jesse Pomeroy",
		siteTitle: "Angel's Rest",
		tagline: "Photography and visual art",
		logoUrl: null,
		socialLinks: [],
		seo: {
			description: "Photography by Jesse Pomeroy",
			ogImageUrl: null,
			keywords: [],
		},
	},
	adminSession: {
		status: "authorized" as const,
		email: "creator@example.com",
		tier: "full" as const,
		isCreator: true,
	},
};

describe("admin layout Convex auth protocol and lifecycle", () => {
	let autoFinishSocketClose: boolean;
	let component: ReturnType<typeof mount> | null;
	let records: RecordedMessage[];
	let sockets: InMemoryWebSocket[];
	let tokenRequestCount: number;

	class InMemoryWebSocket {
		static readonly CONNECTING = 0;
		static readonly OPEN = 1;
		static readonly CLOSING = 2;
		static readonly CLOSED = 3;

		readonly closeRequested = deferred<void>();
		readonly id: number;
		onopen: (() => void) | null = null;
		onclose: ((event: { code: number; reason: string }) => void) | null = null;
		onerror: ((event: { message: string }) => void) | null = null;
		onmessage: ((event: { data: string }) => void) | null = null;
		readyState = InMemoryWebSocket.CONNECTING;
		private closeCode = 1000;
		private closeReason = "";

		constructor(_url: string | URL) {
			this.id = sockets.length;
			sockets.push(this);
			queueMicrotask(() => {
				if (this.readyState !== InMemoryWebSocket.CONNECTING) return;
				this.readyState = InMemoryWebSocket.OPEN;
				this.onopen?.();
			});
		}

		send(data: unknown) {
			records.push({ socketId: this.id, message: parseClientMessage(data) });
		}

		receive(message: ServerMessage) {
			if (this.readyState !== InMemoryWebSocket.OPEN) {
				throw new Error("Expected an open WebSocket");
			}
			this.onmessage?.({ data: JSON.stringify(message) });
		}

		close(code = 1000, reason = "") {
			if (
				this.readyState === InMemoryWebSocket.CLOSING ||
				this.readyState === InMemoryWebSocket.CLOSED
			) {
				return;
			}
			this.closeCode = code;
			this.closeReason = reason;
			this.readyState = InMemoryWebSocket.CLOSING;
			reloadHarness.events.push(`close-request:${this.id}`);
			this.closeRequested.resolve();
			if (autoFinishSocketClose) this.finishClose();
		}

		finishClose() {
			if (this.readyState === InMemoryWebSocket.CLOSED) return;
			this.readyState = InMemoryWebSocket.CLOSED;
			reloadHarness.events.push(`closed:${this.id}`);
			this.onclose?.({ code: this.closeCode, reason: this.closeReason });
		}
	}

	function messagesFor(socket: InMemoryWebSocket) {
		return records
			.filter((record) => record.socketId === socket.id)
			.map((record) => record.message);
	}

	function mountAuthorizedLayout(
		children = createRawSnippet(() => ({ render: () => "<div data-admin-child></div>" })),
	) {
		component = mount(AdminRouteLayout, {
			target: document.body,
			props: { data: authorizedData, children },
		});
		return getConvexClient();
	}

	function confirmUser(
		socket: InMemoryWebSocket,
		startIdentity: number,
		endIdentity: number,
		includeInitialQuery: boolean,
	) {
		socket.receive({
			type: "Transition",
			startVersion: {
				querySet: includeInitialQuery ? 0 : 1,
				identity: startIdentity,
				ts: "AAAAAAAAAAA=",
			},
			endVersion: {
				querySet: 1,
				identity: endIdentity,
				ts: "AAAAAAAAAAA=",
			},
			modifications: includeInitialQuery
				? [
						{
							type: "QueryUpdated",
							queryId: 0,
							value: null,
							logLines: [],
							journal: null,
						},
					]
				: [],
		});
	}

	beforeEach(() => {
		autoFinishSocketClose = true;
		component = null;
		records = [];
		sockets = [];
		tokenRequestCount = 0;
		authHarness.reset();
		authHarness.signOut.mockReset();
		authHarness.unchangedMethod.mockReset();
		authHarness.configuredClient = null;
		navigationHarness.invalidateAll.mockReset();
		navigationHarness.invalidateAll.mockResolvedValue();
		reloadHarness.events.length = 0;
		reloadHarness.reloadAdminRoot.mockReset();
		reloadHarness.reloadAdminRoot.mockImplementation(() => {
			reloadHarness.events.push("reload:/admin");
		});

		vi.stubGlobal("WebSocket", InMemoryWebSocket as unknown as typeof WebSocket);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				tokenRequestCount += 1;
				return new Response(JSON.stringify({ token: makeToken(tokenRequestCount) }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}),
		);
	});

	afterEach(async () => {
		autoFinishSocketClose = true;
		for (const socket of sockets) {
			if (socket.readyState === InMemoryWebSocket.CLOSING) socket.finishClose();
		}
		if (component) await unmount(component);
		await closeConvex();
		document.body.replaceChildren();
		vi.unstubAllGlobals();
	});

	it("authenticates from server initialState before queries and ignores transient session null", async () => {
		const initialQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"products:list",
		);
		const navigationQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"quotes:list",
		);
		let unsubscribeInitial: (() => void) | undefined;
		const children = createRawSnippet(() => {
			unsubscribeInitial = getConvexClient().onUpdate(initialQuery, {}, () => undefined);
			return { render: () => "<div data-protected-query></div>" };
		});

		const client = mountAuthorizedLayout(children);
		await vi.waitFor(() => {
			const messages = messagesFor(sockets[0]);
			expect(messages.some(authenticatesUser)).toBe(true);
			expect(messages.some((message) => addsQuery(message, "products:list"))).toBe(true);
		});

		const messages = messagesFor(sockets[0]);
		const userIndex = messages.findIndex(authenticatesUser);
		const queryIndex = messages.findIndex((message) => addsQuery(message, "products:list"));
		expect(userIndex).toBeLessThan(queryIndex);

		const messageStart = records.length;
		authHarness.emitSession({ data: null, isPending: false });
		await tick();
		const unsubscribeNavigation = client.onUpdate(navigationQuery, {}, () => undefined);
		await vi.waitFor(() => {
			expect(
				records.slice(messageStart).some((record) => addsQuery(record.message, "quotes:list")),
			).toBe(true);
		});

		expect(records.slice(messageStart).some((record) => revokesUser(record.message))).toBe(false);
		expect(reloadHarness.events.some((event) => event.startsWith("close-request"))).toBe(false);
		expect(reloadHarness.reloadAdminRoot).not.toHaveBeenCalled();

		authHarness.emitSession({
			data: { user: { email: "creator@example.com" } },
			isPending: false,
		});
		unsubscribeNavigation();
		unsubscribeInitial?.();
	});

	it("closes a paused authenticated connection before reload and blocks stale auth work", async () => {
		const initialQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"products:list",
		);
		const pausedQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"crm:listClients",
		);
		const lateQuery = makeFunctionReference<"query", Record<string, never>, unknown>("quotes:list");
		const loginQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"invoices:list",
		);
		let unsubscribeInitial: (() => void) | undefined;
		const children = createRawSnippet(() => {
			unsubscribeInitial = getConvexClient().onUpdate(initialQuery, {}, () => undefined);
			return { render: () => "<div data-protected-query></div>" };
		});

		const oldClient = mountAuthorizedLayout(children);
		const oldSocket = sockets[0];
		await vi.waitFor(() => {
			const messages = messagesFor(oldSocket);
			expect(messages.some(authenticatesUser)).toBe(true);
			expect(messages.some((message) => addsQuery(message, "products:list"))).toBe(true);
		});

		confirmUser(oldSocket, 0, 1, true);
		await vi.waitFor(() => {
			expect(tokenRequestCount).toBe(2);
			expect(messagesFor(oldSocket).filter(authenticatesUser)).toHaveLength(2);
		});
		confirmUser(oldSocket, 1, 2, false);

		const staleToken = deferred<string | null>();
		const staleFetchStarted = deferred<void>();
		oldClient.setAuth(
			async () => {
				staleFetchStarted.resolve();
				return staleToken.promise;
			},
			() => undefined,
		);
		await staleFetchStarted.promise;

		const pausedMessageStart = records.length;
		const unsubscribePaused = oldClient.onUpdate(pausedQuery, {}, () => undefined);
		await Promise.resolve();
		expect(oldSocket.readyState).toBe(InMemoryWebSocket.OPEN);
		expect(
			records
				.slice(pausedMessageStart)
				.some((record) => addsQuery(record.message, "crm:listClients")),
		).toBe(false);

		autoFinishSocketClose = false;
		const signOutResult: SignOutResult = { data: { success: true }, error: null };
		const signOutArgs = { fetchOptions: { headers: { "x-test-sign-out": "true" } } };
		authHarness.signOut.mockResolvedValueOnce(signOutResult);
		const signOutPromise = getConfiguredAuthClient().signOut(signOutArgs);

		await oldSocket.closeRequested.promise;
		expect(authHarness.signOut).toHaveBeenCalledWith(signOutArgs);
		expect(reloadHarness.reloadAdminRoot).not.toHaveBeenCalled();
		expect(() => getConvexClient()).toThrow("Convex client not initialized");

		const afterCloseRequest = records.length;
		const unsubscribeDuringClose = oldClient.onUpdate(lateQuery, {}, () => undefined);
		await Promise.resolve();
		expect(records).toHaveLength(afterCloseRequest);

		oldSocket.finishClose();
		await expect(signOutPromise).resolves.toBe(signOutResult);
		expect(reloadHarness.events).toEqual(["close-request:0", "closed:0", "reload:/admin"]);

		const afterSignOut = records.length;
		const unsubscribeAfterClose = oldClient.onUpdate(lateQuery, {}, () => undefined);
		staleToken.resolve(makeToken(99));
		await Promise.resolve();
		await Promise.resolve();
		expect(records).toHaveLength(afterSignOut);
		expect(sockets).toHaveLength(1);

		if (component) await unmount(component);
		component = null;
		authHarness.reset();
		authHarness.configuredClient = null;
		document.body.replaceChildren();

		let unsubscribeLogin: (() => void) | undefined;
		const loginChildren = createRawSnippet(() => {
			unsubscribeLogin = getConvexClient().onUpdate(loginQuery, {}, () => undefined);
			return { render: () => "<div data-login-query></div>" };
		});
		mountAuthorizedLayout(loginChildren);
		await vi.waitFor(() => {
			expect(sockets).toHaveLength(2);
			const messages = messagesFor(sockets[1]);
			expect(messages.some(authenticatesUser)).toBe(true);
			expect(messages.some((message) => addsQuery(message, "invoices:list"))).toBe(true);
		});

		const loginMessages = messagesFor(sockets[1]);
		expect(loginMessages.findIndex(authenticatesUser)).toBeLessThan(
			loginMessages.findIndex((message) => addsQuery(message, "invoices:list")),
		);

		unsubscribeLogin?.();
		unsubscribeAfterClose();
		unsubscribeDuringClose();
		unsubscribePaused();
		unsubscribeInitial?.();
	});

	it("closes a nominal unpaused connection before a successful reload request", async () => {
		const initialQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"products:list",
		);
		const lateQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"crm:listClients",
		);
		let unsubscribeInitial: (() => void) | undefined;
		const children = createRawSnippet(() => {
			unsubscribeInitial = getConvexClient().onUpdate(initialQuery, {}, () => undefined);
			return { render: () => "<div data-protected-query></div>" };
		});
		const oldClient = mountAuthorizedLayout(children);
		const socket = sockets[0];
		await vi.waitFor(() => {
			expect(messagesFor(socket).some(authenticatesUser)).toBe(true);
			expect(messagesFor(socket).some((message) => addsQuery(message, "products:list"))).toBe(true);
		});

		const signOutResult: SignOutResult = { data: { success: true }, error: null };
		authHarness.signOut.mockResolvedValueOnce(signOutResult);
		expect(getConfiguredAuthClient().unchangedMethod).toBe(authHarness.unchangedMethod);
		await expect(getConfiguredAuthClient().signOut()).resolves.toBe(signOutResult);
		expect(socket.readyState).toBe(InMemoryWebSocket.CLOSED);
		expect(reloadHarness.events).toEqual(["close-request:0", "closed:0", "reload:/admin"]);

		const messageCount = records.length;
		const unsubscribeLate = oldClient.onUpdate(lateQuery, {}, () => undefined);
		await Promise.resolve();
		expect(records).toHaveLength(messageCount);
		unsubscribeLate();
		unsubscribeInitial?.();
	});

	it("keeps the closed client fail-safe if the full-page reload request fails", async () => {
		const oldClient = mountAuthorizedLayout();
		const socket = sockets[0];
		await vi.waitFor(() => expect(messagesFor(socket).some(authenticatesUser)).toBe(true));

		const reloadError = new Error("navigation unavailable");
		reloadHarness.reloadAdminRoot.mockImplementationOnce(() => {
			reloadHarness.events.push("reload:/admin");
			throw reloadError;
		});
		authHarness.signOut.mockResolvedValueOnce({ data: { success: true }, error: null });

		await expect(getConfiguredAuthClient().signOut()).rejects.toBe(reloadError);
		expect(socket.readyState).toBe(InMemoryWebSocket.CLOSED);
		expect(reloadHarness.events).toEqual(["close-request:0", "closed:0", "reload:/admin"]);
		expect(() => getConvexClient()).toThrow("Convex client not initialized");

		const messageCount = records.length;
		const lateQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"crm:listClients",
		);
		const unsubscribe = oldClient.onUpdate(lateQuery, {}, () => undefined);
		await Promise.resolve();
		expect(records).toHaveLength(messageCount);
		unsubscribe();
	});

	it("does not close for rejected, failed, or error-result signOut", async () => {
		const client = mountAuthorizedLayout();
		const socket = sockets[0];
		await vi.waitFor(() => expect(messagesFor(socket).some(authenticatesUser)).toBe(true));

		const rejection = new Error("sign-out request failed");
		authHarness.signOut.mockRejectedValueOnce(rejection);
		await expect(getConfiguredAuthClient().signOut()).rejects.toBe(rejection);

		const failedResult: SignOutResult = { data: { success: false }, error: null };
		authHarness.signOut.mockResolvedValueOnce(failedResult);
		await expect(getConfiguredAuthClient().signOut()).resolves.toBe(failedResult);

		const errorResult: SignOutResult = {
			data: null,
			error: { message: "sign-out denied", status: 500, statusText: "Internal Server Error" },
		};
		authHarness.signOut.mockResolvedValueOnce(errorResult);
		await expect(getConfiguredAuthClient().signOut()).resolves.toBe(errorResult);

		expect(socket.readyState).toBe(InMemoryWebSocket.OPEN);
		expect(reloadHarness.events).toEqual([]);
		expect(reloadHarness.reloadAdminRoot).not.toHaveBeenCalled();

		const stillAuthenticatedQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"invoices:list",
		);
		const unsubscribe = client.onUpdate(stillAuthenticatedQuery, {}, () => undefined);
		await vi.waitFor(() => {
			expect(messagesFor(socket).some((message) => addsQuery(message, "invoices:list"))).toBe(true);
		});
		unsubscribe();
	});
});
