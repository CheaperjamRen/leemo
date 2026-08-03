import { useEffect, useRef, useState, useCallback } from "react";

/** Smart scroll: follow the streaming edge while pinned to the bottom; a manual
 *  scroll-up detaches follow (user reads history quietly); scrollToBottom
 *  re-attaches. `dep` changing (new messages) triggers a follow scroll when
 *  still at bottom. */
export function useScrollFollow(dep: unknown) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  return { containerRef, atBottom, scrollToBottom, onScroll };
}
