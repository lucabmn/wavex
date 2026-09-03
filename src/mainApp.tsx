import React, { useLayoutEffect } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import { handleQuitRequested, loadBootWorkspace } from "./lib/appLifecycle";
import { registerBuiltinHarnesses } from "./lib/harness";
import { bindActiveProfile, watchProfiles } from "./lib/profiles/profileStore";
import { initSounds } from "./lib/sounds";
import { consumeInstalledUpdate } from "./lib/updates/updateNotice";

function dismissBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.dataset.dismissed === "1") return;
  splash.dataset.dismissed = "1";
  const fade = () => {
    void invoke("enable_window_glass");
    splash.classList.add("boot-splash-out");
    window.setTimeout(() => splash.remove(), 180);
  };
  // useLayoutEffect runs before paint. Two frames later the app is on
  // screen, so the fade reveals UI instead of the desktop blur.
  requestAnimationFrame(() => {
    requestAnimationFrame(fade);
  });
}

function BootGate({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    dismissBootSplash();
  }, []);
  return children;
}

export function mountMainApp() {
  initSounds();
  // Before the workspace loads, not with the first render: restoring it asks
  // the adapters to rebuild any turn that kept running while this profile was
  // off screen, and an empty registry answers that nothing can.
  registerBuiltinHarnesses();
  void watchProfiles();
  void listen("quit_requested", () => {
    void handleQuitRequested();
  });

  // Nothing may read a session, note, or snapshot before the native stores are
  // pointed at this window's profile.
  void bindActiveProfile()
    .then(loadBootWorkspace)
    .then(({ windowTransfer, resumed, history, historyCwd }) => {
      const installedUpdate = windowTransfer ? null : consumeInstalledUpdate();
      ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
        <React.StrictMode>
          <BootGate>
            <App
              windowTransfer={windowTransfer}
              resumed={resumed}
              installedUpdate={installedUpdate}
              history={history}
              historyCwd={historyCwd}
            />
          </BootGate>
        </React.StrictMode>,
      );
    });
}
