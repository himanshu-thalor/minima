import type { DayRecord, JournalEntry, Preferences, Tracker, WeeklyReflection, WeightEntry } from './types';
import { dateFromKey } from './dates';

export type MinimaBackup = { format: 'minima-backup'; version: 1; exportedAt?: string; days: DayRecord[]; trackers: Tracker[]; weights: WeightEntry[]; journals: JournalEntry[]; weeklyReflections?: WeeklyReflection[]; preferences?: Preferences };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const dateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dateFromKey(value);
  return Number.isFinite(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4)) && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10));
};
const schedule = (value: unknown): value is number[] => Array.isArray(value) && value.length > 0 && value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(value).size === value.length;
const stringRecord = (value: unknown, allowed?: string[]) => object(value) && Object.values(value).every((entry) => typeof entry === 'string' && (!allowed || allowed.includes(entry)));
const numberRecord = (value: unknown) => object(value) && Object.values(value).every((entry) => finite(entry) && entry >= 0);
const scoreWeightRecord = (value: unknown) => numberRecord(value) && Object.values(value as Record<string, number>).every((entry) => entry <= 100);
const validOptionalNumber = (record: Record<string, unknown>, key: string, min: number, max: number) => record[key] == null || finite(record[key]) && Number(record[key]) >= min && Number(record[key]) <= max;
function validDay(value: unknown): value is DayRecord {
  if (!object(value) || !dateKey(value.date) || !stringRecord(value.states, ['done', 'missed', 'unrecorded']) || !finite(value.updatedAt)) return false;
  for (const [key, low, high] of [['calories',0,20000],['protein',0,2000],['carbs',0,5000],['fat',0,2000],['sleepHours',0,24],['focusMinutes',0,1440],['screenTimeMinutes',0,1440],['readingMinutes',0,1440],['communicationMinutes',0,1440],['technicalLearningMinutes',0,1440],['problemSolvingMinutes',0,1440],['energy',1,5]] as const) if (!validOptionalNumber(value, key, low, high)) return false;
  if (value.nutritionBase != null && (!object(value.nutritionBase) || !validOptionalNumber(value.nutritionBase, 'calories', 0, 20000) || !validOptionalNumber(value.nutritionBase, 'protein', 0, 2000) || !validOptionalNumber(value.nutritionBase, 'carbs', 0, 5000) || !validOptionalNumber(value.nutritionBase, 'fat', 0, 2000))) return false;
  if (value.foodEntries != null && (!Array.isArray(value.foodEntries) || value.foodEntries.length > 200 || !value.foodEntries.every((entry) => object(entry) && typeof entry.id === 'string' && Boolean(entry.id) && typeof entry.name === 'string' && Boolean(entry.name.trim()) && ['breakfast','lunch','snacks','dinner','extra'].includes(String(entry.meal)) && finite(entry.calories) && entry.calories >= 0 && entry.calories <= 20000 && (entry.protein == null || finite(entry.protein) && entry.protein >= 0 && entry.protein <= 2000) && (entry.carbs == null || finite(entry.carbs) && entry.carbs >= 0 && entry.carbs <= 5000) && (entry.fat == null || finite(entry.fat) && entry.fat >= 0 && entry.fat <= 2000) && (entry.portion == null || typeof entry.portion === 'string' && entry.portion.length <= 80)))) return false;
  if (value.mood != null && !['low','uneven','steady','good'].includes(String(value.mood))) return false;
  if (value.learningNote != null && typeof value.learningNote !== 'string' || value.workoutNote != null && typeof value.workoutNote !== 'string') return false;
  if (value.intention != null && (typeof value.intention !== 'string' || value.intention.length > 180)) return false;
  if (value.trackerValues != null && !numberRecord(value.trackerValues)) return false;
  return true;
}
function validTracker(value: unknown): value is Tracker {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name.trim() || typeof value.group !== 'string' || typeof value.icon !== 'string' || typeof value.color !== 'string' || typeof value.builtin !== 'boolean' || typeof value.archived !== 'boolean' || !finite(value.weight) || Number(value.weight) < 0 || !schedule(value.schedule)) return false;
  if (value.createdAt != null && !dateKey(value.createdAt) || value.archivedAt != null && !dateKey(value.archivedAt)) return false;
  if (value.description != null && typeof value.description !== 'string' || value.target != null && (!finite(value.target) || Number(value.target) < 0) || value.targetUnit != null && typeof value.targetUnit !== 'string') return false;
  if (value.scheduleHistory != null && (!Array.isArray(value.scheduleHistory) || !value.scheduleHistory.every((entry) => object(entry) && dateKey(entry.effectiveDate) && schedule(entry.schedule)))) return false;
  if (value.archiveHistory != null && (!Array.isArray(value.archiveHistory) || !value.archiveHistory.every((entry) => object(entry) && dateKey(entry.effectiveDate) && typeof entry.archived === 'boolean'))) return false;
  return true;
}
function validWeight(value: unknown): value is WeightEntry { return object(value) && dateKey(value.date) && finite(value.kg) && Number(value.kg) >= 25 && Number(value.kg) <= 350 && finite(value.updatedAt); }
function validJournal(value: unknown): value is JournalEntry { return object(value) && dateKey(value.date) && typeof value.body === 'string' && Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string') && finite(value.updatedAt); }
function validWeeklyReflection(value: unknown): value is WeeklyReflection { return object(value) && dateKey(value.weekStart) && finite(value.updatedAt) && (value.whatWorked == null || typeof value.whatWorked === 'string' && value.whatWorked.length <= 400) && (value.whatCouldBeEasier == null || typeof value.whatCouldBeEasier === 'string' && value.whatCouldBeEasier.length <= 400); }
function validPreferences(value: unknown): value is Preferences {
  if (!object(value) || !['midnight','graphite','amoled'].includes(String(value.theme)) || typeof value.accent !== 'string' || !finite(value.calorieTarget) || Number(value.calorieTarget) < 500 || Number(value.calorieTarget) > 10000 || !finite(value.proteinTarget) || Number(value.proteinTarget) < 10 || Number(value.proteinTarget) > 500 || !['kg','lb'].includes(String(value.weightUnit)) || !scoreWeightRecord(value.trackerWeights) || !Array.isArray(value.exPeriods)) return false;
  if (value.weightGoalKg != null && (!finite(value.weightGoalKg) || Number(value.weightGoalKg) < 25 || Number(value.weightGoalKg) > 350)) return false;
  if (!value.exPeriods.every((period) => object(period) && typeof period.id === 'string' && dateKey(period.startDate) && (period.endDate == null || dateKey(period.endDate)))) return false;
  if (value.scoreWeightHistory != null && (!Array.isArray(value.scoreWeightHistory) || !value.scoreWeightHistory.every((entry) => object(entry) && dateKey(entry.effectiveDate) && scoreWeightRecord(entry.weights)))) return false;
  if (value.nutritionTargetHistory != null && (!Array.isArray(value.nutritionTargetHistory) || !value.nutritionTargetHistory.every((entry) => object(entry) && dateKey(entry.effectiveDate) && finite(entry.calorieTarget) && Number(entry.calorieTarget) >= 500 && Number(entry.calorieTarget) <= 10000 && finite(entry.proteinTarget) && Number(entry.proteinTarget) >= 10 && Number(entry.proteinTarget) <= 500))) return false;
  if (value.weeklyGoals != null && !numberRecord(value.weeklyGoals)) return false;
  if (value.dismissedRecommendations != null && !object(value.dismissedRecommendations) || value.dismissedRecommendations != null && !Object.values(value.dismissedRecommendations as object).every(dateKey)) return false;
  return true;
}
export function parseMinimaBackup(text: string): MinimaBackup {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (!object(parsed) || parsed.format !== 'minima-backup' || parsed.version !== 1) throw new Error('This is not a supported Minima backup.');
  for (const key of ['days','trackers','weights','journals'] as const) if (!Array.isArray(parsed[key])) throw new Error(`Backup is missing the ${key} list.`);
  if (parsed.weeklyReflections != null && !Array.isArray(parsed.weeklyReflections)) throw new Error('Backup weekly reflections are invalid.');
  const checks = [['days', validDay], ['trackers', validTracker], ['weights', validWeight], ['journals', validJournal]] as const;
  for (const [key, check] of checks) {
    const bad = (parsed[key] as unknown[]).findIndex((entry) => !check(entry));
    if (bad >= 0) throw new Error(`Backup ${key} record ${bad + 1} is invalid.`);
  }
  if (parsed.weeklyReflections != null) {
    const bad = (parsed.weeklyReflections as unknown[]).findIndex((entry) => !validWeeklyReflection(entry));
    if (bad >= 0) throw new Error(`Backup weekly reflection ${bad + 1} is invalid.`);
  }
  if (parsed.preferences != null && !validPreferences(parsed.preferences)) throw new Error('Backup preferences are invalid.');
  return parsed as MinimaBackup;
}
