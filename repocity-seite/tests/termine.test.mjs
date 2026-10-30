// Unit tests of the free-slot list of the audit request form: `node --test tests/*.test.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupSlots } from "../site/js/termine.js";

test("slots are grouped by day in German time with weekday, date and one hour each", () => {
  const days = groupSlots(["2026-11-03T08:00:00.000Z", "2026-11-03T13:00:00.000Z", "2026-11-04T09:00:00.000Z"]);
  assert.deepEqual(days, [
    {
      key: "2026-11-03",
      label: "Dienstag, 03.11.2026",
      slots: [
        { value: "2026-11-03T08:00:00.000Z", time: "09:00–10:00 Uhr" },
        { value: "2026-11-03T13:00:00.000Z", time: "14:00–15:00 Uhr" },
      ],
    },
    { key: "2026-11-04", label: "Mittwoch, 04.11.2026", slots: [{ value: "2026-11-04T09:00:00.000Z", time: "10:00–11:00 Uhr" }] },
  ]);
});

test("summer time is shown as German time too", () => {
  const [day] = groupSlots(["2026-07-01T06:00:00Z"]);
  assert.equal(day.label, "Mittwoch, 01.07.2026");
  assert.equal(day.slots[0].time, "08:00–09:00 Uhr");
});

test("a slot late in the evening in UTC belongs to the next German day", () => {
  const [day] = groupSlots(["2026-11-03T23:00:00Z"]);
  assert.equal(day.key, "2026-11-04");
});

test("slots come out in order, without duplicates or unreadable values", () => {
  const days = groupSlots(["2026-11-04T09:00:00Z", "kaputt", "2026-11-03T08:00:00Z", "2026-11-03T08:00:00.000Z"]);
  assert.deepEqual(days.map((day) => day.key), ["2026-11-03", "2026-11-04"]);
  assert.equal(days[0].slots.length, 1);
});

test("no slots give no days", () => {
  assert.deepEqual(groupSlots([]), []);
});
