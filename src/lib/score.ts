import type { Completion, DayRecord, Preferences, Tracker } from './types';
import { addCalendarDays, dateFromKey, localDateKey } from './dates';

export type ScoreResult = { score: number | null; coverage: number; done: number; missed: number; recorded: number; eligible: number };

function trackerActiveOnDate(tracker: Tracker, date: string) {
  if (tracker.createdAt && date < tracker.createdAt) return false;
  const status = [...(tracker.archiveHistory ?? [])].filter((item) => item.effectiveDate <= date).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).at(-1);
  if (status) return !status.archived;
  if (tracker.archivedAt) return date <= tracker.archivedAt;
  return !tracker.archived;
}

function trackerScheduledOnDate(tracker: Tracker, date: string) {
  const version = [...(tracker.scheduleHistory ?? [])].filter((item) => item.effectiveDate <= date).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).at(-1);
  return (version?.schedule ?? tracker.schedule).includes(dateFromKey(date).getDay());
}

export function trackerEligibleOnDate(tracker: Tracker, date: string) { return trackerActiveOnDate(tracker, date) && trackerScheduledOnDate(tracker, date); }

function weightsForDate(trackers: Tracker[], preferences: Preferences, date: string) {
  const version = [...(preferences.scoreWeightHistory ?? [])]
    .filter((item) => item.effectiveDate <= date)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    .at(-1);
  return version?.weights ?? Object.fromEntries(trackers.map((tracker) => [tracker.id, tracker.weight]));
}

export function hasTrackedAction(day: DayRecord | undefined): boolean {
  if (!day) return false;
  const hasHabitState = Object.values(day.states ?? {}).some((state) => state === 'done' || state === 'missed');
  return (
    hasHabitState ||
    day.calories != null ||
    day.protein != null ||
    day.carbs != null ||
    day.fat != null ||
    Boolean(day.foodEntries?.length) ||
    Object.keys(day.trackerValues ?? {}).length > 0
  );
}

