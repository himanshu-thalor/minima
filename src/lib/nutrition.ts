import type { DayRecord, FoodEntry } from './types';

type NutritionValues = NonNullable<DayRecord['nutritionBase']>;
const nutritionFields = ['calories', 'protein', 'carbs', 'fat'] as const;

export function foodTotals(entries: FoodEntry[]): NutritionValues {
  if (!entries.length) return {};
  return Object.fromEntries(nutritionFields.map((field) => [field, Number(entries.reduce((sum, entry) => sum + (entry[field] ?? 0), 0).toFixed(1))]));
}

export function nutritionBaseForDay(day?: Partial<DayRecord>): NutritionValues {
  if (day?.nutritionBase) return { ...day.nutritionBase };
  const logged = foodTotals(day?.foodEntries ?? []);
  return Object.fromEntries(nutritionFields.filter((field) => day?.[field] != null && (!day?.foodEntries?.length || day[field]! > (logged[field] ?? 0))).map((field) => [field, Number(Math.max(0, day![field]! - (logged[field] ?? 0)).toFixed(1))]));
}

export function nutritionTotals(day?: Partial<DayRecord>): NutritionValues {
  const base = nutritionBaseForDay(day);
  const logged = foodTotals(day?.foodEntries ?? []);
  return Object.fromEntries(nutritionFields.filter((field) => base[field] != null || logged[field] != null).map((field) => [field, Number(((base[field] ?? 0) + (logged[field] ?? 0)).toFixed(1))]));
}
