import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { guardDomAgainstExtensions } from "./lib/domGuard";
import { STATIC } from "./lib/api";
import { DataProvider } from "./lib/data";

// Static hosts such as GitHub Pages cannot rewrite deep links, so use hash URLs there.
const Router = STATIC ? HashRouter : BrowserRouter;
import "./styles.css";

guardDomAgainstExtensions();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary resetKey="root">
      <Router>
        <DataProvider>
          <App />
        </DataProvider>
      </Router>
    </ErrorBoundary>
  </React.StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD && !STATIC) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
