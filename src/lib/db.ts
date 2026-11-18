import Dexie, { type Table } from 'dexie';
import type { DayRecord, FoodEntry, JournalEntry, PendingOperation, Preferences, Tracker, WeeklyReflection, WeightEntry } from './types';
import { BUILTIN_TRACKERS, defaultPreferences } from './types';
import { localDateKey } from './dates';
import { nutritionBaseForDay, nutritionTotals } from './nutrition';
import { isValidDayChange } from './day-inputs';

class MinimaDB extends Dexie {
  days!: Table<DayRecord, string>;
  trackers!: Table<Tracker, string>;
  weights!: Table<WeightEntry, string>;
  journals!: Table<JournalEntry, string>;
  weeklyReflections!: Table<WeeklyReflection, string>;
  preferences!: Table<{ id: string; value: Preferences }, string>;
  operations!: Table<PendingOperation, string>;

  constructor() {
    super('minima-local');
    this.version(3).stores({
      days: 'date, updatedAt', trackers: 'id, group, archived', weights: 'date, updatedAt',
      journals: 'date, updatedAt', weeklyReflections: 'weekStart, updatedAt', preferences: 'id', operations: 'id, createdAt, nextAttemptAt, [table+recordKey]',
    });
  }
}

export const db = new MinimaDB();

let isDbInitialized = false;

async function backfillCustomTrackerCreatedAt() {
  const existingTrackers = await db.trackers.filter((tracker) => !tracker.builtin && !tracker.createdAt).toArray();
  if (!existingTrackers.length) return;
  const today = localDateKey();
  await db.transaction('rw', db.trackers, db.days, async () => {
    for (const tracker of existingTrackers) {
      const firstUse = await db.days.where('date').aboveOrEqual('0000-01-01').filter((day) => day.states?.[tracker.id] === 'done' || day.states?.[tracker.id] === 'missed').first();
      await db.trackers.put({ ...tracker, createdAt: firstUse?.date ?? today });
    }
  });
}

export async function initializeDatabase() {
  if (isDbInitialized) return;
  const current = await db.preferences.get('main');
  const builtinTrackers = await db.trackers.bulkGet(BUILTIN_TRACKERS.map((tracker) => tracker.id));
  if (
    Array.isArray(current?.value?.scoreWeightHistory) && current.value.scoreWeightHistory.length > 0 &&
    Array.isArray(current?.value?.nutritionTargetHistory) && current.value.nutritionTargetHistory.length > 0 &&
    Array.isArray(current?.value?.exPeriods) &&
    current.value.trackerWeights && typeof current.value.trackerWeights === 'object' && !Array.isArray(current.value.trackerWeights) &&
    current.value.weeklyGoals && typeof current.value.weeklyGoals === 'object' && !Array.isArray(current.value.weeklyGoals) &&
    builtinTrackers.every(Boolean)
  ) {
    await backfillCustomTrackerCreatedAt();
    isDbInitialized = true;
    try { localStorage.setItem('minima:db-initialized', 'true'); } catch {}
    return;
  }

  await db.transaction('rw', db.trackers, db.preferences, db.days, async () => {
    for (const tracker of BUILTIN_TRACKERS) if (!await db.trackers.get(tracker.id)) await db.trackers.put(tracker);
    const today = localDateKey();
    const prefRecord = await db.preferences.get('main');
    if (!prefRecord) await db.preferences.put({ id: 'main', value: defaultPreferences(today) });
    else {
      const defaults = defaultPreferences(today);
      const previous = prefRecord.value;
      const trackerWeights = previous.trackerWeights && typeof previous.trackerWeights === 'object' && !Array.isArray(previous.trackerWeights) ? { ...defaults.trackerWeights, ...previous.trackerWeights } : defaults.trackerWeights;
      const weeklyGoals = previous.weeklyGoals && typeof previous.weeklyGoals === 'object' && !Array.isArray(previous.weeklyGoals) ? previous.weeklyGoals : defaults.weeklyGoals;
      const earliestRecord = await db.days.orderBy('date').first();
      const baselineDate = earliestRecord?.date ?? today;
      const scoreWeightHistory = Array.isArray(previous.scoreWeightHistory) && previous.scoreWeightHistory.length ? previous.scoreWeightHistory : [{ effectiveDate: baselineDate, weights: trackerWeights }];
      const nutritionTargetHistory = Array.isArray(previous.nutritionTargetHistory) && previous.nutritionTargetHistory.length ? previous.nutritionTargetHistory : [{ effectiveDate: baselineDate, calorieTarget: previous.calorieTarget ?? defaults.calorieTarget, proteinTarget: previous.proteinTarget ?? defaults.proteinTarget }];
      const exPeriods = Array.isArray(previous.exPeriods) ? previous.exPeriods : [];
      await db.preferences.put({ id: 'main', value: { ...defaults, ...previous, trackerWeights, scoreWeightHistory, weeklyGoals, nutritionTargetHistory, exPeriods } });
    }
  });
  await backfillCustomTrackerCreatedAt();
  isDbInitialized = true;
  try { localStorage.setItem('minima:db-initialized', 'true'); } catch {}
}

