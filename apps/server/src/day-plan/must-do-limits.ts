/** Shared must-do action state (in-flight lock; test delay via guarded test-support only). */
export const inflight = new Set<string>();

export const testHooks = {
  boardMoveDelayMs: null as number | null,
};
