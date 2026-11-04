/** Test-only: shift `new Date()` / `Date.now()` forward ~200 days for date-independent day-plan tests. */
const OFFSET_MS = 200 * 24 * 60 * 60 * 1000;
const RealDate = Date;
class ShiftedDate extends RealDate {
  constructor(...args: [] | [number] | [number, number, number, number, number, number, number]) {
    if (args.length === 0) super(RealDate.now() + OFFSET_MS);
    else super(...(args as ConstructorParameters<typeof RealDate>));
  }
  static now(): number {
    return RealDate.now() + OFFSET_MS;
  }
}
// @ts-expect-error test hook
globalThis.Date = ShiftedDate;
