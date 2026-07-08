import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const env = { ...process.env };

// Playwright forces color in some child processes. If this shell also exports
// NO_COLOR, Node warns before every local web-server/e2e run.
delete env.NO_COLOR;

const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const signalExitCodes = {
	SIGHUP: 129,
	SIGINT: 130,
	SIGTERM: 143,
};
let forwardedSignal;
let fallbackExit;

const child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
	env,
	stdio: "inherit",
});

child.on("error", (error) => {
	console.error(error);
	process.exit(1);
});

for (const signal of Object.keys(signalExitCodes)) {
	process.on(signal, () => {
		forwardedSignal = signal;
		child.kill(signal);
		fallbackExit = setTimeout(() => {
			process.exit(signalExitCodes[signal]);
		}, 5000);
		fallbackExit.unref();
	});
}

child.on("exit", (code, signal) => {
	if (fallbackExit) {
		clearTimeout(fallbackExit);
	}

	if (signal) {
		process.exit(signalExitCodes[signal] ?? 1);
		return;
	}

	if (forwardedSignal) {
		process.exit(signalExitCodes[forwardedSignal]);
		return;
	}

	process.exit(code ?? 1);
});
