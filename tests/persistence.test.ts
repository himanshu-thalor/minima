import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import Dexie from 'dexie';
import { db, initializeDatabase, saveDay, saveJournal, saveWeeklyReflection, saveWeight } from '../src/lib/db';
import { BUILTIN_TRACKERS, defaultPreferences } from '../src/lib/types';
import { parseMinimaBackup } from '../src/lib/backups';

test('database initialization preserves existing records across app updates', async () => {
  const legacy = new Dexie('minima-local');
  legacy.version(2).stores({ days: 'date, updatedAt', trackers: 'id, group, archived', weights: 'date, updatedAt', journals: 'date, updatedAt', preferences: 'id', operations: 'id, createdAt, nextAttemptAt, [table+recordKey]' });
  await legacy.open();
  const date = '2026-10-11';
  await legacy.table('days').put({ date, states: { reading: 'done' }, updatedAt: 9 });
  await legacy.table('journals').put({ date, body: 'Before the upgrade', tags: [], updatedAt: 9 });
  await legacy.table('weights').put({ date, kg: 68, updatedAt: 9 });
  const legacyPreferences = { ...defaultPreferences(date), accent: '#abcdef' };
  delete legacyPreferences.scoreWeightHistory;
  delete legacyPreferences.nutritionTargetHistory;
  await legacy.table('preferences').put({ id: 'main', value: legacyPreferences });
  await legacy.close();

  await initializeDatabase();
  assert.deepEqual(await db.days.get(date), { date, states: { reading: 'done' }, updatedAt: 9 });
  assert.equal((await db.journals.get(date))?.body, 'Before the upgrade');
  assert.equal((await db.weights.get(date))?.kg, 68);
  assert.equal((await db.preferences.get('main'))?.value.accent, '#abcdef');
  assert.deepEqual((await db.preferences.get('main'))?.value.scoreWeightHistory, [{ effectiveDate: date, weights: legacyPreferences.trackerWeights }]);
  assert.deepEqual((await db.preferences.get('main'))?.value.nutritionTargetHistory, [{ effectiveDate: date, calorieTarget: 2200, proteinTarget: 130 }]);
  assert.equal(await db.weeklyReflections.count(), 0);

  await saveDay({ date, states: { reading: 'done' }, calories: 1800, sleepHours: 7.5, focusMinutes: 45, screenTimeMinutes: 120, readingMinutes: 20, communicationMinutes: 10, technicalLearningMinutes: 25, problemSolvingMinutes: 30, learningNote: 'Loops and invariants', intention: 'Take a quiet walk', mood: 'steady', energy: 4, trackerValues: { custom: 3 }, updatedAt: 10 });
  await saveJournal({ date, body: 'A small step today.', tags: ['growth'], updatedAt: 11 });
  await saveWeeklyReflection('2026-10-05', { whatWorked: 'A short walk', whatCouldBeEasier: 'Put shoes by the door' });
  await saveWeight({ date, kg: 67, updatedAt: 12 });
  await db.preferences.put({ id: 'main', value: { ...defaultPreferences(date), accent: '#abcdef' } });
  const before = await db.operations.count();

  await initializeDatabase();

  assert.deepEqual(await db.days.get(date), { date, states: { reading: 'done' }, calories: 1800, sleepHours: 7.5, focusMinutes: 45, screenTimeMinutes: 120, readingMinutes: 20, communicationMinutes: 10, technicalLearningMinutes: 25, problemSolvingMinutes: 30, learningNote: 'Loops and invariants', intention: 'Take a quiet walk', mood: 'steady', energy: 4, trackerValues: { custom: 3 }, updatedAt: 10 });
  assert.equal((await db.journals.get(date))?.body, 'A small step today.');
  assert.equal((await db.weeklyReflections.get('2026-10-05'))?.whatCouldBeEasier, 'Put shoes by the door');
  assert.equal((await db.weights.get(date))?.kg, 67);
  assert.equal((await db.preferences.get('main'))?.value.accent, '#abcdef');
  assert.equal(await db.operations.count(), before);
  assert.equal(await db.trackers.where('id').equals('breakfast').count(), 1);
});

