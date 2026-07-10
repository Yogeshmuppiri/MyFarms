import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
const isStandaloneApp = window.matchMedia?.("(display-mode: standalone)")?.matches;
const isCustomerAppPreview = new URLSearchParams(window.location.search).get("app") === "customer";

if (isNativeApp || isStandaloneApp || isCustomerAppPreview) {
  document.documentElement.classList.add("native-app");
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
