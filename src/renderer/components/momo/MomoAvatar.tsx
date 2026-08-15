export type MomoState =
  | "calm"
  | "listening"
  | "thinking"
  | "waiting"
  | "happy"
  | "laugh"
  | "concern"
  | "sleepy"
  | "completed"
  | "curious";

export interface MomoAvatarProps {
  size?: number;
  state?: MomoState;
}

const faceOffsets: Record<MomoState, string | undefined> = {
  calm: undefined,
  listening: "translate(2 -1)",
  thinking: "translate(1 0)",
  waiting: undefined,
  happy: "translate(0 1)",
  laugh: "translate(0 1)",
  concern: "translate(-1 1)",
  sleepy: "translate(0 2)",
  completed: undefined,
  curious: "translate(-1 -1)",
};

function OpenEyes({ state }: { state: MomoState }) {
  const concerned = state === "concern";
  const curious = state === "curious";
  const waiting = state === "waiting";
  const leftY = concerned ? 63 : 62;
  const rightY = concerned ? 60.5 : 62;
  const leftRx = curious ? 4.2 : waiting ? 4.2 : 4.8;
  const rightRx = curious ? 5.2 : waiting ? 4.2 : 4.8;

  return (
    <g className={state === "thinking" ? undefined : "leemo-blink"}>
      <ellipse cx={45} cy={leftY} rx={leftRx} ry={waiting ? 5.7 : 6.4} fill="var(--leemo-momo-face)" />
      <ellipse cx={75} cy={rightY} rx={rightRx} ry={waiting ? 5.7 : 6.4} fill="var(--leemo-momo-face)" />
      <circle cx={46.7} cy={leftY - 2.4} r={1.7} fill="var(--leemo-momo-highlight)" />
      <circle cx={76.7} cy={rightY - 2.4} r={1.7} fill="var(--leemo-momo-highlight)" />
    </g>
  );
}

function Face({ state }: { state: MomoState }) {
  const closedEyes = state === "happy" || state === "laugh" || state === "sleepy";

  return (
    <g data-momo-expression={state} transform={faceOffsets[state]}>
      {closedEyes ? (
        <g fill="none" stroke="var(--leemo-momo-face)" strokeWidth={2.8} strokeLinecap="round">
          <path d={state === "sleepy" ? "M40 63c3 2.6 6 2.6 9 0" : "M39 64c3-4.5 8-4.5 11 0"} />
          <path d={state === "sleepy" ? "M70 63c3 2.6 6 2.6 9 0" : "M69 64c3-4.5 8-4.5 11 0"} />
        </g>
      ) : state === "thinking" ? (
        <>
          <path d="M39 63c3 2.2 7 2.2 10 0" fill="none" stroke="var(--leemo-momo-face)" strokeWidth={2.8} strokeLinecap="round" />
          <ellipse cx={75} cy={61} rx={4.8} ry={6.4} fill="var(--leemo-momo-face)" />
          <circle cx={76.7} cy={58.6} r={1.7} fill="var(--leemo-momo-highlight)" />
        </>
      ) : (
        <OpenEyes state={state} />
      )}

      <ellipse cx={32.5} cy={72.5} rx={5.6} ry={3.2} fill="var(--leemo-momo-blush)" opacity={state === "concern" ? 0.35 : 0.55} />
      <ellipse cx={87.5} cy={72.5} rx={5.6} ry={3.2} fill="var(--leemo-momo-blush)" opacity={state === "concern" ? 0.35 : 0.55} />

      {state === "laugh" ? (
        <>
          <path d="M53 71c2.4 7.5 11.6 7.5 14 0Z" fill="var(--leemo-momo-face)" />
          <path d="M57 76c2 1.2 4 1.2 6 0" fill="none" stroke="var(--leemo-momo-mouth-accent)" strokeWidth={1.6} strokeLinecap="round" />
        </>
      ) : state === "concern" ? (
        <path d="M54 76c2-2.6 4-3.8 6-3.8s4 1.2 6 3.8" fill="none" stroke="var(--leemo-momo-face)" strokeWidth={2.5} strokeLinecap="round" />
      ) : state === "thinking" ? (
        <path d="M55 74c3-1.5 7-1.5 10 0" fill="none" stroke="var(--leemo-momo-face)" strokeWidth={2.5} strokeLinecap="round" />
      ) : state === "waiting" || state === "sleepy" ? (
        <path d="M57 74h6" fill="none" stroke="var(--leemo-momo-face)" strokeWidth={2.4} strokeLinecap="round" />
      ) : state === "curious" ? (
        <ellipse cx={60} cy={74} rx={2.6} ry={3.2} fill="none" stroke="var(--leemo-momo-face)" strokeWidth={2.1} />
      ) : (
        <path d={state === "happy" ? "M53 71c4 6 10 6 14 0" : "M54 71.5c2 2.6 4 3.8 6 3.8s4-1.2 6-3.8"} fill="none" stroke="var(--leemo-momo-face)" strokeWidth={2.6} strokeLinecap="round" />
      )}
    </g>
  );
}