test('updateDayRecord atomically merges states and preserves food entries without race conditions', async () => {
  const { updateDayRecord } = await import('../src/lib/db');
  const date = '2026-10-17';
  await db.days.delete(date);

  // 1. First write: log food entries and calories
  await updateDayRecord(date, {
    foodEntries: [{ id: '1', name: 'Almonds', meal: 'snacks', calories: 160, protein: 6 }],
    calories: 160,
    protein: 6,
  });

  // 2. Second rapid write: set snack status to done
  await updateDayRecord(date, {
    states: { snacks: 'done' },
  });

  const record = await db.days.get(date);
  assert.equal(record?.calories, 160);
  assert.equal(record?.protein, 6);
  assert.equal(record?.foodEntries?.length, 1);
  assert.equal(record?.foodEntries?.[0].name, 'Almonds');
  assert.equal(record?.states?.snacks, 'done');

  // 3. Third write: mark breakfast done, preserving snacks: done and food entries
  await updateDayRecord(date, {
    states: { breakfast: 'done' },
  });

  const updatedRecord = await db.days.get(date);
  assert.equal(updatedRecord?.calories, 160);
  assert.equal(updatedRecord?.foodEntries?.length, 1);
  assert.equal(updatedRecord?.states?.snacks, 'done');
  assert.equal(updatedRecord?.states?.breakfast, 'done');
});

test('backup validation accepts a full export and rejects malformed records before restore', () => {
  const date = '2026-10-11';
  const backup = { format: 'minima-backup', version: 1, days: [{ date, states: { reading: 'done' }, sleepHours: 7, intention: 'Stretch before work', updatedAt: 1 }], trackers: [BUILTIN_TRACKERS[0]], weights: [{ date, kg: 67, updatedAt: 1 }], journals: [{ date, body: 'A note', tags: [], updatedAt: 1 }], weeklyReflections: [{ weekStart: '2026-10-05', whatWorked: 'Walk', updatedAt: 1 }], preferences: { ...defaultPreferences(date), weightGoalKg: 65.5 } };
  assert.equal(parseMinimaBackup(JSON.stringify(backup)).days.length, 1);
  assert.equal(parseMinimaBackup(JSON.stringify(backup)).days[0].intention, 'Stretch before work');
  assert.equal(parseMinimaBackup(JSON.stringify(backup)).weeklyReflections?.[0].whatWorked, 'Walk');
  assert.equal(parseMinimaBackup(JSON.stringify(backup)).preferences?.weightGoalKg, 65.5);
  const invalid = structuredClone(backup);
  invalid.days[0].sleepHours = 90;
  assert.throws(() => parseMinimaBackup(JSON.stringify(invalid)), /days record 1 is invalid/);
  const brokenDate = structuredClone(backup);
  brokenDate.weights[0].date = '2026-02-30';
  assert.throws(() => parseMinimaBackup(JSON.stringify(brokenDate)), /weights record 1 is invalid/);
  const longIntention = structuredClone(backup);
  longIntention.days[0].intention = 'x'.repeat(181);
  assert.throws(() => parseMinimaBackup(JSON.stringify(longIntention)), /days record 1 is invalid/);
  const invalidReflection = structuredClone(backup);
  invalidReflection.weeklyReflections[0].whatWorked = 'x'.repeat(401);
  assert.throws(() => parseMinimaBackup(JSON.stringify(invalidReflection)), /weekly reflection 1 is invalid/);
  const invalidWeightGoal = structuredClone(backup);
  invalidWeightGoal.preferences.weightGoalKg = 351;
  assert.throws(() => parseMinimaBackup(JSON.stringify(invalidWeightGoal)), /preferences are invalid/);
  const invalidTargetHistory = structuredClone(backup);
  invalidTargetHistory.preferences.nutritionTargetHistory[0].calorieTarget = 0;
  assert.throws(() => parseMinimaBackup(JSON.stringify(invalidTargetHistory)), /preferences are invalid/);
  const lowCalorieTarget = structuredClone(backup);
  lowCalorieTarget.preferences.calorieTarget = 499;
  assert.throws(() => parseMinimaBackup(JSON.stringify(lowCalorieTarget)), /preferences are invalid/);
  const highProteinTarget = structuredClone(backup);
  highProteinTarget.preferences.proteinTarget = 501;
  assert.throws(() => parseMinimaBackup(JSON.stringify(highProteinTarget)), /preferences are invalid/);
  const oversizedScoreWeight = structuredClone(backup);
  oversizedScoreWeight.preferences.trackerWeights.reading = 101;
  assert.throws(() => parseMinimaBackup(JSON.stringify(oversizedScoreWeight)), /preferences are invalid/);
});
