export type LeemoMarkTone = "brand" | "one-color" | "reverse";

export interface LeemoMarkProps {
  size?: number;
  tone?: LeemoMarkTone;
  label?: string;
}

const upperBlock = "M12 4h25a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5h-9a8 8 0 0 0-8 8v10H9a5 5 0 0 1-5-5V12a8 8 0 0 1 8-8Z";
const lowerBlock = "M52 60H27a5 5 0 0 1-5-5V45a5 5 0 0 1 5-5h9a8 8 0 0 0 8-8V22h11a5 5 0 0 1 5 5v25a8 8 0 0 1-8 8Z";

export default function LeemoMark({ size = 24, tone = "brand", label }: LeemoMarkProps) {
  const blockFill = tone === "one-color" ? "currentColor" : tone === "reverse" ? "var(--leemo-brand-passage)" : "var(--leemo-brand-mark)";
  const passageFill = tone === "reverse" ? "var(--leemo-brand-mark)" : "var(--leemo-brand-passage)";
  const signalFill = tone === "one-color" ? "currentColor" : "var(--leemo-brand-signal)";

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-tone={tone}
    >
      {tone === "reverse" ? <rect data-mark-backdrop x={1} y={1} width={62} height={62} rx={14} fill="var(--leemo-brand-mark)" /> : null}
      <rect data-mark-passage x={19} y={19} width={26} height={26} rx={8} fill={passageFill} />
      <path data-mark-block d={upperBlock} fill={blockFill} />
      <path data-mark-block d={lowerBlock} fill={blockFill} />
      <rect data-mark-signal x={27} y={27} width={10} height={10} rx={2.25} fill={signalFill} />
    </svg>
  );
}
