import { useEffect, useRef, useState, useCallback } from "react";

/** Smart scroll: follow the streaming edge while pinned to the bottom; a manual
 *  scroll-up detaches follow (user reads history quietly); scrollToBottom
 *  re-attaches. New messages and newly pending interactions both trigger a
 *  follow scroll when the user is still at the bottom. */
export function useScrollFollow(dep: unknown, interactionDep?: unknown) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  }, []);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(near);
  }, []);

  useEffect(() => {
    if (atBottom) {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [atBottom, dep, interactionDep]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const keepVisibleEdgePinned = () => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight;
    };
    const observer = new ResizeObserver(keepVisibleEdgePinned);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return { containerRef, atBottom, scrollToBottom, onScroll };
}
