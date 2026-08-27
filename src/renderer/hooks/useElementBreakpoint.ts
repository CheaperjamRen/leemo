import { useEffect, useState, type RefObject } from "react";

function measuredWidth(element: HTMLElement | null): number {
  const width = element?.getBoundingClientRect().width ?? 0;
  return width > 0 ? width : window.innerWidth;
}

/** Observe a layout breakpoint without publishing every intermediate pixel to
 * React. Native CSS handles continuous resizing; owners rerender only when the
 * element actually crosses the boundary. */
export function useElementBelowWidth(
  ref: RefObject<HTMLElement | null>,
  breakpoint: number,
): boolean {
  const [below, setBelow] = useState(() => (
    typeof window === "undefined" ? false : window.innerWidth < breakpoint
  ));

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const publish = (width: number): void => {
      const next = width < breakpoint;
      setBelow((current) => current === next ? current : next);
    };
    publish(measuredWidth(element));

    if (typeof ResizeObserver === "undefined") {
      const update = () => publish(measuredWidth(element));
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      publish(typeof width === "number" && width > 0 ? width : measuredWidth(element));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [breakpoint, ref]);

  return below;
}
