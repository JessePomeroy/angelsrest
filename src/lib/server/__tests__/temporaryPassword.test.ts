import { verifyPassword } from "better-auth/crypto";
import { expect, it } from "vitest";
import { createTemporaryPassword } from "../temporaryPassword";

it("creates distinct 24-character passwords with all four character classes and compatible hashes", async () => {
	const first = await createTemporaryPassword();
	const second = await createTemporaryPassword();
	for (const { password, passwordHash } of [first, second]) {
		expect(password).toHaveLength(24);
		expect(password).toMatch(/[a-z]/);
		expect(password).toMatch(/[A-Z]/);
		expect(password).toMatch(/[0-9]/);
		expect(password).toMatch(/[!@#$%&*+\-=?_]/);
		expect(await verifyPassword({ hash: passwordHash, password })).toBe(true);
	}
	expect(first.password).not.toBe(second.password);
});
