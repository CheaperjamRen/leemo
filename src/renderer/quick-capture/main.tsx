import { createRoot } from "react-dom/client";
import {
  IpcQuickCaptureClient,
  type LeemoQuickCaptureApi,
} from "../capture/client";
import QuickCaptureApp from "./QuickCaptureApp";

const api = (window as Window & { leemoQuickCapture?: LeemoQuickCaptureApi })
  .leemoQuickCapture;
const root = createRoot(document.getElementById("root")!);

if (api) {
  root.render(<QuickCaptureApp client={new IpcQuickCaptureClient(api)} />);
} else {
  root.render(
    <main className="quick-capture quick-capture--centered">
      <p className="quick-capture__load-error" role="alert">
        快捷便签未能连接到 Leemo，请重新打开应用。
      </p>
    </main>,
  );
}
