import assert from 'node:assert/strict';
import test from 'node:test';
import { addCalendarDays, calendarDaysBetween, dateFromKey, localDateKey, mondayWeekStart } from '../src/lib/dates';
import { dailyStreak, monthlyScoreHistory, nutritionIntakeSummary, scorePeriod, trackerEligibleOnDate, trackerState, weeklyScoreHistory, weeklyStreak } from '../src/lib/score';
import { BUILTIN_TRACKERS, type DayRecord, type Preferences, type Tracker } from '../src/lib/types';
import { asDisplayWeight, asStoredKg, buildWeightChartSeries } from '../src/lib/weight';
import { MEAL_ORDER, sortMealTrackers, sortTrackersForSettings } from '../src/lib/tracker-order';
import { isValidDayChange } from '../src/lib/day-inputs';
import { summarizeLearning } from '../src/lib/learning';

const tracker = (id: string, weight = 1): Tracker => ({ id, name: id, group: 'Test', icon: 'sparkles', weight, color: '#fff', archived: false, builtin: true, schedule: [0,1,2,3,4,5,6] });
const preferences = (trackerWeights: Record<string, number>, scoreWeightHistory: Preferences['scoreWeightHistory'] = []): Preferences => ({
  theme: 'midnight', accent: '#c6e18b', calorieTarget: 2200, proteinTarget: 130, weightUnit: 'kg', trackerWeights,
  scoreWeightHistory, exPeriods: [],
});
const day = (date: string, states: Record<string, 'done' | 'missed' | 'unrecorded'>): DayRecord => ({ date, states, updatedAt: 1 });

test('meals keep the requested order on Today and in Settings', () => {
  const reversed = [...BUILTIN_TRACKERS].reverse();
  assert.deepEqual(sortMealTrackers(reversed).map((tracker) => tracker.id), MEAL_ORDER);
  assert.deepEqual(sortTrackersForSettings(reversed).slice(0, MEAL_ORDER.length).map((tracker) => tracker.id), MEAL_ORDER);
});

test('daily numeric entries reject values outside their real ranges', () => {
  assert.equal(isValidDayChange({ sleepHours: 24, focusMinutes: 1440, energy: 5, calories: 20000 }), true);
  assert.equal(isValidDayChange({ sleepHours: 25 }), false);
  assert.equal(isValidDayChange({ focusMinutes: -1 }), false);
  assert.equal(isValidDayChange({ energy: 0 }), false);
  assert.equal(isValidDayChange({ trackerValues: { stretch: -1 } }), false);
});

test('calendar day arithmetic crosses month and year boundaries without milliseconds', () => {
  assert.equal(addCalendarDays('2025-12-31', 1), '2026-01-01');
  assert.equal(addCalendarDays('2026-03-01', -1), '2026-02-28');
  assert.equal(calendarDaysBetween('2026-10-10', '2026-10-11'), 1);
  assert.equal(dateFromKey('2026-10-11').getHours(), 12);
  assert.match(localDateKey(dateFromKey('2026-10-11')), /^2026-10-11$/);
});

test('weekly focus uses the previous Monday-based calendar week', () => {
  assert.equal(mondayWeekStart('2026-10-12'), '2026-10-12');
  assert.equal(mondayWeekStart('2026-10-18'), '2026-10-12');
  assert.equal(addCalendarDays(mondayWeekStart('2026-10-12'), -7), '2026-10-05');
});

test('weekly learning recap counts recorded reading and real practice minutes only', () => {
  const reading = BUILTIN_TRACKERS.find((item) => item.id === 'reading')!;
  const days: DayRecord[] = [
    { date: '2026-10-06', states: { reading: 'done' }, readingMinutes: 20, technicalLearningMinutes: 15, updatedAt: 1 },
    { date: '2026-10-09', states: {}, problemSolvingMinutes: 30, updatedAt: 2 },
    { date: '2026-10-10', states: {}, readingMinutes: 0, updatedAt: 3 },
    { date: '2026-10-05', states: {}, technicalLearningMinutes: 60, updatedAt: 4 },
  ];
  assert.deepEqual(summarizeLearning(days, [reading], preferences({ reading: 1 }), '2026-10-06', '2026-10-12'), { days: 2, minutes: 65 });
  assert.deepEqual(summarizeLearning(days, [reading], preferences({ reading: 1 }), '2026-09-29', '2026-10-05'), { days: 1, minutes: 60 });
});

