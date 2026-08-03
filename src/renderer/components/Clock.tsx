import { useEffect, useState } from "react";
import { formatClock } from "./format-clock";

/** Live system clock for the date strip: date · weekday · time-to-minute.
 *  Ticks on a 30s interval (cheap; catches the minute rollover within ~30s)
 *  and clears it on unmount so no orphaned timer survives (Phase-1 lifecycle
 *  discipline). Replaces K3's hardcoded mock date. */
export default function Clock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return <p className={className}>{formatClock(now)}</p>;
}
