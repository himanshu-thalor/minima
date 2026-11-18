import { addCalendarDays } from './dates';
import type { Preferences, WeightEntry } from './types';

export const asDisplayWeight = (kg: number, unit: Preferences['weightUnit']) => {
  if (!Number.isFinite(kg)) return 0;
  return unit === 'lb' ? Number((kg * 2.2046226218).toFixed(1)) : Number(kg.toFixed(1));
};
export const asStoredKg = (value: number, unit: Preferences['weightUnit']) => {
  if (!Number.isFinite(value)) return 0;
  return unit === 'lb' ? value / 2.2046226218 : value;
};

export function buildWeightChartSeries(entries: WeightEntry[], unit: Preferences['weightUnit']) {
  const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (!ordered.length) return [] as { date: string; value: number | null }[];
  const byDate = new Map(ordered.map((entry) => [entry.date, asDisplayWeight(entry.kg, unit)]));
  const result: { date: string; value: number | null }[] = [];
  for (let date = ordered[0].date; date <= ordered.at(-1)!.date; date = addCalendarDays(date, 1)) {
    result.push({ date, value: byDate.get(date) ?? null });
  }
  return result;
}
