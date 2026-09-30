export function uid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function mergeAdjacentEntries(entries) {
  return [...entries]
    .sort((a, b) => a.start - b.start)
    .reduce((merged, entry) => {
      const previous = merged.at(-1);
      if (previous && previous.type === entry.type && previous.end === entry.start) {
        previous.end = entry.end;
        return merged;
      }
      merged.push({ ...entry });
      return merged;
    }, []);
}

export function insertEntryIntoTimeline(entries, inserted) {
  const adjusted = entries.flatMap((entry) => {
    const entryEnd = entry.end ?? Number.POSITIVE_INFINITY;
    if (entryEnd <= inserted.start || entry.start >= inserted.end) return [entry];

    const remaining = [];
    if (entry.start < inserted.start) {
      remaining.push({ ...entry, end: inserted.start });
    }
    if (entryEnd > inserted.end) {
      remaining.push({
        ...entry,
        id: uid(),
        start: inserted.end,
        end: entry.end,
      });
    }
    return remaining;
  });
  return mergeAdjacentEntries([...adjusted, inserted]);
}
