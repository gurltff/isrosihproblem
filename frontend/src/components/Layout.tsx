import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  IconCamera,
  IconChamber,
  IconDashboard,
  IconDetector,
  IconDrift,
  IconHeatmap,
  IconMore,
  IconReport,
  IconUpload,
} from "./Icons";

const NAV = [
  { group: "Overview" },
  { to: "/", label: "Batch health", icon: IconDashboard, end: true },
  { group: "Analysis" },
  { to: "/detector", label: "Anomaly detector", icon: IconDetector },
  { to: "/drift", label: "Drift predictor", icon: IconDrift },
  { to: "/heatmap", label: "Risk heatmap", icon: IconHeatmap },
  { to: "/chamber", label: "Chamber view", icon: IconChamber },
  { group: "Inspection" },
  { to: "/inspect", label: "Surface inspection", icon: IconCamera },
  { group: "Data" },
  { to: "/upload", label: "Upload lot data", icon: IconUpload },
  { to: "/report", label: "QA report", icon: IconReport },
] as const;

const TABS = [
  { to: "/", label: "Health", icon: IconDashboard, end: true },
  { to: "/detector", label: "Detector", icon: IconDetector },
  { to: "/chamber", label: "Chamber", icon: IconChamber },
  { to: "/inspect", label: "Inspect", icon: IconCamera },
];

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Sentinel home">
      <img src="/icon.svg" width={34} height={34} alt="" style={{ borderRadius: 9 }} />
      <span>
        <div className="brand-name">Sentinel</div>
        <div className="brand-sub">Burn-in intelligence</div>
      </span>
    </Link>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState(false);
  const { pathname } = useLocation();
  const moreActive = !TABS.some((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)));

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <nav className="nav" aria-label="Primary">
          {NAV.map((item, i) =>
            "group" in item ? (
              <div key={i} className="nav-group">
                {item.group}
              </div>
            ) : (
              <NavLink key={item.to} to={item.to} end={"end" in item ? item.end : false}>
                <item.icon size={18} />
                {item.label}
              </NavLink>
            )
          )}
        </nav>
        <div className="sidebar-foot">
          Lot-relative screening for
          <br />
          high-reliability components.
        </div>
      </aside>

      <header className="topbar">
        <Brand />
      </header>

      <main className="main">{children}</main>

      <nav className="tabbar" aria-label="Primary">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}>
            <t.icon size={20} />
            {t.label}
          </NavLink>
        ))}
        <button className={moreActive ? "active" : ""} onClick={() => setSheet(true)}>
          <IconMore size={20} />
          More
        </button>
      </nav>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grabber" />
            {NAV.filter((n) => "to" in n).map((n) =>
              "to" in n ? (
                <Link key={n.to} to={n.to} onClick={() => setSheet(false)}>
                  <n.icon size={20} />
                  {n.label}
                </Link>
              ) : null
            )}
          </div>
        </div>
      )}
    </div>
  );
}
