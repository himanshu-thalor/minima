export type Completion = 'done' | 'missed' | 'unrecorded';
export type MoodLevel = 'low' | 'uneven' | 'steady' | 'good';
export const TRACKER_PILLARS = ['Physical health', 'Discipline & focus', 'Intellectual growth', 'Communication & well-being', 'Reflection & consistency'] as const;
export type TrackerPillar = typeof TRACKER_PILLARS[number];
export type Tracker = {
  id: string;
  name: string;
  group: string;
  icon: string;
  weight: number;
  color: string;
  archived: boolean;
  archivedAt?: string;
  builtin: boolean;
  schedule: number[];
  createdAt?: string;
  description?: string;
  target?: number;
  targetUnit?: string;
  scheduleHistory?: { effectiveDate: string; schedule: number[] }[];
  archiveHistory?: { effectiveDate: string; archived: boolean }[];
};
export type DayRecord = {
  date: string;
  states: Record<string, Completion>;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  foodEntries?: FoodEntry[];
  nutritionBase?: { calories?: number; protein?: number; carbs?: number; fat?: number };
  workoutNote?: string;
  sleepHours?: number;
  focusMinutes?: number;
  screenTimeMinutes?: number;
  readingMinutes?: number;
  communicationMinutes?: number;
  technicalLearningMinutes?: number;
  problemSolvingMinutes?: number;
  learningNote?: string;
  intention?: string;
  mood?: MoodLevel;
  energy?: number;
  trackerValues?: Record<string, number>;
  updatedAt: number;
};
export type FoodEntry = { id: string; name: string; meal: 'breakfast' | 'lunch' | 'snacks' | 'dinner' | 'extra'; portion?: string; calories: number; protein?: number; carbs?: number; fat?: number };
export type WeightEntry = { date: string; kg: number; updatedAt: number };
export type JournalEntry = { date: string; body: string; tags: string[]; updatedAt: number };
export type WeeklyReflection = { weekStart: string; whatWorked?: string; whatCouldBeEasier?: string; updatedAt: number };
export type ExPeriod = { id: string; startDate: string; endDate?: string };
export type ScoreWeightVersion = { effectiveDate: string; weights: Record<string, number> };
export type NutritionTargetVersion = { effectiveDate: string; calorieTarget: number; proteinTarget: number };
export type Preferences = {
  theme: 'midnight' | 'graphite' | 'amoled';
  accent: string;
  calorieTarget: number;
  proteinTarget: number;
  weightUnit: 'kg' | 'lb';
  weightGoalKg?: number;
  trackerWeights: Record<string, number>;
  scoreWeightHistory?: ScoreWeightVersion[];
  nutritionTargetHistory?: NutritionTargetVersion[];
  weeklyGoals?: Record<string, number>;
  dismissedRecommendations?: Record<string, string>;
  exPeriods: ExPeriod[];
};
export type PendingOperation = {
  id: string;
  table: string;
  recordKey: string;
  payload: unknown;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
};

export const BUILTIN_TRACKERS: Tracker[] = [
  { id: 'breakfast', name: 'Breakfast', group: 'Physical health', icon: 'sunrise', weight: 5, color: '#e8bd77', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
  { id: 'lunch', name: 'Lunch', group: 'Physical health', icon: 'sun', weight: 5, color: '#e8bd77', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
  { id: 'snacks', name: 'Snacks', group: 'Physical health', icon: 'cookie', weight: 5, color: '#e8bd77', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
  { id: 'dinner', name: 'Dinner', group: 'Physical health', icon: 'moon', weight: 5, color: '#e8bd77', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
  { id: 'nutrition', name: 'Nutrition targets', group: 'Physical health', icon: 'apple', weight: 15, color: '#e8bd77', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
  { id: 'weight', name: 'Weight check-in', group: 'Physical health', icon: 'scale', weight: 5, color: '#96b9a6', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
  { id: 'workout', name: 'Movement', group: 'Physical health', icon: 'dumbbell', weight: 20, color: '#96b9a6', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
  { id: 'communication', name: 'Communication', group: 'Communication & well-being', icon: 'message', weight: 10, color: '#c09ed2', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
  { id: 'reading', name: 'Reading', group: 'Intellectual growth', icon: 'book', weight: 10, color: '#c09ed2', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
  { id: 'bath', name: 'Took a bath', group: 'Physical health', icon: 'droplets', weight: 5, color: '#91b8c7', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] },
];

export const defaultPreferences = (today: string): Preferences => {
  const trackerWeights = Object.fromEntries(BUILTIN_TRACKERS.map((tracker) => [tracker.id, tracker.weight]));
  return {
    theme: 'midnight', accent: '#c6e18b', calorieTarget: 2200, proteinTarget: 130, weightUnit: 'kg', trackerWeights,
    scoreWeightHistory: [{ effectiveDate: today, weights: trackerWeights }],
    nutritionTargetHistory: [{ effectiveDate: today, calorieTarget: 2200, proteinTarget: 130 }], weeklyGoals: { workout: 3 },
    exPeriods: [{ id: crypto.randomUUID(), startDate: today }],
  };
};

export function trackerPillar(tracker: Tracker): TrackerPillar {
  if (tracker.builtin) {
    if (tracker.id === 'reading') return 'Intellectual growth';
    if (tracker.id === 'communication') return 'Communication & well-being';
    return 'Physical health';
  }
  return TRACKER_PILLARS.includes(tracker.group as TrackerPillar) ? tracker.group as TrackerPillar : 'Reflection & consistency';
}
