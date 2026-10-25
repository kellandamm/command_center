const chains = new Map<string, Promise<unknown>>();

/** Serialize meeting imports per normalized Plaud sourceId (single server process only). */
export async function withMeetingImportLock<T>(sourceId: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(sourceId) ?? Promise.resolve();
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => slot);
  chains.set(sourceId, chained);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(sourceId) === chained) chains.delete(sourceId);
  }
}
