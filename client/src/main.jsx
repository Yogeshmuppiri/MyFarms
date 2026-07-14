import React from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import "./styles.css";

const isNativeApp = Capacitor.isNativePlatform();
const isStandaloneApp = window.matchMedia?.("(display-mode: standalone)")?.matches;
const isCustomerAppPreview = new URLSearchParams(window.location.search).get("app") === "customer";

if (isNativeApp || isStandaloneApp || isCustomerAppPreview) {
  document.documentElement.classList.add("native-app");
}

function showStartupFailure(reason) {
  console.error("My Farms startup failed:", reason);
  if (isNativeApp || isStandaloneApp || isCustomerAppPreview) return;
  const root = document.getElementById("root");
  if (!root || root.dataset.startupErrorShown === "true") return;
  if (root.dataset.appMounted === "true" || root.childElementCount > 0) return;
  root.dataset.startupErrorShown = "true";
  root.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:24px;color:#1f2e22;">
      <section style="max-width:420px;padding:22px;border:1px solid rgba(47,125,72,.22);border-radius:18px;background:rgba(255,255,255,.9);box-shadow:0 18px 50px rgba(31,46,34,.12);">
        <h1 style="margin:0 0 8px;font-size:22px;">My Farms needs a moment</h1>
        <p style="margin:0;color:#647067;line-height:1.5;">Please refresh the page and try again.</p>
      </section>
    </main>
  `;
}

window.addEventListener("error", (event) => {
  showStartupFailure(event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  showStartupFailure(event.reason);
});

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("My Farms app failed to render:", error, info);
    if (isNativeApp && this.state.retryCount < 3) {
      window.setTimeout(() => {
        this.setState((current) => ({
          error: null,
          retryCount: current.retryCount + 1
        }));
      }, 350);
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          color: "#1f2e22"
        }}
      >
        <section
          style={{
            maxWidth: "420px",
            padding: "22px",
            border: "1px solid rgba(47, 125, 72, 0.22)",
            borderRadius: "18px",
            background: "rgba(255, 255, 255, 0.9)",
            boxShadow: "0 18px 50px rgba(31, 46, 34, 0.12)"
          }}
        >
          <h1 style={{ margin: "0 0 8px", fontSize: "22px" }}>My Farms needs a moment</h1>
          <p style={{ margin: 0, color: "#647067", lineHeight: 1.5 }}>
            Please try again. Your cart and account state are still safe.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: "16px",
              border: 0,
              borderRadius: "12px",
              padding: "11px 16px",
              background: "#2f7d48",
              color: "#fff",
              fontWeight: 800
            }}
          >
            Try Again
          </button>
        </section>
      </main>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);

window.setTimeout(() => {
  const root = document.getElementById("root");
  if (root && root.children.length) {
    root.dataset.appMounted = "true";
  }
}, 0);

if ("serviceWorker" in navigator && import.meta.env.PROD && !isNativeApp) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
