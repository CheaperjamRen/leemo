import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./index.css";

// Keep the active theme explicit on the document root.  The settings surface
// can later change this attribute without making every page own a palette.
document.documentElement.dataset.theme ??= "white-copper";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
