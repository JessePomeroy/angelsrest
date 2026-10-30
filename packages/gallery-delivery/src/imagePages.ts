export type GalleryImagePage<T> = { page: T[]; isDone: boolean; continueCursor: string };

/** Follow every bounded page; never silently return a partial download manifest. */
export async function* iterateGalleryImagePages<Page extends GalleryImagePage<unknown>>(read: (cursor: string | null) => Promise<Page>, signal?: AbortSignal) {
 let cursor: string | null = null;
 const visited = new Set<string>();
 for (;;) {
  signal?.throwIfAborted();
  const result = await read(cursor);
  signal?.throwIfAborted();
  yield result;
  if (result.isDone) return;
  if (!result.continueCursor || visited.has(result.continueCursor)) throw new Error("Gallery cursor did not advance");
  visited.add(result.continueCursor);
  cursor = result.continueCursor;
 }
}

export function mergeGalleryImagePages<T>(current: readonly T[], added: readonly T[], id: (image: T) => string): T[] {
 const rows = new Map(current.map(image => [id(image), image]));
 for (const image of added) rows.set(id(image), image);
 return [...rows.values()];
}
