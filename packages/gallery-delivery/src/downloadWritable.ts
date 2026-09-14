export type FileSystemWritableFileStreamLike = {
	write: (data: Blob | BufferSource | string) => Promise<void>;
	close: () => Promise<void>;
	abort?: (reason?: unknown) => Promise<void>;
};

export function abortReason(signal?: AbortSignal, message = "Gallery ZIP download canceled.") {
	return signal?.reason ?? new DOMException(message, "AbortError");
}

export function throwIfAborted(signal?: AbortSignal, message?: string) {
	if (signal?.aborted) throw abortReason(signal, message);
}

export async function raceWithAbort<T>(
	operation: Promise<T>,
	signal: AbortSignal | undefined,
	onAbort?: () => Promise<void> | void,
	message?: string,
) {
	if (!signal) return operation;
	throwIfAborted(signal, message);

	let abortHandler: (() => void) | undefined;
	const abort = new Promise<never>((_, reject) => {
		abortHandler = () => {
			void Promise.resolve(onAbort?.())
				.catch(() => {
					// Preserve cancellation when best-effort cleanup fails.
				})
				.then(() => reject(abortReason(signal, message)));
		};
		signal.addEventListener("abort", abortHandler, { once: true });
	});

	try {
		return await Promise.race([operation, abort]);
	} finally {
		if (abortHandler) signal.removeEventListener("abort", abortHandler);
	}
}

/** Owns a chosen file until it is closed successfully or aborted once. */
export async function withGalleryWritable(
	writable: FileSystemWritableFileStreamLike,
	signal: AbortSignal | undefined,
	consume: (writer: {
		write: FileSystemWritableFileStreamLike["write"];
		abort: () => Promise<void>;
	}) => Promise<void>,
	cancellationMessage?: string,
) {
	let closed = false;
	let aborted = false;
	const abort = async (reason: unknown = abortReason(signal, cancellationMessage)) => {
		if (closed || aborted) return;
		aborted = true;
		await writable.abort?.(reason);
	};
	const abortOnCancellation = () => abort();

	try {
		await consume({
			write: (data) =>
				raceWithAbort(writable.write(data), signal, abortOnCancellation, cancellationMessage),
			abort: abortOnCancellation,
		});
		throwIfAborted(signal, cancellationMessage);
		await raceWithAbort(writable.close(), signal, abortOnCancellation, cancellationMessage);
		closed = true;
	} catch (error) {
		const reason = signal?.aborted ? abortReason(signal, cancellationMessage) : error;
		await abort(reason).catch(() => {
			// Preserve the original download/write failure or cancellation reason.
		});
		throw reason;
	}
}
