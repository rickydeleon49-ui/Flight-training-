import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// Brand face (Fraunces, latin only) is self-hosted: the app must look right offline.
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./components/ui/ui.css";
import "./styles/glass.css";

import { initIOSText } from "./lib/iosText";
import { initAppearance } from "./lib/appearance";
import { initTheme } from "./lib/theme";

// Apply appearance before initial render so restored theme appears without flash.
initAppearance();
initTheme();
initIOSText();

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
