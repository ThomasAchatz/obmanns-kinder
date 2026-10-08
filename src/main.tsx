import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./lib/auth";
import "./styles.css";
import "./skin-heft.css";
import "./skin-pop.css";
import { applySkin, readSkin } from "./lib/skin";

applySkin(readSkin());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
