import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { db, initializeDatabase } from '../src/lib/db';
import { BUILTIN_TRACKERS, defaultPreferences, type Preferences } from '../src/lib/types';

test('initialization repairs missing legacy preference arrays and missing builtin despite custom count', async () => {
  const date = '2026-10-01';
  const preferences = { ...defaultPreferences(date), accent: '#abcdef', exPeriods: undefined, scoreWeightHistory: 'invalid', nutritionTargetHistory: undefined } as unknown as Preferences;
  await db.preferences.put({ id: 'main', value: preferences });
  await db.trackers.bulkPut([...BUILTIN_TRACKERS.filter((tracker) => tracker.id !== 'weight'), { ...BUILTIN_TRACKERS[0], id: 'custom', builtin: false }]);
  await db.days.put({ date, states: { reading: 'done' }, updatedAt: 1 });
  await initializeDatabase();
  const saved = (await db.preferences.get('main'))!.value;
  assert.equal(saved.accent, '#abcdef');
  assert.deepEqual(saved.exPeriods, []);
  assert.equal(saved.scoreWeightHistory?.[0].effectiveDate, date);
  assert.equal(saved.nutritionTargetHistory?.[0].effectiveDate, date);
  assert.ok(await db.trackers.get('weight'));
  assert.equal((await db.days.get(date))?.states.reading, 'done');
});
