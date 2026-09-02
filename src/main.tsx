import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initAppearance } from "./lib/appearance";
import "./index.css";

initAppearance();

if (getCurrentWindow().label === "menu-bar") {
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
