import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import Chamber from "./pages/Chamber";
import Dashboard from "./pages/Dashboard";
import Detector from "./pages/Detector";
import Drift from "./pages/Drift";
import Heatmap from "./pages/Heatmap";
import Nasa from "./pages/Nasa";
import Passport from "./pages/Passport";
import Report from "./pages/Report";
import Upload from "./pages/Upload";

// The camera page pulls in MediaPipe; load it only when visited.
const Inspect = lazy(() => import("./pages/Inspect"));

// Fetch the camera page's code in the background so it opens instantly too.
const idle = (cb: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(cb) : setTimeout(cb, 1500));
idle(() => void import("./pages/Inspect"));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export default function App() {
  const { pathname } = useLocation();
  return (
    <Layout>
      <ScrollTop />
      <Suspense fallback={<Loading height={480} />}>
        <ErrorBoundary resetKey={pathname}>
        <div className="page" key={pathname}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/detector" element={<Detector />} />
          <Route path="/drift" element={<Drift />} />
          <Route path="/heatmap" element={<Heatmap />} />
          <Route path="/chamber" element={<Chamber />} />
          <Route path="/nasa" element={<Nasa />} />
          <Route path="/passport/:lot/:cid" element={<Passport />} />
          <Route path="/inspect" element={<Inspect />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/report" element={<Report />} />
          <Route path="*" element={<div className="empty">Page not found.</div>} />
        </Routes>
        </div>
        </ErrorBoundary>
      </Suspense>
    </Layout>
  );
}
