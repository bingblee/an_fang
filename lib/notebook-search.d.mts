export interface SearchableNotebookNote {
  title: string;
  summary: string;
  content: string;
  sourceItemTitle: string | null;
}

export function normalizeNotebookQuery(value: unknown): string;
export function notebookSearchTerms(query: string): string[];
export function searchNotebookNotes<T extends SearchableNotebookNote>(notes: T[], query: string): T[];
export function notebookSearchSnippet(note: SearchableNotebookNote, query: string, maxLength?: number): string;
