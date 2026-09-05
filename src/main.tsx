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

const container = document.getElementById("root");
if (!container) throw new Error("Root element is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
