// Meetings are entered and shown in LA time, whatever timezone the phone or laptop is in,
// so a meeting booked from Utah before the trip doesn't shift by an hour.
export const TRIP_TIME_ZONE = "America/Los_Angeles";

// Minutes the zone is ahead of UTC at the given instant (negative for LA).
function zoneOffsetMinutes(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** "2026-10-27T14:30" (LA wall time) → ISO instant */
export function wallTimeToIso(wallTime: string, timeZone = TRIP_TIME_ZONE) {
  const naive = Date.parse(`${wallTime}:00Z`);
  let instant = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60000;
  // Re-check in case the guess landed on the other side of a DST change.
  instant = naive - zoneOffsetMinutes(new Date(instant), timeZone) * 60000;
  return new Date(instant).toISOString();
}

/** ISO instant → "2026-10-27T14:30" in LA wall time, for datetime-local inputs */
export function isoToWallTime(iso: string, timeZone = TRIP_TIME_ZONE) {
  const at = new Date(iso);
  return new Date(at.getTime() + zoneOffsetMinutes(at, timeZone) * 60000).toISOString().slice(0, 16);
}

export function nowWallTime() {
  return isoToWallTime(new Date().toISOString());
}

/** "2026-10-27" in LA, for grouping by day */
export function dayKey(iso: string) {
  return isoToWallTime(iso).slice(0, 10);
}

export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: TRIP_TIME_ZONE,
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: TRIP_TIME_ZONE, hour: "numeric", minute: "2-digit" });
}

export function formatDay(key: string) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "long", month: "short", day: "numeric",
  });
}
