/** Renders a Date as "M月D日 · 周X · HH:MM" for the buddy-shell date strip.
 *  Pure function of its argument so the format is unit-testable without timers. */
export function formatClock(d: Date): string {
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${week} · ${hh}:${mm}`;
}
