const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^(\d{2}):(\d{2})$/;

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

export function dateInTimeZone(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addCalendarDays(date, days) {
  const match = datePattern.exec(date);
  if (!match) return "";
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function zonedDateTimeToIso(date, time, timeZone) {
  const dateMatch = datePattern.exec(date);
  const timeMatch = timePattern.exec(time);
  if (!dateMatch || !timeMatch) return "";

  const targetParts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  };
  const targetAsUtc = Date.UTC(
    targetParts.year,
    targetParts.month - 1,
    targetParts.day,
    targetParts.hour,
    targetParts.minute
  );

  if (!Number.isFinite(targetAsUtc)) return "";

  let instant = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedParts(new Date(instant), timeZone);
    const observedAsUtc = Date.UTC(
      Number(observed.year),
      Number(observed.month) - 1,
      Number(observed.day),
      Number(observed.hour),
      Number(observed.minute),
      Number(observed.second)
    );
    const adjustment = targetAsUtc - observedAsUtc;
    instant += adjustment;
    if (adjustment === 0) break;
  }

  const result = new Date(instant);
  const verified = zonedParts(result, timeZone);
  if (Object.entries(targetParts).some(([part, value]) => Number(verified[part]) !== value)) return "";
  return result.toISOString();
}