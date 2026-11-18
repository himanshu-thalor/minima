import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { asDisplayWeight, asStoredKg } from '../src/lib/weight';
import { dailyStreak, hasTrackedAction, scorePeriod, trackerState } from '../src/lib/score';
import { isValidDayChange } from '../src/lib/day-inputs';
import { parseMinimaBackup } from '../src/lib/backups';
import { BUILTIN_TRACKERS, defaultPreferences, type DayRecord, type Tracker } from '../src/lib/types';
import { db, initializeDatabase } from '../src/lib/db';

test('weight conversion functions guard against NaN and non-finite numbers', () => {
  assert.equal(asDisplayWeight(NaN, 'kg'), 0);
  assert.equal(asDisplayWeight(Infinity, 'lb'), 0);
  assert.equal(asDisplayWeight(-Infinity, 'kg'), 0);
  assert.equal(asStoredKg(NaN, 'lb'), 0);
  assert.equal(asStoredKg(Infinity, 'kg'), 0);
  assert.equal(asDisplayWeight(70, 'kg'), 70);
  assert.equal(asDisplayWeight(70, 'lb'), 154.3);
});

test('hasTrackedAction accurately recognizes food entries, carbs, and fat without habit check-ins', () => {
  const emptyDay: DayRecord = { date: '2026-10-17', states: {}, updatedAt: 1 };
  assert.equal(hasTrackedAction(emptyDay), false);

  const dayWithFood: DayRecord = {
    date: '2026-10-17',
    states: {},
    foodEntries: [{ id: '1', name: 'Apple', meal: 'breakfast', calories: 95, carbs: 25 }],
    updatedAt: 1,
  };
  assert.equal(hasTrackedAction(dayWithFood), true);

  const dayWithCarbsOnly: DayRecord = {
    date: '2026-10-17',
    states: {},
    carbs: 45,
    updatedAt: 1,
  };
  assert.equal(hasTrackedAction(dayWithCarbsOnly), true);

  const dayWithFatOnly: DayRecord = {
    date: '2026-10-17',
    states: {},
    fat: 15,
    updatedAt: 1,
  };
  assert.equal(hasTrackedAction(dayWithFatOnly), true);
});

test('trackerState safely handles records with null or undefined states without throwing TypeError', () => {
  const corruptedDay = {
    date: '2026-10-17',
    states: undefined as unknown as Record<string, 'done' | 'missed' | 'unrecorded'>,
    updatedAt: 1,
  } as DayRecord;

  assert.doesNotThrow(() => {
    const weightResult = trackerState(corruptedDay, 'weight');
    assert.equal(weightResult, 'unrecorded');

    const habitResult = trackerState(corruptedDay, 'workout');
    assert.equal(habitResult, 'unrecorded');
  });
});

test('scorePeriod never evaluates to NaN when doneWeight and recordedWeight are zero', () => {
  const tracker: Tracker = {
    id: 'workout',
    name: 'Workout',
    group: 'Physical health',
    icon: 'dumbbell',
    weight: 0,
    color: '#c6e18b',
    archived: false,
    builtin: true,
    schedule: [0, 1, 2, 3, 4, 5, 6],
  };
  const prefs = defaultPreferences('2026-10-17');
  const result = scorePeriod([], [tracker], prefs, '2026-10-10', 7);
  assert.equal(Number.isNaN(result.score), false);
  assert.equal(result.score, null);
  assert.equal(result.coverage, 0);
});

test('isValidDayChange enforces portion length limits up to 80 characters', () => {
  assert.equal(
    isValidDayChange({
      foodEntries: [
        { id: '1', name: 'Rice', meal: 'lunch', calories: 200, portion: '1 bowl (150g)' },
      ],
    }),
    true
  );

  assert.equal(
    isValidDayChange({
      foodEntries: [
        { id: '1', name: 'Rice', meal: 'lunch', calories: 200, portion: 'x'.repeat(81) },
      ],
    }),
    false
  );
});

