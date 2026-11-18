import type { DayRecord, JournalEntry } from './types';

export type NoteSearchResult = { date: string; type: 'Journal' | 'Learning'; body: string };

export function searchNotes(journals: JournalEntry[], days: DayRecord[], query: string, limit = 6): NoteSearchResult[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return [
    ...journals
      .filter((entry) => entry.body.toLocaleLowerCase().includes(term))
      .map((entry): NoteSearchResult => ({ date: entry.date, type: 'Journal', body: entry.body })),
    ...days
      .filter((day) => day.learningNote?.toLocaleLowerCase().includes(term))
      .map((day): NoteSearchResult => ({ date: day.date, type: 'Learning', body: day.learningNote! })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, Math.max(0, limit));
}
