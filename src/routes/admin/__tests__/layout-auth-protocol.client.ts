// Keep convex-svelte real in this test. The in-memory WebSocket is the only
// transport boundary, so assertions observe Convex 1.42 protocol messages.
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

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$app/navigation", () => ({ invalidateAll: navigationHarness.invalidateAll }));
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

function getConfiguredAuthClient() {
	if (!authHarness.configuredClient) {
		throw new Error("Expected setAdminConfig to receive an auth client");
	}
	return authHarness.configuredClient;
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
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

describe("admin layout Convex auth protocol", () => {
	let activeSocket: InMemoryWebSocket | null;
	let clientMessages: ClientMessage[];
	let component: ReturnType<typeof mount> | null;
	let tokenRequestCount: number;
	let refreshResponse: ReturnType<typeof deferred<Response>>;

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
			activeSocket = this;
			queueMicrotask(() => {
				if (this.readyState !== InMemoryWebSocket.CONNECTING) return;
				this.readyState = InMemoryWebSocket.OPEN;
				this.onopen?.();
			});
		}

		send(data: unknown) {
			clientMessages.push(parseClientMessage(data));
		}

		receive(message: ServerMessage) {
			this.onmessage?.({ data: JSON.stringify(message) });
		}

		close(code = 1000, reason = "") {
			if (this.readyState === InMemoryWebSocket.CLOSED) return;
			this.readyState = InMemoryWebSocket.CLOSED;
			this.onclose?.({ code, reason });
		}
	}

	beforeEach(() => {
		activeSocket = null;
		clientMessages = [];
		component = null;
		tokenRequestCount = 0;
		refreshResponse = deferred<Response>();
		authHarness.reset();
		authHarness.signOut.mockReset();
		authHarness.unchangedMethod.mockReset();
		authHarness.configuredClient = null;
		navigationHarness.invalidateAll.mockReset();

		vi.stubGlobal("WebSocket", InMemoryWebSocket);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				tokenRequestCount += 1;
				if (tokenRequestCount === 2) return refreshResponse.promise;
				return new Response(
					JSON.stringify({ token: `header.payload.signature-${tokenRequestCount}` }),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				);
			}),
		);
	});

	afterEach(async () => {
		if (component) await unmount(component);
		await closeConvex();
		document.body.replaceChildren();
		vi.unstubAllGlobals();
	});

	it("orders auth, explicit revocation, stale refresh suppression, and confirmed login", async () => {
		const initialQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"products:list",
		);
		const signedOutQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"crm:listClients",
		);
		const loginQuery = makeFunctionReference<"query", Record<string, never>, unknown>(
			"invoices:list",
		);
		let unsubscribeInitial: (() => void) | undefined;
		let unsubscribeSignedOut: (() => void) | undefined;
		let revokeSeenAtInvalidate = false;

		const children = createRawSnippet(() => {
			unsubscribeInitial = getConvexClient().onUpdate(initialQuery, {}, () => undefined);
			return { render: () => "<div data-protected-query></div>" };
		});

		component = mount(AdminRouteLayout, {
			target: document.body,
			props: { data: authorizedData, children },
		});

		await vi.waitFor(() => {
			expect(clientMessages.some(authenticatesUser)).toBe(true);
			expect(clientMessages.some((message) => addsQuery(message, "products:list"))).toBe(true);
		});

		const firstUserIndex = clientMessages.findIndex(authenticatesUser);
		const firstQueryIndex = clientMessages.findIndex((message) =>
			addsQuery(message, "products:list"),
		);
		expect(firstUserIndex).toBeLessThan(firstQueryIndex);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		activeSocket?.receive({
			type: "Transition",
			startVersion: { querySet: 0, identity: 0, ts: "AAAAAAAAAAA=" },
			endVersion: { querySet: 1, identity: 1, ts: "AAAAAAAAAAA=" },
			modifications: [
				{
					type: "QueryUpdated",
					queryId: 0,
					value: null,
					logLines: [],
					journal: null,
				},
			],
		});
		await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

		const messageCountBeforeFailures = clientMessages.length;
		authHarness.emitSession({ data: null, isPending: false });
		await tick();
		expect(clientMessages.slice(messageCountBeforeFailures).some(revokesUser)).toBe(false);
		authHarness.emitSession({
			data: { user: { email: "creator@example.com" } },
			isPending: false,
		});

		const rejection = new Error("sign-out request failed");
		authHarness.signOut.mockRejectedValueOnce(rejection);
		await expect(getConfiguredAuthClient().signOut()).rejects.toBe(rejection);
		expect(clientMessages.slice(messageCountBeforeFailures).some(revokesUser)).toBe(false);
		expect(navigationHarness.invalidateAll).not.toHaveBeenCalled();

		const errorResult: SignOutResult = {
			data: null,
			error: { message: "sign-out denied", status: 500, statusText: "Internal Server Error" },
		};
		authHarness.signOut.mockResolvedValueOnce(errorResult);
		await expect(getConfiguredAuthClient().signOut()).resolves.toBe(errorResult);
		expect(clientMessages.slice(messageCountBeforeFailures).some(revokesUser)).toBe(false);
		expect(navigationHarness.invalidateAll).not.toHaveBeenCalled();

		navigationHarness.invalidateAll.mockImplementationOnce(async () => {
			revokeSeenAtInvalidate = clientMessages.some(revokesUser);
			unsubscribeSignedOut = getConvexClient().onUpdate(signedOutQuery, {}, () => undefined);
		});
		const signOutResult: SignOutResult = { data: { success: true }, error: null };
		const signOutArgs = { fetchOptions: { headers: { "x-test-sign-out": "true" } } };
		authHarness.signOut.mockResolvedValueOnce(signOutResult);

		expect(getConfiguredAuthClient().unchangedMethod).toBe(authHarness.unchangedMethod);
		await expect(getConfiguredAuthClient().signOut(signOutArgs)).resolves.toBe(signOutResult);
		expect(authHarness.signOut).toHaveBeenLastCalledWith(signOutArgs);
		expect(revokeSeenAtInvalidate).toBe(true);
		expect(navigationHarness.invalidateAll).toHaveBeenCalledTimes(1);

		await vi.waitFor(() => {
			expect(clientMessages.some(revokesUser)).toBe(true);
			expect(clientMessages.some((message) => addsQuery(message, "crm:listClients"))).toBe(true);
		});
		const revokeIndex = clientMessages.findIndex(revokesUser);
		const signedOutQueryIndex = clientMessages.findIndex((message) =>
			addsQuery(message, "crm:listClients"),
		);
		expect(revokeIndex).toBeLessThan(signedOutQueryIndex);

		refreshResponse.resolve(
			new Response(JSON.stringify({ token: "stale.refresh.signature" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		await tick();
		await Promise.resolve();

		authHarness.emitSession({
			data: { user: { email: "creator@example.com" } },
			isPending: false,
		});
		await tick();
		expect(clientMessages.slice(revokeIndex + 1).some(authenticatesUser)).toBe(false);

		authHarness.emitSession({ data: null, isPending: false });
		await tick();
		expect(clientMessages.slice(revokeIndex + 1).some(authenticatesUser)).toBe(false);

		authHarness.emitSession({
			data: { user: { email: "creator@example.com" } },
			isPending: false,
		});
		await vi.waitFor(() => expect(clientMessages.filter(authenticatesUser)).toHaveLength(2));
		const loginUserIndex = clientMessages.findLastIndex(authenticatesUser);
		expect(loginUserIndex).toBeGreaterThan(revokeIndex);
		expect(clientMessages[loginUserIndex]?.value).toBe("header.payload.signature-3");
		expect(tokenRequestCount).toBe(3);

		const unsubscribeLogin = getConvexClient().onUpdate(loginQuery, {}, () => undefined);
		await vi.waitFor(() => {
			expect(clientMessages.some((message) => addsQuery(message, "invoices:list"))).toBe(true);
		});
		const loginQueryIndex = clientMessages.findIndex((message) =>
			addsQuery(message, "invoices:list"),
		);
		expect(loginUserIndex).toBeLessThan(loginQueryIndex);

		unsubscribeLogin?.();
		unsubscribeSignedOut?.();
		unsubscribeInitial?.();
	});
});
