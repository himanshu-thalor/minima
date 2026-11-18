import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { db, initializeDatabase } from '../src/lib/db';
import { BUILTIN_TRACKERS, defaultPreferences } from '../src/lib/types';

test('initialization backfills creation dates for legacy custom trackers on the fast path', async () => {
  const date = '2026-10-03';
  await db.trackers.bulkPut([
    ...BUILTIN_TRACKERS,
    { ...BUILTIN_TRACKERS[0], id: 'legacy-custom', name: 'Legacy habit', builtin: false, createdAt: undefined },
  ]);
  await db.days.put({ date, states: { 'legacy-custom': 'done' }, updatedAt: 1 });
  await db.preferences.put({ id: 'main', value: defaultPreferences('2026-10-11') });

  await initializeDatabase();

  assert.equal((await db.trackers.get('legacy-custom'))?.createdAt, date);
});
