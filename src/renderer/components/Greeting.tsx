import MomoAvatar from "./momo/MomoAvatar";
import Clock from "./Clock";
import { useSettings } from "../bridge/context";
import { buildGreeting } from "../stores/settings";

export default function Greeting({ hour, memory }: { hour: number; memory?: string }) {
  const persona = useSettings((s) => s.persona);
  return (
    <div className="flex flex-col items-center py-8">
      {/* 实时系统时钟（日期·周几·时:分）；时段问候只由下方开场白承担，不重复 */}
      <Clock className="leemo-rise text-[12px] tracking-[.22em] text-[var(--leemo-ink-3)]" />
      <div className="leemo-rise mt-7" style={{ animationDelay: ".1s" }}>
        <MomoAvatar size={96} />
      </div>
      <h1
        className="serif leemo-rise mt-8 max-w-[600px] text-center text-[22px] leading-[2.05] text-[var(--leemo-ink)]"
        style={{ animationDelay: ".22s" }}
        data-persona={persona}
      >
        {buildGreeting(hour, memory)}
      </h1>
    </div>
  );
}
