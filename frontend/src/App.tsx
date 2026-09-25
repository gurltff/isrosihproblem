import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import Chamber from "./pages/Chamber";
import Dashboard from "./pages/Dashboard";
import Detector from "./pages/Detector";
import Drift from "./pages/Drift";
import Heatmap from "./pages/Heatmap";
import Passport from "./pages/Passport";
import Report from "./pages/Report";
import Upload from "./pages/Upload";

// The camera page pulls in MediaPipe; load it only when visited.
const Inspect = lazy(() => import("./pages/Inspect"));

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

export default function App() {
  return (
    <Layout>
      <ScrollTop />
      <Suspense fallback={<Loading height={480} />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/detector" element={<Detector />} />
          <Route path="/drift" element={<Drift />} />
          <Route path="/heatmap" element={<Heatmap />} />
          <Route path="/chamber" element={<Chamber />} />
          <Route path="/passport/:lot/:cid" element={<Passport />} />
          <Route path="/inspect" element={<Inspect />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/report" element={<Report />} />
          <Route path="*" element={<div className="empty">Page not found.</div>} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