export function nutritionTargetsForDate(preferences: Preferences, date: string) {
  const versions = [...(preferences.nutritionTargetHistory ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const version = versions.filter((item) => item.effectiveDate <= date).at(-1) ?? versions[0];
  return { calorieTarget: version?.calorieTarget ?? preferences.calorieTarget, proteinTarget: version?.proteinTarget ?? preferences.proteinTarget };
}

function stateForDate(day: DayRecord | undefined, tracker: Tracker, preferences: Preferences, date: string): Completion {
  if (!hasTrackedAction(day)) return 'unrecorded';
  if (tracker.id === 'nutrition') {
    if (day?.calories == null || day.protein == null) return 'unrecorded';
    const targets = nutritionTargetsForDate(preferences, date);
    return day.calories >= targets.calorieTarget * .9 && day.calories <= targets.calorieTarget * 1.1 && day.protein >= targets.proteinTarget ? 'done' : 'missed';
  }
  const state = day?.states?.[tracker.id] ?? 'unrecorded';
  return day && state === 'unrecorded' ? 'missed' : state;
}

export function scorePeriod(days: DayRecord[], trackers: Tracker[], preferences: Preferences, start: string, length = 7, minimumRecorded = 4, minimumCoverage = 25): ScoreResult {
  const byDate = new Map(days.map((day) => [day.date, day]));
  let doneWeight = 0, recordedWeight = 0, possibleWeight = 0, done = 0, missed = 0, recorded = 0, eligible = 0;
  for (let offset = 0; offset < length; offset++) {
    const date = addCalendarDays(start, offset);
    if (date > localDateKey()) continue;
    const day = byDate.get(date);
    const dayWeights = weightsForDate(trackers, preferences, date);
    const included = trackers.filter((tracker) => trackerEligibleOnDate(tracker, date));
    const custom = included.filter((item) => !item.builtin);
    const customTotal = custom.reduce((sum, item) => sum + Math.max(0, dayWeights[item.id] ?? item.weight), 0);
    for (const tracker of included) {
      const rawWeight = Math.max(0, dayWeights[tracker.id] ?? tracker.weight);
      const weight = tracker.builtin ? rawWeight : customTotal ? 15 * rawWeight / customTotal : 0;
      if (!weight) continue;
      eligible++;
      possibleWeight += weight;
      const state = stateForDate(day, tracker, preferences, date);
      if (state === 'unrecorded') continue;
      recorded++;
      recordedWeight += weight;
      if (state === 'done') { done++; doneWeight += weight; } else missed++;
    }
  }
  const coverage = possibleWeight ? Math.round((recordedWeight / possibleWeight) * 100) : 0;
  const score = coverage >= minimumCoverage && recorded >= Math.min(minimumRecorded, eligible) && recordedWeight > 0 ? Math.round((doneWeight / recordedWeight) * 100) : null;
  return { score, coverage, done, missed, recorded, eligible };
}

export function trackerState(day: DayRecord | undefined, trackerId: string, preferences?: Preferences, hasWeightEntry = false): Completion {
  if (trackerId === 'weight') return hasWeightEntry || day?.states?.weight === 'done' ? 'done' : day?.states?.weight === 'missed' ? 'missed' : 'unrecorded';
  if (trackerId === 'nutrition') {
    if (day?.calories == null || day.protein == null) return 'unrecorded';
    const targets = preferences ? nutritionTargetsForDate(preferences, day.date) : { calorieTarget: 2200, proteinTarget: 130 };
    return day.calories >= targets.calorieTarget * .9 && day.calories <= targets.calorieTarget * 1.1 && day.protein >= targets.proteinTarget ? 'done' : 'missed';
  }
  if (!hasTrackedAction(day)) return 'unrecorded';
  const state = day?.states?.[trackerId] ?? 'unrecorded';
  return day && state === 'unrecorded' ? 'missed' : state;
}

export type NutritionIntakeSummary = { recorded: number; onTarget: number; averageCalories: number | null; averageProtein: number | null };
export function nutritionIntakeSummary(days: DayRecord[], preferences: Preferences): NutritionIntakeSummary {
  const recorded = days.filter((day) => day.calories != null && day.protein != null);
  if (!recorded.length) return { recorded: 0, onTarget: 0, averageCalories: null, averageProtein: null };
  return {
    recorded: recorded.length,
    onTarget: recorded.filter((day) => { const target = nutritionTargetsForDate(preferences, day.date); return day.calories! >= target.calorieTarget * .9 && day.calories! <= target.calorieTarget * 1.1 && day.protein! >= target.proteinTarget; }).length,
    averageCalories: Math.round(recorded.reduce((sum, day) => sum + day.calories!, 0) / recorded.length),
    averageProtein: Math.round(recorded.reduce((sum, day) => sum + day.protein!, 0) / recorded.length),
  };
}

export type StreakSummary = { current: number; best: number; goal: number; thisWeek: number; unknown: number };

export function dailyStreak(days: DayRecord[], tracker: Tracker, today = localDateKey()): StreakSummary {
  const states = new Map(days.filter(hasTrackedAction).map((day) => [day.date, day.states?.[tracker.id] && day.states?.[tracker.id] !== 'unrecorded' ? day.states[tracker.id] : 'missed']));
  let current = 0;
  let startDate = today;
  if (trackerActiveOnDate(tracker, today) && trackerScheduledOnDate(tracker, today)) {
    const todayState = states.get(today);
    if (todayState === 'done') {
      current++;
      startDate = addCalendarDays(today, -1);
    } else if (todayState === 'missed') {
      startDate = '';
    } else {
      startDate = addCalendarDays(today, -1);
    }
  }
  if (startDate) {
    const earliest = days.length ? days.map((day) => day.date).sort()[0] : today;
    for (let date = startDate; date >= earliest; date = addCalendarDays(date, -1)) {
      if (!trackerActiveOnDate(tracker, date)) continue;
      if (!trackerScheduledOnDate(tracker, date)) continue;
      if (states.get(date) !== 'done') break;
      current++;
    }
  }
  let best = 0, run = 0;
  const earliest = days.length ? days.map((day) => day.date).sort()[0] : today;
  for (let date = earliest; date <= today; date = addCalendarDays(date, 1)) {
    if (!trackerActiveOnDate(tracker, date)) continue;
    if (!trackerScheduledOnDate(tracker, date)) continue;
    run = states.get(date) === 'done' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  best = Math.max(best, current);
  const weekStart = addCalendarDays(today, -6);
  let thisWeek = 0, unknown = 0;
  for (let date = weekStart; date <= today; date = addCalendarDays(date, 1)) {
    if (!trackerActiveOnDate(tracker, date) || !trackerScheduledOnDate(tracker, date)) continue;
    const state = states.get(date) ?? 'unrecorded';
    if (state === 'done') thisWeek++;
    else if (state === 'unrecorded') unknown++;
  }
  return { current, best, goal: 3, thisWeek, unknown };
}

export function weeklyStreak(days: DayRecord[], tracker: Tracker, goal: number, today = localDateKey()) {
  const states = new Map(days.filter(hasTrackedAction).map((day) => [day.date, day.states?.[tracker.id] && day.states?.[tracker.id] !== 'unrecorded' ? day.states[tracker.id] : 'missed']));
  const weekStart = (date: string) => addCalendarDays(date, -((dateFromKey(date).getDay() + 6) % 7));
  const thisStart = weekStart(today);
  const countWeek = (start: string) => {
    let done = 0, eligible = 0, unknown = 0, remaining = 0;
    for (let offset = 0; offset < 7; offset++) {
      const date = addCalendarDays(start, offset);
      if (!trackerActiveOnDate(tracker, date) || !trackerScheduledOnDate(tracker, date)) continue;
      if (date > today) { remaining++; continue; }
      eligible++;
      const state = states.get(date) ?? 'unrecorded';
      if (state === 'done') done++;
      if (state === 'unrecorded') unknown++;
    }
    return { done, eligible, unknown, achieved: done >= goal, failed: done + unknown + remaining < goal };
  };
  const thisWeek = countWeek(thisStart);
  let current = 0;
  let currentStart = thisStart;
  if (!thisWeek.achieved && !thisWeek.failed) currentStart = addCalendarDays(currentStart, -7);
  const first = weekStart(days.map((day) => day.date).sort()[0] ?? thisStart);
  for (let start = currentStart; start >= first; start = addCalendarDays(start, -7)) {
    const result = countWeek(start);
    if (result.achieved) current++;
    else if (result.failed) break;
    else break;
  }
  let best = current;
  let run = 0;
  for (let start = first; start <= thisStart; start = addCalendarDays(start, 7)) {
    const result = countWeek(start);
    if (result.achieved) { run++; best = Math.max(best, run); }
    else if (result.failed) run = 0;
  }
  return { current, best, ...thisWeek, goal };
}

export function customWeight(tracker: Tracker, trackers: Tracker[], weights: Record<string, number>) {
  const custom = trackers.filter((item) => !item.builtin && !item.archived);
  const total = custom.reduce((sum, item) => sum + Math.max(0, weights[item.id] ?? item.weight), 0);
  return total ? 15 * Math.max(0, weights[tracker.id] ?? tracker.weight) / total : 0;
}

export type ScoreHistoryPoint = { period: string; score: number | null };
export function weeklyScoreHistory(days: DayRecord[], trackers: Tracker[], preferences: Preferences, today = localDateKey()): ScoreHistoryPoint[] {
  const earliest = days.map((day) => day.date).sort()[0] ?? today;
  const weekday = dateFromKey(earliest).getDay();
  let start = addCalendarDays(earliest, -((weekday + 6) % 7));
  const points: ScoreHistoryPoint[] = [];
  for (; start <= today; start = addCalendarDays(start, 7)) points.push({ period: start, score: scorePeriod(days, trackers, preferences, start, 7).score });
  return points;
}
export function monthlyScoreHistory(days: DayRecord[], trackers: Tracker[], preferences: Preferences, today = localDateKey()): ScoreHistoryPoint[] {
  const earliest = days.map((day) => day.date).sort()[0] ?? today;
  const start = dateFromKey(earliest);
  let year = start.getFullYear(), month = start.getMonth() + 1;
  const end = dateFromKey(today);
  const endYear = end.getFullYear(), endMonth = end.getMonth() + 1;
  const points: ScoreHistoryPoint[] = [];
  while (year < endYear || year === endYear && month <= endMonth) {
    const key = `${year}-${String(month).padStart(2, '0')}-01`;
    const length = new Date(year, month, 0).getDate();
    points.push({ period: key, score: scorePeriod(days, trackers, preferences, key, length).score });
    month++; if (month > 12) { month = 1; year++; }
  }
  return points;
}
