import test from 'node:test';
import assert from 'node:assert/strict';
import { searchNotes } from '../src/lib/note-search';
import type { DayRecord, JournalEntry } from '../src/lib/types';

test('History search finds journal and learning notes newest first', () => {
  const journals = [
    { date: '2026-10-08', body: 'A journal note about focus', tags: [], updatedAt: 1 },
  ] satisfies JournalEntry[];
  const days = [
    { date: '2026-10-10', states: {}, learningNote: 'Focus on one useful idea', updatedAt: 1 },
    { date: '2026-10-09', states: {}, learningNote: 'Something else', updatedAt: 1 },
  ] satisfies DayRecord[];

  assert.deepEqual(searchNotes(journals, days, '  FOCUS ').map(({ date, type }) => [date, type]), [
    ['2026-10-10', 'Learning'],
    ['2026-10-08', 'Journal'],
  ]);
  assert.deepEqual(searchNotes(journals, days, '   '), []);
});

test('History search caps results and supports a zero-result limit', () => {
  const days = Array.from({ length: 8 }, (_, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    states: {},
    learningNote: `idea ${index}`,
    updatedAt: 1,
  })) satisfies DayRecord[];

  assert.equal(searchNotes([], days, 'idea').length, 6);
  assert.deepEqual(searchNotes([], days, 'idea', 0), []);
});
