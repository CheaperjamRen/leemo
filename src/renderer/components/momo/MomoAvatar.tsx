/** Full momo face transcribed from k3/buddy-mode.html, plus breathe/blink/
 *  twinkle animations and a warm halo base (F-01 §6 contrast fix): the halo
 *  scales with `size` so the light body silhouette stays readable on light
 *  backgrounds at every size — including 26px in the message list. */
export default function MomoAvatar({ size = 32 }: { size?: number }) {
  return (
    <span className="relative inline-block" style={{ width: size, height: size }}>
      <span aria-hidden className="leemo-halo absolute rounded-full" style={{ inset: -(size * 0.214) }} />
      <span className="leemo-breathe relative block">
        <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="momo 的头像">
          <ellipse cx={60} cy={105} rx={25} ry={4.6} style={{ fill: "rgba(120,90,40,.10)" }} />
          <path
            d="M60 20C87 20 101 42 101 66c0 22-17 34-41 34s-41-12-41-34c0-24 14-46 41-46Z"
            style={{ fill: "var(--leemo-momo-body)", stroke: "var(--leemo-momo-line)", strokeWidth: 2.5 }}
          />
          <ellipse cx={45} cy={41} rx={13} ry={8} style={{ fill: "var(--leemo-momo-hi)" }} opacity={0.7} transform="rotate(-16 45 41)" />
          <g className="leemo-blink">
            <ellipse cx={45} cy={62} rx={4.8} ry={6.4} style={{ fill: "var(--leemo-momo-face)" }} />
            <ellipse cx={75} cy={62} rx={4.8} ry={6.4} style={{ fill: "var(--leemo-momo-face)" }} />
            <circle cx={46.7} cy={59.6} r={1.7} style={{ fill: "var(--leemo-momo-hi)" }} />
            <circle cx={76.7} cy={59.6} r={1.7} style={{ fill: "var(--leemo-momo-hi)" }} />
          </g>
          <ellipse cx={32.5} cy={72.5} rx={5.6} ry={3.2} style={{ fill: "var(--leemo-momo-blush)", opacity: 0.55 }} />
          <ellipse cx={87.5} cy={72.5} rx={5.6} ry={3.2} style={{ fill: "var(--leemo-momo-blush)", opacity: 0.55 }} />
          <path
            d="M54 71.5c2 2.6 4 3.8 6 3.8s4-1.2 6-3.8"
            style={{ fill: "none", stroke: "var(--leemo-momo-face)", strokeWidth: 2.6, strokeLinecap: "round" }}
          />
          <path
            className="leemo-twinkle"
            d="M97 21c.5 4.6 3.4 7.5 8 8-4.6.5-7.5 3.4-8 8-.5-4.6-3.4-7.5-8-8 4.6-.5 7.5-3.4 8-8Z"
            style={{ fill: "var(--leemo-momo-spark)" }}
          />
        </svg>
      </span>
    </span>
  );
}
