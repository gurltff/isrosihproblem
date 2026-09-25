import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { IconUpload } from "../components/Icons";
import { PageHead, StatusBadge } from "../components/ui";
import { api, templateUrl, type BatchMeta } from "../lib/api";
import { useData } from "../lib/data";
import { deltaText, limitText } from "../lib/format";

export default function Upload() {
  const { params, refresh } = useData();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchMeta[] | null>(null);

  const send = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.upload(file);
      setResult(r.batches);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <PageHead
        title="Upload lot data"
        lede="Add a CSV exported from the burn-in test station. A lot with only 0 h and 24 h readings gets its early-reject projections straight away."
        actions={
          <a className="btn" href={templateUrl} download>
            Download template
          </a>
        }
      />

      <div className="grid grid-main">
        <section className="stack">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              send(e.dataTransfer.files[0]);
            }}
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              minHeight: 260,
              border: `2px dashed ${drag ? "var(--teal)" : "var(--rule-strong)"}`,
              background: drag ? "var(--sky-soft)" : "var(--white)",
              transition: "background .15s, border-color .15s",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            <IconUpload size={36} />
            <h2>{busy ? "Reading the file…" : "Drop a CSV here"}</h2>
            <p className="muted small">or click to choose one (15 MB max)</p>
            <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => send(e.target.files?.[0])} />
          </label>

          {error && <div className="notice warn">{error}</div>}
          {result && (
            <section className="card">
              <div className="card-head">
                <h2>Imported</h2>
              </div>
              <div className="stack" style={{ gap: 12 }}>
                {result.map((b) => (
                  <div key={b.batch_id} className="spread" style={{ borderBottom: "1px solid var(--rule)", paddingBottom: 12 }}>
                    <div>
                      <b>{b.batch_id}</b>{" "}
                      <span className="small muted">
                        · {b.n} parts · read points {b.hours.join(", ")} h
                      </span>
                      <div className="row small" style={{ marginTop: 6, gap: 8 }}>
                        <StatusBadge status="REJECT" /> {b.counts.REJECT}
                        <StatusBadge status="REVIEW" /> {b.counts.REVIEW}
                        <StatusBadge status="PASS" /> {b.counts.PASS}
                      </div>
                    </div>
                    <Link className="btn small primary" to={`/detector?lot=${b.batch_id}`}>
                      Open
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Columns</h2>
          </div>
          <p className="small muted" style={{ marginBottom: 14 }}>
            One row per part per read point. Column names are matched loosely (e.g. <code>idss</code>, <code>vth</code>,{" "}
            <code>rdson</code> work). A 0 h baseline is required.
          </p>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td><code>batch_id</code></td>
                  <td className="small muted">Lot identifier (defaults to the file name)</td>
                </tr>
                <tr>
                  <td><code>component_id</code></td>
                  <td className="small muted">Part identifier within the lot</td>
                </tr>
                <tr>
                  <td><code>hour</code></td>
                  <td className="small muted">Read point: 0, 24, 96, 168 …</td>
                </tr>
                <tr>
                  <td><code>socket</code>, <code>serial</code>, <code>batch_date</code></td>
                  <td className="small muted">Optional; socket (e.g. B4) drives the chamber map</td>
                </tr>
                {params.map((p) => (
                  <tr key={p.key}>
                    <td><code>{p.key}</code></td>
                    <td className="small muted">
                      {p.label}; limit {limitText(p)}; delta {deltaText(p)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
