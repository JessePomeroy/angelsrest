import { type Infer, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireCreator } from "./authHelpers";
import {
	MAX_RELEASE_ENVIRONMENTS,
	MAX_RELEASE_HISTORY_BYTES,
	releaseImportResultValidator,
	releaseSummaryValidator,
	releaseTargetValidator,
	sameReleaseTarget,
} from "./helpers/platformReleaseRecords";

export const forSite = query({
	args: { siteUrl: v.string() },
	returns: v.object({
		siteUrl: v.string(),
		environments: v.array(
			v.object({ target: releaseTargetValidator, summary: releaseSummaryValidator }),
		),
	}),
	handler: async (ctx, { siteUrl }) => {
		await requireCreator(ctx);
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!client) return { siteUrl, environments: [] };
		const rows = await ctx.db
			.query("platformReleaseEnvironments")
			.withIndex("by_clientId_and_environmentId", (q) => q.eq("clientId", client._id))
			.take(MAX_RELEASE_ENVIRONMENTS + 1);
		if (rows.length > MAX_RELEASE_ENVIRONMENTS)
			throw new Error("Release environments require an operator review.");
		if (
			rows.some(
				(row) => row.target.siteUrl !== siteUrl || row.target.environmentId !== row.environmentId,
			)
		)
			throw new Error("Release target ownership changed; an explicit migration is required.");
		return { siteUrl, environments: rows.map(({ target, summary }) => ({ target, summary })) };
	},
});

export type ReleaseSnapshot = {
	client: Pick<Doc<"platformClients">, "_id" | "siteUrl">;
	environment: Doc<"platformReleaseEnvironments"> | null;
	history: Doc<"platformReleaseHistory"> | null;
};

export const snapshot = internalQuery({
	args: { siteUrl: v.string(), environmentId: v.string() },
	handler: async (ctx, { siteUrl, environmentId }): Promise<ReleaseSnapshot> => {
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!client) throw new Error("Release target must belong to an existing platform client.");
		const environment = await ctx.db
			.query("platformReleaseEnvironments")
			.withIndex("by_clientId_and_environmentId", (q) =>
				q.eq("clientId", client._id).eq("environmentId", environmentId),
			)
			.unique();
		const history = environment
			? await ctx.db
					.query("platformReleaseHistory")
					.withIndex("by_releaseEnvironmentId", (q) =>
						q.eq("releaseEnvironmentId", environment._id),
					)
					.unique()
			: null;
		if (environment && !history) throw new Error("Stored release evidence is incomplete.");
		return { client: { _id: client._id, siteUrl: client.siteUrl }, environment, history };
	},
});

export const commit = internalMutation({
	args: {
		clientId: v.id("platformClients"),
		target: releaseTargetValidator,
		expectedVersion: v.union(v.number(), v.null()),
		evidenceJson: v.string(),
		digest: v.string(),
		summary: releaseSummaryValidator,
	},
	returns: releaseImportResultValidator,
	handler: async (ctx, args): Promise<Infer<typeof releaseImportResultValidator>> => {
		const client = await ctx.db.get(args.clientId);
		if (!client || client.siteUrl !== args.target.siteUrl)
			throw new Error("Release target ownership changed.");
		if (
			new TextEncoder().encode(args.evidenceJson).length > MAX_RELEASE_HISTORY_BYTES ||
			!/^[a-f0-9]{64}$/.test(args.digest)
		)
			throw new Error("Invalid bounded release evidence.");
		const environment = await ctx.db
			.query("platformReleaseEnvironments")
			.withIndex("by_clientId_and_environmentId", (q) =>
				q.eq("clientId", client._id).eq("environmentId", args.target.environmentId),
			)
			.unique();
		if ((environment?.version ?? null) !== args.expectedVersion)
			throw new Error("Release history changed; retry the same observation.");
		if (environment && !sameReleaseTarget(environment.target, args.target))
			throw new Error(
				"Release target or verification policy changed; an explicit migration is required.",
			);
		const history = environment
			? await ctx.db
					.query("platformReleaseHistory")
					.withIndex("by_releaseEnvironmentId", (q) =>
						q.eq("releaseEnvironmentId", environment._id),
					)
					.unique()
			: null;
		if (environment && !history) throw new Error("Stored release evidence is incomplete.");
		if (history?.evidenceJson === args.evidenceJson)
			return { changed: false, version: environment?.version ?? 0 };
		if (!environment) {
			const siblings = await ctx.db
				.query("platformReleaseEnvironments")
				.withIndex("by_clientId_and_environmentId", (q) => q.eq("clientId", client._id))
				.take(MAX_RELEASE_ENVIRONMENTS);
			if (siblings.length === MAX_RELEASE_ENVIRONMENTS)
				throw new Error("Release environments require an explicit retention review.");
			const id = await ctx.db.insert("platformReleaseEnvironments", {
				clientId: client._id,
				environmentId: args.target.environmentId,
				target: args.target,
				version: 1,
				summary: args.summary,
			});
			await ctx.db.insert("platformReleaseHistory", {
				releaseEnvironmentId: id,
				evidenceJson: args.evidenceJson,
				digest: args.digest,
			});
			return { changed: true, version: 1 };
		}
		if (!history) throw new Error("Stored release evidence is incomplete.");
		const version = environment.version + 1;
		await ctx.db.patch(environment._id, { version, summary: args.summary });
		await ctx.db.patch(history._id, { evidenceJson: args.evidenceJson, digest: args.digest });
		return { changed: true, version };
	},
});
