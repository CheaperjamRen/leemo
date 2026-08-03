import { useEffect, useState } from "react";
import type { BrowserCaptureRef } from "../../../bridge/contract";
import { useBridgeClient } from "../../bridge/context";

export default function BrowserCapturePreview({ capture }: { capture: BrowserCaptureRef }) {
  const client = useBridgeClient();
  const [src, setSrc] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    setSrc(undefined);
    setUnavailable(false);
    if (!client) {
      setUnavailable(true);
      return () => { active = false; };
    }
    void client.invoke("bridge:readBrowserCapture", { id: capture.id })
      .then((payload) => {
        if (!active) return;
        if (payload) setSrc(`data:${payload.mimeType};base64,${payload.dataBase64}`);
        else setUnavailable(true);
      })
      .catch(() => { if (active) setUnavailable(true); });
    return () => { active = false; };
  }, [capture.id, client]);

  if (unavailable) {
    return <p className="mt-2 text-[11px] text-[var(--leemo-ink-3)]">这张临时截图已不可用</p>;
  }
  if (!src) {
    return <div className="mt-2 h-20 animate-pulse rounded-[6px] bg-[var(--leemo-side-hover)]" aria-label="正在加载浏览器截图" />;
  }
  return (
    <img
      src={src}
      alt="浏览器截图"
      className="mt-2 max-h-56 w-full rounded-[6px] border border-[var(--leemo-line-soft)] bg-white object-contain"
    />
  );
}
