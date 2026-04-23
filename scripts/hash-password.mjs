#!/usr/bin/env node
/**
 * Compute a Better Auth–compatible scrypt hash of a password, using the same
 * parameters as `better-auth/crypto/password`:
 *   N=16384, r=16, p=1, dkLen=64, 16-byte random salt (hex-encoded).
 * Output format: `<saltHex>:<keyHex>` — the exact string Better Auth stores
 * in `account.password` for credential accounts.
 *
 * Use with the dev-only Convex mutation in this repo:
 *   node scripts/hash-password.mjs mypassword
 *   # → <saltHex>:<keyHex>
 *   npx convex run devPasswordReset:setCredentialPasswordHash \
 *     '{"userId":"<bauth user _id>","newHash":"<paste>"}'
 *
 * Uses Node's built-in `node:crypto` so no extra deps are needed.
 */

import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

const password = process.argv[2];
if (!password) {
	console.error("usage: node scripts/hash-password.mjs <password>");
	process.exit(1);
}

const SCRYPT_N = 16384;
const SCRYPT_R = 16;
const SCRYPT_P = 1;
const DK_LEN = 64;

const salt = randomBytes(16).toString("hex");
const key = await scrypt(password.normalize("NFKC"), salt, DK_LEN, {
	N: SCRYPT_N,
	r: SCRYPT_R,
	p: SCRYPT_P,
	maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
});
console.log(`${salt}:${key.toString("hex")}`);
