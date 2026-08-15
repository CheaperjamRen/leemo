import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type AnchoredPlacement = "top-start" | "top-end" | "bottom-start" | "bottom-end";

interface RectLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export function placeAnchoredLayer({
  anchor,
  layer,
  viewport,
  preferred,
  gap = 8,
  padding = 8,
}: {
  anchor: RectLike;
  layer: { width: number; height: number };
  viewport: { width: number; height: number };
  preferred: AnchoredPlacement;
  gap?: number;
  padding?: number;
}): { top: number; left: number; placement: AnchoredPlacement } {
  const wantsBottom = preferred.startsWith("bottom");
  const alignEnd = preferred.endsWith("end");
  const spaceBelow = viewport.height - padding - anchor.bottom;
  const spaceAbove = anchor.top - padding;
  const shouldFlip = wantsBottom
    ? layer.height + gap > spaceBelow && spaceAbove > spaceBelow
    : layer.height + gap > spaceAbove && spaceBelow > spaceAbove;
  const onBottom = shouldFlip ? !wantsBottom : wantsBottom;
  const placement = `${onBottom ? "bottom" : "top"}-${alignEnd ? "end" : "start"}` as AnchoredPlacement;
  const naturalTop = onBottom
    ? anchor.bottom + gap
    : anchor.top - gap - layer.height;
  const naturalLeft = alignEnd
    ? anchor.right - layer.width
    : anchor.left;
  const maxTop = Math.max(padding, viewport.height - padding - layer.height);
  const maxLeft = Math.max(padding, viewport.width - padding - layer.width);
  return {
    top: Math.min(Math.max(naturalTop, padding), maxTop),
    left: Math.min(Math.max(naturalLeft, padding), maxLeft),
    placement,
  };
}

type AnchorSource = { current: HTMLElement | null } | (() => HTMLElement | null) | HTMLElement | null;

function resolveAnchor(source: AnchorSource): HTMLElement | null {
  if (typeof source === "function") return source();
  if (source && "current" in source) return source.current;
  return source;
}

export default function AnchoredLayer({
  open,
  anchor,
  children,
  onDismiss,
  preferred = "bottom-end",
  gap = 8,
  padding = 8,
  className = "",
  role = "dialog",
  ariaLabel,
}: {
  open: boolean;
  anchor: AnchorSource;
  children: ReactNode;
  onDismiss?: () => void;
  preferred?: AnchoredPlacement;
  gap?: number;
  padding?: number;
  className?: string;
  role?: "dialog" | "menu";
  ariaLabel?: string;
}): React.JSX.Element | null {
  const layerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; placement: AnchoredPlacement } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    const update = (): void => {
      const anchorElement = resolveAnchor(anchor);
      const layerElement = layerRef.current;
      if (!anchorElement || !layerElement) return;
      setPosition(placeAnchoredLayer({
        anchor: anchorElement.getBoundingClientRect(),
        layer: layerElement.getBoundingClientRect(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        preferred,
        gap,
        padding,
      }));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const anchorElement = resolveAnchor(anchor);
    if (anchorElement) observer?.observe(anchorElement);
    if (layerRef.current) observer?.observe(layerRef.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [anchor, gap, open, padding, preferred]);

  useEffect(() => {
    if (!open || !onDismiss) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onDismiss();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (layerRef.current?.contains(target) || resolveAnchor(anchor)?.contains(target)) return;
      onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [anchor, onDismiss, open]);

  if (!open || typeof document === "undefined") return null;
  const style: CSSProperties = {
    position: "fixed",
    top: position?.top ?? 0,
    left: position?.left ?? 0,
    visibility: position ? "visible" : "hidden",
  };
  return createPortal(
    <div
      ref={layerRef}
      role={role}
      aria-label={ariaLabel}
      data-anchored-layer=""
      data-placement={position?.placement ?? preferred}
      style={style}
      className={`z-[70] ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