test('parseMinimaBackup rejects backups containing portion strings exceeding 80 characters', () => {
  const validBackup = {
    format: 'minima-backup',
    version: 1,
    days: [
      {
        date: '2026-10-17',
        states: { workout: 'done' },
        foodEntries: [
          { id: '1', name: 'Banana', meal: 'breakfast', calories: 105, portion: '1 medium' },
        ],
        updatedAt: 100,
      },
    ],
    trackers: BUILTIN_TRACKERS,
    weights: [],
    journals: [],
  };

  assert.doesNotThrow(() => parseMinimaBackup(JSON.stringify(validBackup)));

  const invalidBackup = {
    ...validBackup,
    days: [
      {
        ...validBackup.days[0],
        foodEntries: [
          { id: '1', name: 'Banana', meal: 'breakfast', calories: 105, portion: 'b'.repeat(85) },
        ],
      },
    ],
  };

  assert.throws(() => parseMinimaBackup(JSON.stringify(invalidBackup)), /invalid/i);
});

test('initializeDatabase fast-path succeeds idempotently without error', async () => {
  await initializeDatabase();
  const pref = await db.preferences.get('main');
  assert.ok(pref?.value?.scoreWeightHistory?.length);
  // Second call uses fast path
  await assert.doesNotReject(async () => {
    await initializeDatabase();
  });
});

test('dailyStreak gives grace period for today when today is unrecorded', () => {
  const reading = BUILTIN_TRACKERS.find((t) => t.id === 'reading')!;
  const days: DayRecord[] = [
    { date: '2026-10-15', states: { reading: 'done' }, updatedAt: 1 },
    { date: '2026-10-16', states: { reading: 'done' }, updatedAt: 2 },
    // 2026-10-17 is today and unrecorded
  ];
  const result = dailyStreak(days, reading, '2026-10-17');
  assert.equal(result.current, 2);
  assert.equal(result.best, 2);
});

test('saveJournal deletes record when body is empty or whitespace-only', async () => {
  const { saveJournal } = await import('../src/lib/db');
  const date = '2026-10-25';

  // 1. Save valid journal
  await saveJournal({ date, body: 'Today felt calm and grounded.', tags: [], updatedAt: Date.now() });
  let saved = await db.journals.get(date);
  assert.equal(saved?.body, 'Today felt calm and grounded.');

  // 2. Clear journal with empty string -> should delete
  await saveJournal({ date, body: '', tags: [], updatedAt: Date.now() });
  saved = await db.journals.get(date);
  assert.equal(saved, undefined);

  // 3. Save again with whitespace only -> should also delete
  await saveJournal({ date, body: '   \n  \t  ', tags: [], updatedAt: Date.now() });
  saved = await db.journals.get(date);
  assert.equal(saved, undefined);
});

test('isValidDayChange validates mood against allowed levels', () => {
  assert.equal(isValidDayChange({ mood: 'low' }), true);
  assert.equal(isValidDayChange({ mood: 'uneven' }), true);
  assert.equal(isValidDayChange({ mood: 'steady' }), true);
  assert.equal(isValidDayChange({ mood: 'good' }), true);
  assert.equal(isValidDayChange({ mood: 'ecstatic' as any }), false);
  assert.equal(isValidDayChange({ mood: '' as any }), false);
});

test('tracker archiveHistory preserves historical eligibility intervals across archive/unarchive cycles', async () => {
  const { trackerEligibleOnDate } = await import('../src/lib/score');
  const tracker: Tracker = {
    id: 'habit-1',
    name: 'Meditate',
    group: 'Care',
    icon: 'sparkles',
    weight: 5,
    color: '#c6e18b',
    archived: false,
    builtin: false,
    createdAt: '2026-10-01',
    schedule: [0, 1, 2, 3, 4, 5, 6],
    archiveHistory: [
      { effectiveDate: '2026-10-05', archived: true },   // Archived on Oct 5
      { effectiveDate: '2026-10-10', archived: false },  // Unarchived on Oct 10
      { effectiveDate: '2026-10-15', archived: true },   // Re-archived on Oct 15
    ],
  };

  // Before initial archive: active
  assert.equal(trackerEligibleOnDate(tracker, '2026-10-04'), true);
  // During first archived period: inactive
  assert.equal(trackerEligibleOnDate(tracker, '2026-10-05'), false);
  assert.equal(trackerEligibleOnDate(tracker, '2026-10-09'), false);
  // After unarchive: active again
  assert.equal(trackerEligibleOnDate(tracker, '2026-10-10'), true);
  assert.equal(trackerEligibleOnDate(tracker, '2026-10-14'), true);
  // After re-archive: inactive again
  assert.equal(trackerEligibleOnDate(tracker, '2026-10-15'), false);
  assert.equal(trackerEligibleOnDate(tracker, '2026-10-20'), false);
});

