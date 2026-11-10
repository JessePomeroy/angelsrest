import { describe, expect, it, vi } from "vitest";
import { CatalogBoundaryError } from "$lib/server/catalogCommerceClients";
import {
	type CurrentCheckoutCommerceDependencies,
	CurrentCheckoutCommerceError,
	resolveCurrentCheckoutCommerce,
} from "$lib/server/current/currentCheckoutCommerce.server";

const selections = [{ productId: "current-product" }];
const published = {
	schemaVersion: 2,
	slug: "current-product",
	productId: "private-product",
	revisionId: "private-revision",
	productKind: "merchandise",
	variants: [{ key: "variant", materialOption: null, sizeOption: null }],
};

function boundaries() {
	return {
		query: vi
			.fn<NonNullable<CurrentCheckoutCommerceDependencies["query"]>>()
			.mockResolvedValue(published),
		resolve: vi
			.fn<NonNullable<CurrentCheckoutCommerceDependencies["resolve"]>>()
			.mockResolvedValue(null),
	};
}

describe("current checkout authority failures", () => {
	it("classifies query failure without continuing to the resolver", async () => {
		const dependencies = boundaries();
		dependencies.query.mockRejectedValue(new Error("Private backend details"));
		await expect(resolveCurrentCheckoutCommerce(selections, dependencies)).rejects.toMatchObject({
			name: "CurrentCheckoutCommerceError",
			kind: "unavailable",
			phase: "query",
			message: "Checkout is temporarily unavailable. Please try again.",
		});
		expect(dependencies.resolve).not.toHaveBeenCalled();
	});

	it.each([
		[null, "selection_changed", "query"],
		[{}, "invalid_authority", "graph"],
		[{ ...published, slug: "different-product" }, "invalid_authority", "graph"],
	] as const)("classifies unavailable or invalid published authority %j", async (value, kind, phase) => {
		const dependencies = boundaries();
		dependencies.query.mockResolvedValue(value);
		await expect(resolveCurrentCheckoutCommerce(selections, dependencies)).rejects.toMatchObject({
			kind,
			phase,
		});
		expect(dependencies.resolve).not.toHaveBeenCalled();
	});

	it("classifies an unexpected resolver failure without exposing its details", async () => {
		const dependencies = boundaries();
		dependencies.resolve.mockRejectedValue(new Error("Private resolver details"));
		await expect(resolveCurrentCheckoutCommerce(selections, dependencies)).rejects.toMatchObject({
			kind: "unavailable",
			phase: "resolver",
			message: "Checkout is temporarily unavailable. Please try again.",
		});
	});

	it.each([
		["unavailable", "stream", "unavailable"],
		["rejected", "status", "selection_changed"],
		["rejected", "json", "invalid_authority"],
		["refunded", "status", "invalid_authority"],
	] as const)("preserves catalog %s/%s classification", async (sourceKind, phase, kind) => {
		const dependencies = boundaries();
		dependencies.resolve.mockRejectedValue(new CatalogBoundaryError(sourceKind, phase));
		await expect(resolveCurrentCheckoutCommerce(selections, dependencies)).rejects.toMatchObject({
			kind,
			phase,
		});
	});

	it("rejects malformed resolved authority", async () => {
		const dependencies = boundaries();
		await expect(resolveCurrentCheckoutCommerce(selections, dependencies)).rejects.toMatchObject({
			kind: "invalid_authority",
			phase: "authority",
			message: "Checkout failed. Please try again.",
		});
		expect(dependencies.resolve).toHaveBeenCalledOnce();
	});

	it.each([
		"query",
		"resolve",
	] as const)("preserves an already classified %s failure", async (boundary) => {
		const dependencies = boundaries();
		const failure = new CurrentCheckoutCommerceError("selection_changed", "graph");
		dependencies[boundary].mockRejectedValue(failure);
		await expect(resolveCurrentCheckoutCommerce(selections, dependencies)).rejects.toBe(failure);
	});

	it("denies an already aborted checkout without starting backend work", async () => {
		const dependencies = boundaries();
		const controller = new AbortController();
		controller.abort();
		await expect(
			resolveCurrentCheckoutCommerce(selections, { ...dependencies, signal: controller.signal }),
		).rejects.toMatchObject({ kind: "unavailable", phase: "query" });
		expect(dependencies.query).not.toHaveBeenCalled();
		expect(dependencies.resolve).not.toHaveBeenCalled();
	});

	it.each([
		"query",
		"resolve",
	] as const)("bounds a pending %s even if the backend ignores abort", async (boundary) => {
		const dependencies = boundaries();
		const controller = new AbortController();
		const entered = Promise.withResolvers<void>();
		dependencies[boundary].mockImplementation(() => {
			entered.resolve();
			return new Promise<never>(() => {});
		});
		const pending = resolveCurrentCheckoutCommerce(selections, {
			...dependencies,
			signal: controller.signal,
		});
		const rejected = expect(pending).rejects.toMatchObject({
			kind: "unavailable",
			phase: boundary === "query" ? "query" : "resolver",
		});
		await entered.promise;
		controller.abort();
		await rejected;
		expect(dependencies[boundary].mock.calls[0][1]).toBe(controller.signal);
	});
});
