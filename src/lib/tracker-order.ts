import { BUILTIN_TRACKERS, type Tracker } from './types';

export const MEAL_ORDER = ['breakfast', 'lunch', 'snacks', 'dinner'];

export function sortMealTrackers(trackers: Tracker[]) {
  return trackers.filter((tracker) => MEAL_ORDER.includes(tracker.id)).sort((a, b) => MEAL_ORDER.indexOf(a.id) - MEAL_ORDER.indexOf(b.id));
}

export function sortTrackersForSettings(trackers: Tracker[]) {
  return [...trackers].sort((a, b) => {
    const aMeal = MEAL_ORDER.indexOf(a.id), bMeal = MEAL_ORDER.indexOf(b.id);
    if (aMeal >= 0 || bMeal >= 0) {
      if (aMeal < 0) return 1;
      if (bMeal < 0) return -1;
      if (aMeal !== bMeal) return aMeal - bMeal;
    }
    const aIndex = a.builtin ? BUILTIN_TRACKERS.findIndex((item) => item.id === a.id) : Number.MAX_SAFE_INTEGER;
    const bIndex = b.builtin ? BUILTIN_TRACKERS.findIndex((item) => item.id === b.id) : Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex || a.name.localeCompare(b.name);
  });
}
