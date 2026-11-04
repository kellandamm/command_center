/** Test-only: run with `Date.now()` / `new Date()` shifted forward by N whole days. */
export async function withClockShiftedByDays(days: number, run: () => void | Promise<void>): Promise<void> {
  const RealDate = Date;
  const offsetMs = days * 86_400_000;
  const Shifted = function (this: Date, ...args: [] | [number] | [number, number, number, number, number, number, number]) {
    if (args.length === 0) return new RealDate(RealDate.now() + offsetMs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (RealDate as any)(...args);
  } as unknown as DateConstructor;
  Shifted.now = () => RealDate.now() + offsetMs;
  Shifted.parse = RealDate.parse;
  Shifted.UTC = RealDate.UTC;
  globalThis.Date = Shifted;
  try {
    await run();
  } finally {
    globalThis.Date = RealDate;
  }
}
