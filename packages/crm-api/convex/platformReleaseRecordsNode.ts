"use node";

import { createHash } from "node:crypto";
import { type Infer, v } from "convex/values";
import { normalizeReleaseTarget, prepareReleaseImport } from "../src/releases/import";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
	releaseImportResultValidator,
	releaseTargetValidator,
	sameReleaseTarget,
} from "./helpers/platformReleaseRecords";
import type { ReleaseSnapshot } from "./platformReleaseRecords";

/** Only authenticated deployment tooling can invoke this internal operator import. */
export const importObservation = internalAction({
	args: { target: releaseTargetValidator, evidenceJson: v.string() },
	returns: releaseImportResultValidator,
	handler: async (ctx, args): Promise<Infer<typeof releaseImportResultValidator>> => {
		const target = normalizeReleaseTarget(args.target);
		const prior: ReleaseSnapshot = await ctx.runQuery(internal.platformReleaseRecords.snapshot, {
			siteUrl: target.siteUrl,
			environmentId: target.environmentId,
		});
		if (prior.environment && !sameReleaseTarget(prior.environment.target, target))
			throw new Error(
				"Release target or verification policy changed; an explicit migration is required.",
			);
		if (
			prior.history &&
			createHash("sha256").update(prior.history.evidenceJson).digest("hex") !== prior.history.digest
		)
			throw new Error("Stored release evidence digest changed.");
		const prepared = prepareReleaseImport(
			prior.history?.evidenceJson ?? null,
			args.evidenceJson,
			target,
		);
		return await ctx.runMutation(internal.platformReleaseRecords.commit, {
			clientId: prior.client._id,
			target,
			expectedVersion: prior.environment?.version ?? null,
			...prepared,
		});
	},
});
