/** Instants are stored as UTC by the API and rendered in the viewer's browser zone. */
export function viewerTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const parse = (value: string) => new Date(dateOnly.test(value) ? `${value}T12:00:00` : value);

export function fmtDate(value?: string | null): string {
  if (!value) return "—";
  const date = parse(value);
  return Number.isNaN(+date) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
export function fmtDateTime(value?: string | null): string {
  if (!value) return "—";
  if (dateOnly.test(value)) return fmtDate(value);
  const date = parse(value);
  return Number.isNaN(+date) ? value : date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function fmtTime(value: string): string {
  const date = parse(value);
  return Number.isNaN(+date) ? value : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
export function localDay(value: string): string {
  const date = parse(value);
  return Number.isNaN(+date) ? value : date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
/** Stable YYYY-MM-DD in the viewer's zone, independent of locale date ordering. */
export function localDateKey(value: string | Date = new Date()): string {
  if (typeof value === "string" && dateOnly.test(value)) return value;
  const date = typeof value === "string" ? parse(value) : value;
  if (Number.isNaN(+date)) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const localToday = () => localDateKey();

/** datetime-local has no offset: interpret it on the viewer's device, then send UTC. */
export function localInputToUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error("Enter a valid local date and time.");
  const date = new Date(value);
  const actual = `${localDateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (Number.isNaN(+date) || actual !== value.slice(0, 16)) throw new Error("This local time does not exist. Choose another time.");
  return date.toISOString();
}
