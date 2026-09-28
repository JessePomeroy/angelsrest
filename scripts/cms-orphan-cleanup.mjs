import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

// Read credentials from a protected file; never put bearer values in argv or output.
export async function run(
	config,
	args,
	fetcher = fetch,
	client = new ConvexHttpClient(config.convexUrl),
) {
	const { siteUrl, workerUrl, token, workerSecret } = config;
	if (
		typeof siteUrl !== "string" ||
		!siteUrl ||
		siteUrl.includes("/") ||
		new URL(workerUrl).protocol !== "https:"
	)
		throw new Error("Invalid cleanup configuration");
	client.setAuth(token);
	const post = async (path, body) => {
		const response = await fetcher(new URL(path, workerUrl), {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(60000),
			headers: { Authorization: `Bearer ${workerSecret}`, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!response.ok)
			throw new Error(
				`Worker request failed (${response.status}); retry the same asset after resolving the failure`,
			);
		return response.json();
	};
	if (args[0] === "delete") {
		const assetId = args[1];
		if (
			args[2] !== "--confirm" ||
			args[3] !== siteUrl ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(assetId ?? "")
		)
			throw new Error("Use delete <asset-uuid> --confirm <exact-site>");
		await client.mutation(makeFunctionReference("mediaAssets:requestOrphanDeletion"), {
			siteUrl,
			assetId,
		});
		const prefix = `sites/${siteUrl}/web/${assetId}/`;
		const result = await post("/v1/assets/delete", {
			siteUrl,
			assetId,
			orphan: true,
			privateKeys: [`${prefix}master.webp`],
			publicKeys: [
				"thumb.webp",
				"card.webp",
				"display-1280.webp",
				"display-2048.webp",
				"display-2560.webp",
			].map((name) => prefix + name),
		});
		if (result.deleted !== true || result.siteUrl !== siteUrl || result.assetId !== assetId)
			throw new Error("Invalid cleanup acknowledgement");
		return { deleted: assetId };
	}
	if (args[0] !== "inventory") throw new Error("Choose inventory or delete");
	const assetIds = new Set();
	for (const bucket of ["private", "public"]) {
		let cursor;
		const seen = new Set();
		do {
			const result = await post("/v1/assets/orphan-inventory", {
				siteUrl,
				bucket,
				...(cursor ? { cursor } : {}),
			});
			if (
				result.siteUrl !== siteUrl ||
				result.bucket !== bucket ||
				!Array.isArray(result.assetIds) ||
				!(result.cursor === null || typeof result.cursor === "string")
			)
				throw new Error("Invalid inventory response");
			for (const id of result.assetIds) assetIds.add(id);
			cursor = result.cursor;
			if (cursor && seen.has(cursor)) throw new Error("Inventory cursor repeated");
			if (cursor) seen.add(cursor);
		} while (cursor);
	}
	return {
		candidates: [...assetIds],
		note: "Storage older than 24 hours; registration is checked atomically only when deleting. No files changed.",
	};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const metadata = await stat(process.argv[2]);
		if ((metadata.mode & 0o077) !== 0)
			throw new Error("Cleanup configuration must be private (chmod 600)");
		const config = JSON.parse(await readFile(process.argv[2], "utf8"));
		console.log(JSON.stringify(await run(config, process.argv.slice(3)), null, 2));
	} catch (error) {
		// Do not include upstream bodies or config in diagnostics.
		console.error(error instanceof Error ? error.message : "Cleanup failed");
		process.exitCode = 1;
	}
}
