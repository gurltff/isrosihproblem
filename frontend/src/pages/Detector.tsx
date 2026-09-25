import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ErrorBox, Loading, LotPicker, PageHead, RiskMeter, StatusBadge, useLot } from "../components/ui";
import { api, type Status } from "../lib/api";
import { useAsync } from "../lib/data";

type Filter = "ALL" | Status;

export function stripId(headline: string, id: string) {
  return headline.startsWith(id) ? headline.slice(id.length).replace(/^\s*/, "") : headline;
}

export default function Detector() {
  const [lot, setLot] = useLot();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [q, setQ] = useState("");
  const { data, error, loading } = useAsync(() => (lot ? api.batch(lot) : Promise.resolve(null)), [lot]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.components
      .filter((c) => filter === "ALL" || c.status === filter)
      .filter(
        (c) =>
          !needle ||
          c.component_id.toLowerCase().includes(needle) ||
          c.serial.toLowerCase().includes(needle) ||
          c.socket.toLowerCase().includes(needle) ||
          c.headline.toLowerCase().includes(needle)
      )
      .sort((a, b) => b.risk - a.risk || a.component_id.localeCompare(b.component_id));
  }, [data, filter, q]);

  const go = (cid: string) => nav(`/passport/${lot}/${cid}`);

  return (
    <>
      <PageHead
        eyebrow="Module A"
        title="Anomaly detector"
        lede={
          <>
            Robust z-scores against the lot median, plus an Isolation Forest over all parameters together. Parts can be flagged
            while still <em>inside</em> datasheet limits.
          </>
        }
        actions={<LotPicker value={lot} onChange={setLot} />}
      />

      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading height={420} />}
      {data && (
        <section className="card">
          <div className="spread" style={{ marginBottom: 18 }}>
            <div className="seg" role="tablist" aria-label="Filter by status">
              {(["ALL", "REJECT", "REVIEW", "PASS"] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)} role="tab">
                  {f === "ALL" ? `All ${data.n}` : `${f[0]}${f.slice(1).toLowerCase()} ${data.counts[f]}`}
                </button>
              ))}
            </div>
            <input
              className="input"
              placeholder="Search part, serial, socket, finding…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ flex: "1 1 220px", maxWidth: 340 }}
              aria-label="Search"
            />
          </div>

          <div className="table-wrap hide-sm">
            <table>
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Socket</th>
                  <th>Disposition</th>
                  <th>Risk</th>
                  <th>Finding</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.component_id} className="clickable" onClick={() => go(c.component_id)}>
                    <td>
                      <div className="strong">{c.component_id}</div>
                      <div className="small faint">{c.serial}</div>
                    </td>
                    <td className="num">{c.socket}</td>
                    <td>
                      <StatusBadge status={c.status} />
                      {c.early_reject && (
                        <div className="small" style={{ color: "var(--brick)", marginTop: 6, fontWeight: 600 }}>
                          Early reject
                        </div>
                      )}
                    </td>
                    <td>
                      <RiskMeter value={c.risk} status={c.status} />
                    </td>
                    <td className="small" style={{ maxWidth: 560, color: c.status === "PASS" ? "var(--ink-3)" : undefined }}>
                      {stripId(c.headline, c.component_id)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="show-sm stack" style={{ gap: 0 }}>
            {rows.map((c) => (
              <Link
                key={c.component_id}
                to={`/passport/${lot}/${c.component_id}`}
                style={{ padding: "14px 0", borderBottom: "1px solid var(--rule)", color: "inherit", textDecoration: "none" }}
              >
                <div className="spread">
                  <span>
                    <b style={{ color: "var(--navy)" }}>{c.component_id}</b>{" "}
                    <span className="small faint">· {c.socket}</span>
                  </span>
                  <StatusBadge status={c.status} />
                </div>
                <div style={{ margin: "8px 0" }}>
                  <RiskMeter value={c.risk} status={c.status} />
                </div>
                {c.status !== "PASS" && <p className="small muted">{stripId(c.headline, c.component_id)}</p>}
              </Link>
            ))}
          </div>

          {rows.length === 0 && <div className="empty">No parts match.</div>}
        </section>
      )}
    </>
  );
}
