import { trackerState } from './score';
import type { DayRecord, Preferences, Tracker } from './types';

export function summarizeLearning(days: DayRecord[], trackers: Tracker[], preferences: Preferences, startDate: string, endDate: string) {
  const reading = trackers.find((tracker) => tracker.id === 'reading' && !tracker.archived);
  const activeDays = days.filter((day) => {
    if (day.date < startDate || day.date > endDate) return false;
    const minutes = (day.readingMinutes ?? 0) + (day.technicalLearningMinutes ?? 0) + (day.problemSolvingMinutes ?? 0);
    return minutes > 0 || Boolean(reading && trackerState(day, reading.id, preferences) === 'done');
  });
  const minutes = activeDays.reduce((total, day) => total + (day.readingMinutes ?? 0) + (day.technicalLearningMinutes ?? 0) + (day.problemSolvingMinutes ?? 0), 0);
  return { days: activeDays.length, minutes };
}
