import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

export function assertRepositoryRoot(root, repository) {
	const readGit = (args) =>
		execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 5000,
		}).trim();
	if (realpathSync(root) !== realpathSync(readGit(["rev-parse", "--show-toplevel"]))) {
		throw new Error("Run from the repository root.");
	}
	if (
		![
			`https://github.com/${repository}`,
			`https://github.com/${repository}.git`,
			`git@github.com:${repository}.git`,
		].includes(readGit(["remote", "get-url", "origin"]))
	) {
		throw new Error("History repository does not match the requested target.");
	}
}