function Decoration({ state }: { state: MomoState }) {
  if (state === "completed") {
    return (
      <path
        data-momo-decoration="completed"
        className="leemo-momo-decoration leemo-twinkle"
        d="M97 18c.5 4.6 3.4 7.5 8 8-4.6.5-7.5 3.4-8 8-.5-4.6-3.4-7.5-8-8 4.6-.5 7.5-3.4 8-8Z"
        fill="var(--leemo-momo-signal)"
      />
    );
  }

  if (state === "waiting" || state === "thinking") {
    return (
      <g data-momo-decoration={state} className="leemo-momo-decoration" fill="var(--leemo-momo-muted)">
        <circle cx={94} cy={80} r={1.7} />
        <circle cx={101} cy={80} r={1.7} />
        <circle cx={108} cy={80} r={1.7} />
      </g>
    );
  }

  if (state === "sleepy") {
    return (
      <g data-momo-decoration="sleepy" className="leemo-momo-decoration" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <circle cx={67} cy={78} r={4.2} fill="var(--leemo-momo-sleep-bubble)" stroke="var(--leemo-momo-sleep-line)" strokeWidth={1.4} />
        <path d="M86 45h7l-7 8h7M96 34h8l-8 9h8" stroke="var(--leemo-momo-muted)" strokeWidth={2.4} />
      </g>
    );
  }

  return null;
}

/** Soft, message-readable momo avatar with one shared semantic state machine. */
export default function MomoAvatar({ size = 32, state = "calm" }: MomoAvatarProps) {
  const showDecoration = size >= 28;

  return (
    <span className={`leemo-momo leemo-momo--${state} relative inline-block`} style={{ width: size, height: size }} data-momo-state={state}>
      <span aria-hidden className="leemo-halo absolute rounded-full" style={{ inset: -(size * 0.214) }} />
      <span className="leemo-breathe relative block">
        <svg
          viewBox="0 0 120 120"
          width={size}
          height={size}
          role="img"
          aria-label="momo 的头像"
          data-momo-state={state}
          data-momo-expression={state}
        >
          <ellipse cx={60} cy={105} rx={25} ry={4.6} fill="var(--leemo-momo-shadow)" />
          <g className="leemo-momo-state-motion">
            <path
              d="M60 20C87 20 101 42 101 66c0 22-17 34-41 34s-41-12-41-34c0-24 14-46 41-46Z"
              fill="var(--leemo-momo-body)"
              stroke="var(--leemo-momo-outline)"
              strokeWidth={2.5}
            />
            <ellipse cx={45} cy={41} rx={13} ry={8} fill="var(--leemo-momo-highlight)" opacity={0.7} transform="rotate(-16 45 41)" />
            <Face state={state} />
          </g>
          {showDecoration ? <Decoration state={state} /> : null}
        </svg>
      </span>
    </span>
  );
}
