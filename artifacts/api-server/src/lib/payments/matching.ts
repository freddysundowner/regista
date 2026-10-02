export function reference(value: string) {
  return value.toUpperCase().replace(/[\s\-/.#]/g, "").replace(/^(?:ADMISSION|ADMNO|ADM|REG|NO)/, "").replace(/^0+(?=\d)/, "");
}
export function fullPhone(value: string | null | undefined) {
  if (!value || !/^\+?[\d\s()-]+$/.test(value)) return null;
  const local = value.replace(/[\s()-]/g, "").replace(/^(?:\+254|254|0)/, "");
  return /^[71]\d{8}$/.test(local) ? `254${local}` : null;
}
export function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}
export function jaroWinkler(a: string, b: string) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1), am = new Set<number>(), bm = new Set<number>();
  for (let i = 0; i < a.length; i++) for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
    if (!bm.has(j) && a[i] === b[j]) { am.add(i); bm.add(j); break; }
  }
  const matches = am.size;
  if (!matches) return 0;
  const aa = [...am].sort((x, y) => x - y).map(i => a[i]), bb = [...bm].sort((x, y) => x - y).map(i => b[i]);
  const transpositions = aa.filter((c, i) => c !== bb[i]).length / 2;
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro > 0.7 ? jaro + prefix * 0.1 * (1 - jaro) : jaro;
}
export type Candidate = { studentId: string; score: number; reasons: string[] };
export function choose(candidates: Candidate[], threshold: number) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.studentId.localeCompare(b.studentId));
  return { candidates: sorted.slice(0, 5), winner: sorted[0] && sorted[0].score >= threshold && (!sorted[1] || sorted[0].score > sorted[1].score) ? sorted[0].studentId : null };
}