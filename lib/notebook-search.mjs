export function normalizeNotebookQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, " ")
    .trim();
}

export function notebookSearchTerms(query) {
  return normalizeNotebookQuery(query).split(" ").filter(Boolean);
}

export function searchNotebookNotes(notes, query) {
  const terms = notebookSearchTerms(query);
  if (!terms.length) return notes;
  return notes.filter((note) => {
    const searchable = normalizeNotebookQuery([
      note.title,
      note.summary,
      note.content,
      note.sourceItemTitle || ""
    ].join("\n"));
    return terms.every((term) => searchable.includes(term));
  });
}

export function notebookSearchSnippet(note, query, maxLength = 120) {
  const terms = notebookSearchTerms(query);
  if (!terms.length) return note.summary;
  const candidates = [
    note.summary,
    note.content,
    note.sourceItemTitle ? `来自事项：${note.sourceItemTitle}` : ""
  ].map((value) => String(value || "").replace(/\s+/gu, " ").trim()).filter(Boolean);
  const match = candidates
    .map((value) => ({
      value,
      index: Math.min(...terms.map((term) => {
        const found = normalizeNotebookQuery(value).indexOf(term);
        return found < 0 ? Number.POSITIVE_INFINITY : found;
      }))
    }))
    .filter((candidate) => Number.isFinite(candidate.index))
    .sort((left, right) => left.index - right.index)[0];
  if (!match) return note.summary;
  if (Array.from(match.value).length <= maxLength) return match.value;
  const start = Math.max(0, match.index - 28);
  const slice = Array.from(match.value).slice(start, start + maxLength).join("");
  return `${start > 0 ? "…" : ""}${slice}${start + maxLength < Array.from(match.value).length ? "…" : ""}`;
}
