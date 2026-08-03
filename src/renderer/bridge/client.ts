import type { BridgeInvokeMap, BridgeEventMap } from "../../bridge/contract";

/** The renderer's single seam to the bridge. First impl is FixtureBridgeClient;
 *  Phase-1 swaps in an IPC-backed impl with zero store/component change. */
export interface BridgeClient {
  invoke<K extends keyof BridgeInvokeMap>(
    channel: K,
    req: BridgeInvokeMap[K]["request"],
  ): Promise<BridgeInvokeMap[K]["response"]>;
  subscribe<K extends keyof BridgeEventMap>(
    channel: K,
    cb: (payload: BridgeEventMap[K]) => void,
  ): () => void;
}
