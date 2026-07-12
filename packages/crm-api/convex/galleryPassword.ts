"use node";

import { randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";

const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

async function derivePassword(
	password: string,
	salt: string,
	params = { cost: COST, blockSize: BLOCK_SIZE, parallelization: PARALLELIZATION, keyLength: KEY_LENGTH },
) {
	return await new Promise<Buffer>((resolve, reject) => {
		nodeScrypt(
			password,
			Buffer.from(salt, "base64url"),
			params.keyLength,
			{
				N: params.cost,
				r: params.blockSize,
				p: params.parallelization,
				maxmem: MAX_MEMORY,
			},
			(error, derivedKey) => {
				if (error) reject(error);
				else resolve(derivedKey);
			},
		);
	});
}

export const setPassword = action({
	args: {
		galleryId: v.id("galleries"),
		siteUrl: v.string(),
		password: v.union(v.string(), v.null()),
	},
	handler: async (ctx, { galleryId, siteUrl, password }): Promise<{ passwordProtected: boolean }> => {
		if (password !== null && (password.length < 8 || password.length > 128)) {
			throw new ConvexError("Gallery passwords must be between 8 and 128 characters.");
		}
		if (password === null) {
			return await ctx.runMutation(internal.galleryPasswordStore.setVerifier, {
				galleryId,
				siteUrl,
				verifier: null,
			});
		}

		const salt = randomBytes(16).toString("base64url");
		const hash = (await derivePassword(password, salt)).toString("base64url");
		return await ctx.runMutation(internal.galleryPasswordStore.setVerifier, {
			galleryId,
			siteUrl,
			verifier: {
				algorithm: "scrypt",
				salt,
				hash,
				cost: COST,
				blockSize: BLOCK_SIZE,
				parallelization: PARALLELIZATION,
				keyLength: KEY_LENGTH,
				version: randomUUID(),
			},
		});
	},
});

type Challenge = {
	token: { _id: Id<"portalTokens"> };
	verifier: null | {
		salt: string;
		hash: string;
		cost: number;
		blockSize: number;
		parallelization: number;
		keyLength: number;
		version: string;
	};
	attempts: null | { lockedUntil?: number };
};

export const verifyPassword = action({
	args: { token: v.string(), password: v.string() },
	handler: async (ctx, { token, password }): Promise<{ accessGrant: string; expiresAt: number }> => {
		if (password.length < 1 || password.length > 128) {
			throw new ConvexError("Invalid gallery link or password.");
		}
		const challenge = await ctx.runQuery(internal.galleryPasswordStore.getChallenge, { token }) as Challenge | null;
		if (!challenge?.verifier) throw new ConvexError("Invalid gallery link or password.");
		if (challenge.attempts?.lockedUntil && challenge.attempts.lockedUntil > Date.now()) {
			throw new ConvexError("Too many attempts. Please wait 15 minutes and try again.");
		}

		const candidate = await derivePassword(password, challenge.verifier.salt, challenge.verifier);
		const expected = Buffer.from(challenge.verifier.hash, "base64url");
		if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
			await ctx.runMutation(internal.galleryPasswordStore.recordFailure, {
				portalTokenId: challenge.token._id,
			});
			throw new ConvexError("Invalid gallery link or password.");
		}

		return await ctx.runMutation(internal.galleryPasswordStore.createGrant, {
			token,
			grant: randomUUID(),
			verifierVersion: challenge.verifier.version,
		});
	},
});
