import test from "node:test";
import assert from "node:assert/strict";
import { insertEntryIntoTimeline } from "./timeline.js";

const at = (hours, minutes = 0) => Date.UTC(2026, 8, 30, hours, minutes);

test("eine nachgetragene Pause teilt eine durchgehende Bürophase", () => {
  const entries = [
    { id: "office", type: "office", start: at(8), end: at(17) },
  ];
  const pause = { id: "pause", type: "break", start: at(12), end: at(12, 30) };

  assert.deepEqual(
    insertEntryIntoTimeline(entries, pause).map(({ type, start, end }) => ({ type, start, end })),
    [
      { type: "office", start: at(8), end: at(12) },
      { type: "break", start: at(12), end: at(12, 30) },
      { type: "office", start: at(12, 30), end: at(17) },
    ],
  );
});

test("eine nachgetragene Fahrzeit ersetzt alle überlappten Abschnitte", () => {
  const entries = [
    { id: "office", type: "office", start: at(8), end: at(12) },
    { id: "customer", type: "customer", start: at(12), end: at(15) },
  ];
  const drive = { id: "drive", type: "driveActive", start: at(11, 30), end: at(12, 30) };

  assert.deepEqual(
    insertEntryIntoTimeline(entries, drive).map(({ type, start, end }) => ({ type, start, end })),
    [
      { type: "office", start: at(8), end: at(11, 30) },
      { type: "driveActive", start: at(11, 30), end: at(12, 30) },
      { type: "customer", start: at(12, 30), end: at(15) },
    ],
  );
});

test("eine verschobene bestehende Phase wird vor der Neuaufteilung entfernt", () => {
  const entries = [
    { id: "office", type: "office", start: at(8), end: at(17) },
    { id: "pause", type: "break", start: at(17), end: at(17, 30) },
  ];
  const movedPause = { ...entries[1], start: at(12), end: at(12, 30) };
  const remaining = entries.filter((entry) => entry.id !== movedPause.id);

  assert.deepEqual(
    insertEntryIntoTimeline(remaining, movedPause).map(({ type, start, end }) => ({ type, start, end })),
    [
      { type: "office", start: at(8), end: at(12) },
      { type: "break", start: at(12), end: at(12, 30) },
      { type: "office", start: at(12, 30), end: at(17) },
    ],
  );
});
