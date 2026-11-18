import { addCalendarDays, calendarDaysBetween, dateFromKey, localDateKey } from './dates';
import { hasTrackedAction, trackerEligibleOnDate, trackerState } from './score';
import type { DayRecord, Preferences, Tracker } from './types';

export type Recommendation = { id: string; text: string; evidence: string };
const COOLDOWN_DAYS = 14;

export function nextStepRecommendation(days: DayRecord[], trackers: Tracker[], preferences: Preferences, today = localDateKey()): Recommendation | null {
  const start = addCalendarDays(today, -6);
  const recent = days.filter((day) => day.date >= start && day.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  if (recent.length < 4) return null;
  const dismissed = preferences.dismissedRecommendations ?? {};
  const available = (id: string) => {
    const date = dismissed[id];
    return !date || calendarDaysBetween(date, today) >= COOLDOWN_DAYS;
  };

  const reading = trackers.find((tracker) => tracker.id === 'reading' && !tracker.archived);
  if (reading && available('reading')) {
    const readingDays = recent.filter((day) => hasTrackedAction(day) && trackerEligibleOnDate(reading, day.date));
    const done = readingDays.filter((day) => trackerState(day, reading.id, preferences) === 'done').length;
    const recorded = readingDays.length;
    if (recorded >= 4 && done <= 1) return { id: 'reading', evidence: `Reading · ${done} of ${recorded} logged days`, text: 'Try one 10-minute reading session tomorrow.' };
  }

  const focusDays = recent.filter((day) => day.focusMinutes != null);
  if (focusDays.length >= 3 && available('focus')) {
    const average = Math.round(focusDays.reduce((sum, day) => sum + (day.focusMinutes ?? 0), 0) / focusDays.length);
    if (average > 0) return { id: 'focus', evidence: `Focus · ${average} min average across ${focusDays.length} days`, text: 'Protect one focus block at a similar time tomorrow.' };
  }

  const previousStart = addCalendarDays(today, -13);
  const screenRecent = days.filter((day) => day.date >= start && day.date <= today && day.screenTimeMinutes != null);
  const screenPrevious = days.filter((day) => day.date >= previousStart && day.date < start && day.screenTimeMinutes != null);
  if (screenRecent.length >= 3 && screenPrevious.length >= 3 && available('screen-time')) {
    const recentAverage = Math.round(screenRecent.reduce((sum, day) => sum + (day.screenTimeMinutes ?? 0), 0) / screenRecent.length);
    const previousAverage = Math.round(screenPrevious.reduce((sum, day) => sum + (day.screenTimeMinutes ?? 0), 0) / screenPrevious.length);
    if (previousAverage > 0 && recentAverage >= previousAverage * 1.2) {
      const increase = Math.round((recentAverage / previousAverage - 1) * 100);
      return {
        id: 'screen-time',
        evidence: `Screen time · ${recentAverage} min average, up ${increase}% from last week`,
        text: 'Try one 15-minute phone-free block tomorrow.',
      };
    }
  }

  const learningDays = recent.filter((day) => (day.technicalLearningMinutes ?? 0) + (day.problemSolvingMinutes ?? 0) > 0);
  if (learningDays.length >= 2 && available('learning-note')) {
    const noted = learningDays.filter((day) => Boolean(day.learningNote?.trim())).length;
    if (noted < learningDays.length) return { id: 'learning-note', evidence: `Learning · ${learningDays.length} practice days`, text: 'Capture one useful idea in your learning note tomorrow.' };
  }

  for (const tracker of trackers.filter((item) => !item.builtin && !item.archived)) {
    const id = `tracker:${tracker.id}`;
    if (!available(id)) continue;
    const eligibleDays = recent.filter((day) => hasTrackedAction(day) && trackerEligibleOnDate(tracker, day.date));
    const done = eligibleDays.filter((day) => trackerState(day, tracker.id, preferences) === 'done').length;
    if (eligibleDays.length >= 4 && done === 0) {
      return { id, evidence: `${tracker.name} · 0 of ${eligibleDays.length} logged days`, text: `Try a smaller, easier version of ${tracker.name.toLowerCase()} tomorrow.` };
    }
  }
  return null;
}
