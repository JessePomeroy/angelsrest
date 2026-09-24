import { randomInt } from "node:crypto";
import { hashPassword } from "better-auth/crypto";

const GROUPS = [
	"abcdefghijklmnopqrstuvwxyz",
	"ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	"0123456789",
	"!@#$%&*+-=?_",
] as const;
const ALPHABET = GROUPS.join("");

/** Rejection sampling keeps every valid 24-character password equally likely. */
export async function createTemporaryPassword() {
	let password: string;
	do {
		password = Array.from({ length: 24 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
	} while (!GROUPS.every((group) => [...password].some((character) => group.includes(character))));
	return { password, passwordHash: await hashPassword(password) };
}