export async function saveDay(record: DayRecord) {
  await db.days.put(record);
}

export async function updateDayRecord(date: string, change: Partial<DayRecord>): Promise<DayRecord> {
  return await db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(date);
    const mergedStates = change.states
      ? { ...(existing?.states ?? {}), ...change.states }
      : (existing?.states ?? {});
    const updated: DayRecord = {
      date,
      ...existing,
      ...change,
      states: mergedStates,
      updatedAt: Date.now(),
    };
    for (const key of Object.keys(change) as (keyof DayRecord)[]) {
      if (change[key] === undefined) {
        delete updated[key];
      }
    }
    if (change.foodEntries) {
      updated.nutritionBase = change.nutritionBase ?? nutritionBaseForDay(existing ?? updated);
      const totals = nutritionTotals(updated);
      for (const field of ['calories', 'protein', 'carbs', 'fat'] as const) {
        if (totals[field] == null) delete updated[field];
        else updated[field] = totals[field];
      }
    }
    await db.days.put(updated);
    return updated;
  });
}

export async function addFoodEntries(date: string, entries: FoodEntry[], markDoneTrackerId?: string | null): Promise<DayRecord> {
  if (!isValidDayChange({ foodEntries: entries })) throw new Error('Check the meal items before saving.');
  return db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(date);
    const current = existing?.foodEntries ?? [];
    const ids = new Set(current.map((entry) => entry.id));
    const next = [...current];
    for (const entry of entries) {
      if (!ids.has(entry.id)) { next.push(entry); ids.add(entry.id); }
    }
    const nutritionBase = nutritionBaseForDay(existing);
    const totals = nutritionTotals({ foodEntries: next, nutritionBase });
    if (next.length > 200 || !isValidDayChange({ foodEntries: next, nutritionBase, ...totals })) throw new Error('This meal would exceed the daily nutrition limits.');
    return updateDayRecord(date, { foodEntries: next, nutritionBase, ...(markDoneTrackerId ? { states: { [markDoneTrackerId]: 'done' } } : {}) });
  });
}

export async function removeFoodEntry(date: string, id: string): Promise<DayRecord> {
  return db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(date);
    const current = existing?.foodEntries ?? [];
    const target = current.find((entry) => entry.id === id);
    const remaining = current.filter((entry) => entry.id !== id);
    const clearMeal = target && target.meal !== 'extra' && !remaining.some((entry) => entry.meal === target.meal);
    return updateDayRecord(date, { foodEntries: remaining, ...(clearMeal ? { states: { [target.meal]: 'unrecorded' } } : {}) });
  });
}

export async function removeMealEntries(date: string, meal: FoodEntry['meal']): Promise<DayRecord> {
  return db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(date);
    const remaining = (existing?.foodEntries ?? []).filter((entry) => entry.meal !== meal);
    return updateDayRecord(date, { foodEntries: remaining, ...(meal === 'extra' ? {} : { states: { [meal]: 'unrecorded' } }) });
  });
}

export async function saveWeight(entry: WeightEntry) {
  await db.weights.put(entry);
}

export async function saveJournal(entry: JournalEntry) {
  if (!entry.body.trim()) {
    await db.journals.delete(entry.date);
    return;
  }
  await db.journals.put(entry);
}

export async function saveWeeklyReflection(weekStart: string, change: Pick<WeeklyReflection, 'whatWorked' | 'whatCouldBeEasier'>) {
  await db.transaction('rw', db.weeklyReflections, async () => {
    const previous = await db.weeklyReflections.get(weekStart);
    await db.weeklyReflections.put({ ...previous, ...change, weekStart, updatedAt: Date.now() });
  });
}

export async function saveTracker(tracker: Tracker) {
  await db.trackers.put(tracker);
}

export async function savePreferences(value: Preferences) {
  await db.preferences.put({ id: 'main', value });
}

