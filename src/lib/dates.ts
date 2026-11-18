export const localDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const dateFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
};

export const addCalendarDays = (key: string, amount: number) => {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
};

export const mondayWeekStart = (key: string) => addCalendarDays(key, -((dateFromKey(key).getDay() + 6) % 7));

export const calendarDaysBetween = (start: string, end: string) => {
  const toUtc = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.max(0, Math.floor((toUtc(end) - toUtc(start)) / 86_400_000));
};

export const prettyDate = (key: string, options?: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, options ?? { weekday: 'long', month: 'long', day: 'numeric' }).format(dateFromKey(key));

export const shortDate = (key: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(dateFromKey(key));