test('nutrition trend ignores partial days and compares real entries with targets', () => {
  const days: DayRecord[] = [
    { date: '2026-10-01', states: {}, calories: 2200, protein: 130, updatedAt: 1 },
    { date: '2026-10-02', states: {}, calories: 2000, protein: 145, updatedAt: 1 },
    { date: '2026-10-03', states: {}, calories: 2500, protein: 150, updatedAt: 1 },
    { date: '2026-10-04', states: {}, calories: 2100, updatedAt: 1 },
  ];
  const prefs = preferences({});
  assert.deepEqual(nutritionIntakeSummary(days, prefs), { recorded: 3, onTarget: 2, averageCalories: 2233, averageProtein: 142 });
  assert.deepEqual(nutritionIntakeSummary([], prefs), { recorded: 0, onTarget: 0, averageCalories: null, averageProtein: null });
});

test('nutrition goal changes apply from their effective date and preserve earlier scores', () => {
  const nutrition = tracker('nutrition');
  const prefs: Preferences = {
    ...preferences({ nutrition: 1 }), calorieTarget: 1800, proteinTarget: 100,
    nutritionTargetHistory: [
      { effectiveDate: '2026-10-01', calorieTarget: 2200, proteinTarget: 130 },
      { effectiveDate: '2026-10-02', calorieTarget: 1800, proteinTarget: 100 },
    ],
  };
  const days: DayRecord[] = [
    { date: '2026-10-01', states: {}, calories: 2200, protein: 130, updatedAt: 1 },
    { date: '2026-10-02', states: {}, calories: 2200, protein: 130, updatedAt: 1 },
  ];
  assert.equal(trackerState(days[0], 'nutrition', prefs), 'done');
  assert.equal(trackerState(days[1], 'nutrition', prefs), 'missed');
  assert.equal(scorePeriod(days, [nutrition], prefs, '2026-10-01', 2, 1, 0).score, 50);
  assert.deepEqual(nutritionIntakeSummary(days, prefs), { recorded: 2, onTarget: 1, averageCalories: 2200, averageProtein: 130 });
});

test('unrecorded habits on a logged day count as not done', () => {
  const trackers = [tracker('read'), tracker('move')];
  const days = [
    day('2026-10-01', { read: 'done', move: 'missed' }),
    day('2026-10-02', { read: 'done', move: 'unrecorded' }),
  ];
  const result = scorePeriod(days, trackers, preferences({ read: 1, move: 1 }), '2026-10-01');
  assert.equal(result.done, 2);
  assert.equal(result.missed, 2);
  assert.equal(result.recorded, 4);
  assert.equal(result.eligible, 14);
  assert.equal(result.coverage, 29);
  assert.equal(result.score, 50, 'the missing mark on a logged day counts as not done');
});

test('private context and intentions do not create missed habit states or reduce score coverage', () => {
  const trackers = [tracker('read'), tracker('move')];
  const contextOnly: DayRecord = { date: '2026-10-05', states: {}, intention: 'Take a quiet walk', mood: 'steady', energy: 4, focusMinutes: 30, updatedAt: 1 };
  const untouched = scorePeriod([contextOnly], trackers, preferences({ read: 1, move: 1 }), contextOnly.date, 1, 1, 25);
  assert.deepEqual([untouched.done, untouched.missed, untouched.recorded, untouched.coverage, untouched.score], [0, 0, 0, 0, null]);
  assert.equal(trackerState(contextOnly, 'read'), 'unrecorded');
  const oneCheckIn = scorePeriod([{ ...contextOnly, states: { read: 'done' } }], trackers, preferences({ read: 1, move: 1 }), contextOnly.date, 1, 1, 25);
  assert.deepEqual([oneCheckIn.done, oneCheckIn.missed, oneCheckIn.recorded, oneCheckIn.coverage, oneCheckIn.score], [1, 1, 2, 100, 50]);
});

test('score settings use the historical weight snapshot for each date', () => {
  const trackers = [tracker('read'), tracker('move')];
  const days = [
    day('2026-10-01', { read: 'done', move: 'missed' }),
    day('2026-10-02', { read: 'done', move: 'missed' }),
    day('2026-10-03', { read: 'missed', move: 'done' }),
    day('2026-10-04', { read: 'missed', move: 'done' }),
  ];
  const prefs = preferences({ read: 9, move: 1 }, [
    { effectiveDate: '2026-10-01', weights: { read: 1, move: 1 } },
    { effectiveDate: '2026-10-03', weights: { read: 9, move: 1 } },
  ]);
  const result = scorePeriod(days, trackers, prefs, '2026-10-01');
  assert.equal(result.recorded, 8);
  assert.equal(result.score, 17);
});

