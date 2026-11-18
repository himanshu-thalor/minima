import type { DayRecord } from './types';

const dayNumberLimits: Partial<Record<keyof DayRecord, readonly [number, number]>> = {
  calories: [0, 20000], protein: [0, 2000], carbs: [0, 5000], fat: [0, 2000], sleepHours: [0, 24], energy: [1, 5],
  focusMinutes: [0, 1440], screenTimeMinutes: [0, 1440], readingMinutes: [0, 1440],
  communicationMinutes: [0, 1440], technicalLearningMinutes: [0, 1440], problemSolvingMinutes: [0, 1440],
};

export function isValidDayChange(change: Partial<DayRecord>) {
  for (const [key, [min, max]] of Object.entries(dayNumberLimits)) {
    const value = change[key as keyof DayRecord];
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) return false;
  }
  if (change.nutritionBase && (typeof change.nutritionBase !== 'object' || Array.isArray(change.nutritionBase) || (['calories', 'protein', 'carbs', 'fat'] as const).some((field) => { const value = change.nutritionBase![field]; return value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > dayNumberLimits[field]![1]); }))) return false;
  if (change.foodEntries && (!Array.isArray(change.foodEntries) || change.foodEntries.length > 200 || !change.foodEntries.every((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string' && Boolean(entry.id.trim() && entry.name.trim()) && ['breakfast', 'lunch', 'snacks', 'dinner', 'extra'].includes(entry.meal) && Number.isFinite(entry.calories) && entry.calories >= 0 && entry.calories <= 20000 && (entry.protein == null || Number.isFinite(entry.protein) && entry.protein >= 0 && entry.protein <= 2000) && (entry.carbs == null || Number.isFinite(entry.carbs) && entry.carbs >= 0 && entry.carbs <= 5000) && (entry.fat == null || Number.isFinite(entry.fat) && entry.fat >= 0 && entry.fat <= 2000) && (entry.portion == null || typeof entry.portion === 'string' && entry.portion.length <= 80)))) return false;
  if (change.mood != null && !['low', 'uneven', 'steady', 'good'].includes(change.mood)) return false;
  return !change.trackerValues || Object.values(change.trackerValues).every((value) => Number.isFinite(value) && value >= 0);
}
