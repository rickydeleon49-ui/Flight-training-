import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// Self-hosted fonts: the desktop app must look right with no network.
// Fraunces carries the optical-size axis, so headings are optically adjusted
// at display sizes; Inter is latin-only, and the token stacks cover the rest.
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./components/ui/ui.css";
import "./styles/glass.css";

import { initAppearance } from "./lib/appearance";

// Apply appearance before initial render so restored theme appears without flash.
initAppearance();

const container = document.getElementById("root");
if (!container) throw new Error("Root element is missing from index.html");

// VISUAL-01b developer-only proof, reachable in browser dev mode (`npm run dev`)
// at /#/dev/visual-proof. Vite replaces import.meta.env.DEV with false in a
// production build, so this branch and its dynamic import are removed and the
// real app boots exactly as before.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window) && window.location.hash === "#/dev/visual-proof") {
  void import("./dev/VisualProof").then(({ default: VisualProof }) => {
    createRoot(container).render(
      <StrictMode>
        <VisualProof />
      </StrictMode>,
    );
  });
} else {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
