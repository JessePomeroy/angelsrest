import { getFunctionName } from "convex/server";
import * as data from "./data";

type Ref = Parameters<typeof getFunctionName>[0];
type Args = Record<string, unknown> | "skip";
const params = new URLSearchParams(window.location.search);
const empty = params.get("state") === "empty";
const loading = params.get("state") === "loading";
const detail =
	/\/admin\/editor\/(products|blog)\/.+/.test(params.get("route") ?? "") ||
	params.get("state") === "populated";
const list = <T>(items: T[]) => (empty ? [] : items);
const pageOf = <T>(items: T[]) => ({ page: list(items), isDone: true, continueCursor: "" });
function fixtureQuery(name: string, args: Args = {}) {
	if (args === "skip") return undefined;
	switch (name) {
		case "orders:list":
			return list(data.orders);
		case "orders:getStats":
			return {
				stats: { totalOrders: empty ? 0 : 3, isTruncated: false, scanLimit: 100 },
				grossPayments: [
					{
						currency: "usd",
						orderCount: empty ? 0 : 3,
						todayMinorUnits: empty ? 0 : 4500,
						weekMinorUnits: empty ? 0 : 20000,
						monthMinorUnits: empty ? 0 : 20000,
						allTimeMinorUnits: empty ? 0 : 20000,
					},
				],
				dailyGrossPayments: list(
					[4500, 9000, 6500].map((amountMinorUnits, index) => ({
						date: `2026-09-0${index + 7}`,
						currency: "usd",
						amountMinorUnits,
					})),
				),
				recentOrders: list(
					data.orders.map((order) => ({
						...order,
						createdAt: new Date(order._creationTime).toISOString(),
					})),
				),
			};
		case "crm:listClients":
			return list(data.clients);
		case "crm:listClientsWithTags":
			return pageOf(
				data.clients.filter(
					(client) =>
						(!args.category || client.category === args.category) &&
						(!args.status || client.status === args.status),
				),
			);
		case "crm:getStats":
			return {
				total: empty ? 0 : 3,
				leads: empty ? 0 : 1,
				booked: empty ? 0 : 1,
				inProgress: empty ? 0 : 1,
				completed: 0,
				photography: empty ? 0 : 2,
				web: empty ? 0 : 1,
			};
		case "invoices:list":
			return list(data.invoices);
		case "quotes:list":
			return list(data.quotes);
		case "contracts:list":
			return list(data.contracts);
		case "invoices:getNextNumber":
			return "INV-DEMO-004";
		case "quotes:getNextNumber":
			return "QUO-DEMO-004";
		case "emailTemplates:list":
			return list(data.emailTemplates);
		case "contracts:listTemplates":
			return list([
				{
					_id: "demo-template-1",
					name: "Portrait agreement",
					body: "Demonstration agreement only.",
					variables: [],
				},
			]);
		case "quotes:listPresets":
			return [];
		case "tags:listTags":
			return [];
		case "tags:getClientTags":
			return [];
		case "activityLog:getClientActivity":
			return [];
		case "platform:listAll":
			return list(data.platformClients);
		case "messages:allThreadsPaginated":
			return pageOf([
				{ client: data.platformClients[0], unreadCount: 0, latestMessage: data.messages[0] },
			]);
		case "messages:listPaginated":
			return pageOf(data.messages);
		case "kanban:listBoardConfigs":
			return list([
				{
					_id: "demo-board-1",
					_creationTime: data.now,
					siteUrl: data.siteUrl,
					projectType: "wedding",
					columns: [
						{ id: "lead", name: "New inquiry", position: 0 },
						{ id: "booked", name: "Booked", position: 1 },
						{ id: "complete", name: "Delivered", position: 2 },
					],
				},
			]);
		case "galleries:listBySite":
			return list(data.galleries);
		case "galleries:getImages":
			return [];
		case "portfolioGalleries:listForEditor":
			return list(data.portfolio);
		case "portfolioGalleries:getEditorState":
			return data.portfolio.find((gallery) => gallery.galleryId === args.galleryId) ?? null;
		case "mediaAssets:listForEditor":
			return pageOf(data.mediaAssets);
		case "mediaAssets:getManyForEditor":
			return data.mediaAssets;
		case "catalogProducts:listForEditor":
		case "catalogProductGraphs:listForEditor":
			return detail
				? list(
						data.productSummaries.filter(
							(product) => !args.productKind || product.productKind === args.productKind,
						),
					)
				: [];
		case "catalogProducts:getEditorState":
		case "catalogProductGraphs:getEditorState":
			return data.product;
		case "postContent:listForEditor":
			return detail ? list(data.postSummaries) : [];
		case "postContent:getEditorState":
			return data.post;
		case "blogContent:listForEditor":
			return detail
				? list(
						data.supportingSummaries.filter(
							(document) => !args.kind || document.kind === args.kind,
						),
					)
				: [];
		case "blogContent:getEditorState":
			return (
				data.supportingDocuments.find((document) => document.documentId === args.documentId) ?? null
			);
		case "content:getSiteSettingsEditorState":
			return data.editorState(data.settingsPayload);
		case "content:getContactPageEditorState":
			return data.editorState(data.contactPayload);
		case "content:getAboutPageEditorState":
			return data.editorState(data.aboutPayload);
		default:
			throw new Error(`No synthetic handbook query fixture for ${name}`);
	}
}
export function useQuery(ref: Ref, args: Args | (() => Args) = {}) {
	const failed = params.get("state") === "error";
	const result = $derived(
		loading || failed
			? undefined
			: fixtureQuery(getFunctionName(ref), typeof args === "function" ? args() : args),
	);
	return {
		get data() {
			return result;
		},
		get isLoading() {
			return loading;
		},
		error: failed ? new Error("Simulated read failure") : undefined,
	};
}
export function usePaginatedQuery(ref: Ref, args: Args | (() => Args) = {}) {
	const result = $derived(
		fixtureQuery(getFunctionName(ref), typeof args === "function" ? args() : args),
	);
	return {
		get results() {
			return result && typeof result === "object" && "page" in result ? result.page : [];
		},
		get status() {
			return loading ? "LoadingFirstPage" : "Exhausted";
		},
		isLoading: loading,
		loadMore() {},
	};
}
export function useConvexClient() {
	return {
		async query(ref: Ref, args: Args) {
			if (params.get("state") === "error") throw new Error("Simulated read failure");
			return fixtureQuery(getFunctionName(ref), args);
		},
		async mutation() {
			throw new Error("Simulated save failure: provider writes are disabled in handbook fixtures.");
		},
		async action() {
			throw new Error("Provider actions are disabled in handbook fixtures.");
		},
	};
}

// Auth presentation only: never create a WebSocket or mint a token.
export function setupConvex() {}
export function setupAuth() {}
export async function closeConvex() {}
export function useAuth() {
	return {
		isLoading: params.get("session") === "loading",
		isAuthenticated: params.get("session") !== "expired",
	};
}
