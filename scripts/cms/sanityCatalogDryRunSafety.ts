import { dirname, resolve } from "node:path";

export function resolveCatalogDryRunOutputPath(value: string) {
	if (!value) throw new Error("--output requires a path");
	const path = resolve(value);
	if (dirname(path) !== "/tmp") {
		throw new Error("Catalog dry-run reports must be direct children of /tmp");
	}
	return path;
}
