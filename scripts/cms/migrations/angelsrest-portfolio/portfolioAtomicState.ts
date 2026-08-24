import { randomUUID } from "node:crypto";
import { link, open, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

async function syncDirectory(path: string) {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** Publish one complete owner-only file atomically without replacing an existing result. */
export async function atomicPublishPrivateExclusive(path: string, contents: string | Uint8Array) {
	const parent = dirname(path);
	const temporary = resolve(parent, `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`);
	try {
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(contents);
			await handle.sync();
		} finally {
			await handle.close();
		}
		// A same-directory hard link is an atomic no-replace publication of the synced inode.
		await link(temporary, path);
		await syncDirectory(parent);
	} finally {
		await rm(temporary, { force: true });
		await syncDirectory(parent);
	}
}
