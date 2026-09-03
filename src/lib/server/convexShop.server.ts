import { error } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import {
	adaptConvexIndex,
	adaptConvexPrintSet,
	adaptConvexProduct,
	assertConvexPublishedDetailSlug,
} from "$lib/server/convexShopAdapter";
import { getConvexUrl } from "$lib/server/runtimeConfig";
import type { PrintCollection, PrintSet, Product } from "$lib/types/shop";

type PublishedCatalog = FunctionReturnType<typeof api.catalogProductGraphs.listPublished>;
type PublishedProduct = FunctionReturnType<typeof api.catalogProductGraphs.getPublishedBySlug>;
const SHOP_READ_DEADLINE_MS = 6_000;

export interface ConvexShopReader {
	listPublished(signal: AbortSignal): Promise<PublishedCatalog>;
	getPublishedBySlug(slug: string, signal: AbortSignal): Promise<PublishedProduct>;
}

type ConvexShopDependencies = {
	createReader?: () => ConvexShopReader;
	deadlineMs?: number;
	createTimeoutSignal?: (deadlineMs: number) => AbortSignal;
};

interface RetiredPrintCollectionPage {
	collection: PrintCollection;
	subCollections: PrintCollection[];
	printSets: PrintSet[];
	products: Product[];
}

function createConvexShopReader(): ConvexShopReader {
	const request = (signal: AbortSignal) =>
		new ConvexHttpClient(getConvexUrl(), {
			logger: false,
			fetch: (input, init) => fetch(input, { ...init, signal }),
		});
	return {
		listPublished: (signal) =>
			request(signal).query(api.catalogProductGraphs.listPublished, {
				siteUrl: SITE_DOMAIN,
			}),
		getPublishedBySlug: (slug, signal) =>
			request(signal).query(api.catalogProductGraphs.getPublishedBySlug, {
				siteUrl: SITE_DOMAIN,
				slug,
			}),
	};
}

function unavailable(): never {
	throw error(503, "Shop catalog is unavailable");
}

function notFound(message: string): never {
	throw error(404, message);
}

function boundedRead<T>(signal: AbortSignal, read: (signal: AbortSignal) => Promise<T>) {
	return new Promise<T>((resolve, reject) => {
		const rejectAborted = () =>
			reject(
				signal.reason instanceof Error
					? signal.reason
					: new Error("Shop catalog read deadline exceeded"),
			);
		if (signal.aborted) {
			rejectAborted();
			return;
		}
		signal.addEventListener("abort", rejectAborted, { once: true });
		Promise.resolve()
			.then(() => read(signal))
			.then(resolve, reject)
			.finally(() => signal.removeEventListener("abort", rejectAborted));
	});
}

function readWithDeadline<T>(
	dependencies: ConvexShopDependencies,
	read: (signal: AbortSignal) => Promise<T>,
) {
	const deadlineMs = dependencies.deadlineMs ?? SHOP_READ_DEADLINE_MS;
	const signal = (dependencies.createTimeoutSignal ?? ((ms) => AbortSignal.timeout(ms)))(
		deadlineMs,
	);
	return boundedRead(signal, read);
}

export function createConvexShop(dependencies: ConvexShopDependencies = {}) {
	const reader = dependencies.createReader ?? createConvexShopReader;

	const readProduct = (slug: string) =>
		readWithDeadline(dependencies, (signal) => reader().getPublishedBySlug(slug, signal));

	return {
		async loadIndex() {
			try {
				return {
					...adaptConvexIndex(
						await readWithDeadline(dependencies, (signal) => reader().listPublished(signal)),
					),
					collections: [],
				};
			} catch {
				unavailable();
			}
		},
		async loadProduct(slug: string) {
			try {
				const published = await readProduct(slug);
				assertConvexPublishedDetailSlug(published, slug);
				const product = adaptConvexProduct(published);
				if (product) return product;
			} catch {
				unavailable();
			}
			notFound("Product not found");
		},
		async loadPrintSet(slug: string) {
			try {
				const published = await readProduct(slug);
				assertConvexPublishedDetailSlug(published, slug);
				const printSet = adaptConvexPrintSet(published);
				if (printSet) return printSet;
			} catch {
				unavailable();
			}
			notFound("Print set not found");
		},
		async loadCollection(_slug: string): Promise<RetiredPrintCollectionPage> {
			notFound("Print collection not found");
		},
	};
}

export async function readConvexShopRuntimeSentinel(dependencies: ConvexShopDependencies = {}) {
	const reader = dependencies.createReader ?? createConvexShopReader;
	const published = await readWithDeadline(dependencies, (signal) =>
		reader().listPublished(signal),
	);
	const index = adaptConvexIndex(published);
	return {
		outcome: "healthy" as const,
		publishedProductCount: published.length,
		productIndexCount: index.products.length,
		printSetIndexCount: index.printSets.length,
		collectionIndexCount: 0,
	};
}

export const convexShop = createConvexShop();
