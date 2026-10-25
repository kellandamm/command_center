import assert from "node:assert/strict";
import { eventPayloadFromItem, localMinuteToIso, normalizeQuickAddItem, taskDueForTodoist } from "../src/quick-add/normalize";

const item = normalizeQuickAddItem({
  kind: "event",
  title: "Call mom",
  start: "2026-10-26T15:00",
  end: "2026-10-26T16:00",
});
assert.equal(item.start, "2026-10-26T15:00");
const payload = eventPayloadFromItem(item, "cal", "America/Chicago");
assert.equal(payload.localStart, "2026-10-26T15:00");
assert.equal(localMinuteToIso("2026-10-26T15:00", "America/Chicago"), "2026-10-26T20:00:00.000Z");
assert.equal(localMinuteToIso("2026-11-01T15:00", "America/Chicago"), "2026-11-01T21:00:00.000Z");
assert.equal(taskDueForTodoist("2026-10-26T15:00").dueDatetime, "2026-10-26T20:00:00.000Z");
