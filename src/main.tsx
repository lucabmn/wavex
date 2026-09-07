import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_TAURI } from "./lib/clientRuntime";
import { initAppearance } from "./lib/appearance";
import "./index.css";

initAppearance();

// `getCurrentWindow` reads a bridge a browser tab does not have, so which
// client this is has to be settled before any Tauri API is touched at all — a
// throw here happens while the module evaluates, and nothing mounts.
if (!IS_TAURI) {
  void import("./browserBoot").then(({ mountBrowserApp }) => mountBrowserApp());
} else if (getCurrentWindow().label === "menu-bar") {
  document.getElementById("boot-splash")?.remove();
  void import("./surfaces/MenuBarApp").then(({ MenuBarApp }) => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <MenuBarApp />
      </React.StrictMode>,
    );
  });
} else {
  void import("./mainApp").then(({ mountMainApp }) => mountMainApp());
}