test('daily streak follows the configured schedule across year boundaries', () => {
  const reading = tracker('reading');
  const days = ['2025-12-30','2025-12-31','2026-01-01'].map((date) => day(date, { reading: 'done' }));
  const result = dailyStreak(days, reading, '2026-01-01');
  assert.equal(result.current, 3);
  assert.equal(result.best, 3);
});

test('weekly goals preserve an active streak while the current week is still possible', () => {
  const workout = tracker('workout');
  const days = ['2026-09-28','2026-09-29','2026-09-30','2026-10-05','2026-10-06']
    .map((date) => day(date, { workout: 'done' }));
  const result = weeklyStreak(days, workout, 3, '2026-10-11');
  assert.equal(result.done, 2);
  assert.equal(result.unknown, 5);
  assert.equal(result.current, 1);
  assert.equal(result.best, 1);
});

test('weight unit conversion round trips and chart series leaves missing dates blank', () => {
  assert.equal(asDisplayWeight(70, 'lb'), 154.3);
  assert.ok(Math.abs(asStoredKg(154.3, 'lb') - 70) < .1);
  const series = buildWeightChartSeries([
    { date: '2026-10-01', kg: 70, updatedAt: 1 },
    { date: '2026-10-03', kg: 69.8, updatedAt: 2 },
  ], 'kg');
  assert.deepEqual(series.map(({ date, value }) => [date, value]), [
    ['2026-10-01', 70], ['2026-10-02', null], ['2026-10-03', 69.8],
  ]);
});

test('archiving a tracker stops future eligibility while retaining old score records', () => {
  const archived = { ...tracker('custom'), builtin: false, archived: true, archivedAt: '2026-10-02' };
  const other = tracker('other');
  const days = [day('2026-10-01', { custom: 'done' }), day('2026-10-02', { custom: 'missed' })];
  const result = scorePeriod(days, [archived, other], preferences({ custom: 1, other: 1 }), '2026-10-01', 7, 1, 25);
  assert.equal(result.eligible, 9, 'the archived habit remains eligible only through the archive date');
  assert.equal(result.recorded, 4);
  assert.equal(result.score, 47);
});

