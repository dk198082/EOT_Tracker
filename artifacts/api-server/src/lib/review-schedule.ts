export function acceptanceCalendarDate(timeZone = "UTC", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function calculateReviewDueDate(acceptedDate: string, durations: number[]): string {
  const date = new Date(`${acceptedDate}T00:00:00Z`);
  // Calendar dates, not elapsed 24-hour periods: DST must not alter the deadline.
  const days = Math.ceil(durations.reduce((sum, weeks) => sum + weeks, 0) * 7 - 1e-9);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}