test('score histories use Monday calendar weeks and calendar months', () => {
  const days: DayRecord[] = [
    { date: '2026-10-07', states: { reading: 'done' }, updatedAt: 1 },
    { date: '2026-11-02', states: {}, updatedAt: 2 },
  ];
  const trackers = [tracker('reading')];
  const prefs = preferences({ reading: 1 });
  assert.deepEqual(weeklyScoreHistory(days, trackers, prefs, '2026-11-04').map((item) => item.period), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  assert.deepEqual(monthlyScoreHistory(days, trackers, prefs, '2026-11-04').map((item) => item.period), ['2026-10-01', '2026-11-01']);
});

test('recommendation requires real history and respects dismissal cooldown', () => {
  const trackers = [tracker('reading')];
  const prefs = preferences({ reading: 1 });
  const days: DayRecord[] = ['2026-10-05','2026-10-06','2026-10-07','2026-10-08'].map((date) => ({ date, states: { anotherHabit: 'done' }, updatedAt: 1 }));
  const recommendation = nextStepRecommendation(days, trackers, prefs, '2026-10-11');
  assert.equal(recommendation?.id, 'reading');
  assert.equal(nextStepRecommendation(days, trackers, { ...prefs, dismissedRecommendations: { reading: '2026-10-11' } }, '2026-10-20'), null);
  assert.equal(nextStepRecommendation(days.slice(0, 2), trackers, prefs, '2026-10-11'), null);
});

test('recommendations use logged action days and can guide custom habits', () => {
  const custom = { ...tracker('stretch'), name: 'Stretch gently', builtin: false };
  const prefs = preferences({ stretch: 1 });
  const contextOnly = ['2026-10-05','2026-10-06','2026-10-07','2026-10-08'].map((date) => ({ date, states: {}, intention: 'Move with care', updatedAt: 1 }));
  assert.equal(nextStepRecommendation(contextOnly, [custom], prefs, '2026-10-11'), null);
  const actionDays = contextOnly.map((item) => ({ ...item, states: { other: 'done' as const } }));
  const suggestion = nextStepRecommendation(actionDays, [custom], prefs, '2026-10-11');
  assert.equal(suggestion?.id, 'tracker:stretch');
  assert.match(suggestion?.text ?? '', /smaller, easier version/i);
  assert.equal(nextStepRecommendation(actionDays, [custom], { ...prefs, dismissedRecommendations: { 'tracker:stretch': '2026-10-11' } }, '2026-10-12'), null);
});

test('screen-time next step compares complete observations across two weeks', () => {
  const days: DayRecord[] = [
    { date: '2026-09-29', states: {}, screenTimeMinutes: 120, updatedAt: 1 },
    { date: '2026-10-01', states: {}, screenTimeMinutes: 150, updatedAt: 1 },
    { date: '2026-10-04', states: {}, screenTimeMinutes: 150, updatedAt: 1 },
    { date: '2026-10-06', states: {}, screenTimeMinutes: 210, updatedAt: 1 },
    { date: '2026-10-08', states: {}, screenTimeMinutes: 240, updatedAt: 1 },
    { date: '2026-10-10', states: {}, screenTimeMinutes: 240, updatedAt: 1 },
    { date: '2026-10-12', states: {}, screenTimeMinutes: 270, updatedAt: 1 },
  ];
  const result = nextStepRecommendation(days, [], preferences({}), '2026-10-12');
  assert.equal(result?.id, 'screen-time');
  assert.equal(result?.evidence, 'Screen time · 240 min average, up 71% from last week');
  assert.match(result?.text ?? '', /15-minute phone-free block/);
});

test('screen-time recommendation needs at least three readings in both weeks', () => {
  const days: DayRecord[] = [
    { date: '2026-09-29', states: {}, screenTimeMinutes: 120, updatedAt: 1 },
    { date: '2026-10-01', states: {}, screenTimeMinutes: 150, updatedAt: 1 },
    { date: '2026-10-04', states: {}, screenTimeMinutes: 150, updatedAt: 1 },
    { date: '2026-10-06', states: {}, screenTimeMinutes: 210, updatedAt: 1 },
    { date: '2026-10-08', states: {}, screenTimeMinutes: 240, updatedAt: 1 },
  ];
  assert.equal(nextStepRecommendation(days, [], preferences({}), '2026-10-12'), null);
});
import { nextStepRecommendation } from '../src/lib/recommendations';

test('new habits and changed schedules affect scores only on their effective dates', () => {
  const custom = { ...tracker('custom'), builtin: false, createdAt: '2026-10-08', schedule: [4], scheduleHistory: [{ effectiveDate: '2026-10-10', schedule: [6] }] };
  const days: DayRecord[] = ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10'].map((date) => ({ date, states: {}, updatedAt: 1 }));
  const result = scorePeriod(days, [custom], preferences({ custom: 1 }), '2026-10-05', 7, 1, 0);
  assert.equal(result.eligible, 2, 'only Thursday before the schedule change and Saturday after it are eligible');
});

test('archiving then restoring a custom habit preserves its inactive historical interval', () => {
  const custom = { ...tracker('custom'), builtin: false, createdAt: '2026-10-01', schedule: [0,1,2,3,4,5,6], archiveHistory: [{ effectiveDate: '2026-10-04', archived: true }, { effectiveDate: '2026-10-08', archived: false }] };
  const days: DayRecord[] = ['2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'].map((date) => ({ date, states: {}, updatedAt: 1 }));
  const result = scorePeriod(days, [custom], preferences({ custom: 1 }), '2026-10-02', 8, 1, 0);
  assert.equal(result.eligible, 4);
});

test('tracker eligibility follows creation and the saved weekday schedule', () => {
  const custom = { ...tracker('custom'), builtin: false, createdAt: '2026-10-08', schedule: [4], scheduleHistory: [{ effectiveDate: '2026-10-10', schedule: [6] }] };
  assert.equal(trackerEligibleOnDate(custom, '2026-10-07'), false);
  assert.equal(trackerEligibleOnDate(custom, '2026-10-08'), true);
  assert.equal(trackerEligibleOnDate(custom, '2026-10-09'), false);
  assert.equal(trackerEligibleOnDate(custom, '2026-10-10'), true);
});


test('weekly streak keeps the preceding week at the start of a new week', () => {
  const workout = tracker('workout');
  const days = ['2026-10-05', '2026-10-07', '2026-10-09'].map((date) => day(date, { workout: 'done' }));
  const result = weeklyStreak(days, workout, 3, '2026-10-12');
  assert.equal(result.current, 1);
  assert.equal(result.failed, false);
  assert.equal(result.done, 0);
  assert.equal(result.unknown, 1, 'future opportunities do not appear as unknown past days');
});

test('weekly streak counts the first recorded calendar week even when logging began midweek', () => {
  const workout = tracker('workout');
  const days = ['2026-10-07', '2026-10-08', '2026-10-09'].map((date) => day(date, { workout: 'done' }));
  const result = weeklyStreak(days, workout, 3, '2026-10-12');
  assert.equal(result.current, 1);
  assert.equal(result.best, 1);
});
