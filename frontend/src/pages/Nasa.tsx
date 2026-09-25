import { useEffect, useMemo, useState } from "react";
import { LineChart, niceTicks, type Series } from "../components/Charts";
import { ErrorBox, Loading, PageHead, Tile } from "../components/ui";
import { nasaApi, type NasaDevice } from "../lib/api";
import { useAsync } from "../lib/data";

const pp = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

export default function Nasa() {
  const { data, error, loading } = useAsync(() => nasaApi(), []);
  const [sel, setSel] = useState<number | null>(null);
  const [kind, setKind] = useState<"all" | "gradual" | "abrupt">("all");

  useEffect(() => {
    if (data?.available && sel === null) {
      // Open on a long gradual drifter: the case the predictor is built for.
      const g = data.devices.filter((d) => d.kind === "gradual").sort((a, b) => b.stress_min - a.stress_min)[0];
      setSel(g?.test ?? data.devices[0]?.test ?? null);
    }
  }, [data, sel]);

  const device = data?.devices.find((d) => d.test === sel);
  const list = useMemo(
    () => (data?.devices ?? []).filter((d) => kind === "all" || d.kind === kind),
    [data, kind]
  );

  if (error) return <ErrorBox error={error} />;
  if (loading || !data) return <Loading height={520} />;
  if (!data.available)
    return (
      <>
        <PageHead title="NASA ageing data" />
        <div className="notice">
          The NASA summary file is missing. Run <code>python backend/scripts/import_nasa_mosfet.py</code> once (it streams
          the public archive, about 7 GB, and keeps a 1 MB summary), then reload.
        </div>
      </>
    );

  const s = data.summary;
  return (
    <>
      <PageHead
        title="NASA ageing data"
        lede={
          <>
            The burn-in lots elsewhere in this app are synthetic. This page is not. It checks the drift predictor against{" "}
            {s.devices} real power MOSFETs that NASA aged by thermal overstress until they wore out ({s.stress_hours} stress
            hours across {s.runs} runs).
          </>
        }
      />

      <div className="stack stagger">
        <div className="ledger">
          <Tile dark label="Devices analysed" value={s.devices} note="with enough steady-state data" />
          <Tile
            label="Gradual drifters"
            value={s.error_gradual["50"].median_abs_error_pp ?? "—"}
            unit="pp"
            note={`median error at 50% of the run (${s.gradual} parts)`}
          />
          <Tile
            label="Abrupt failures"
            value={s.error_abrupt["50"].median_abs_error_pp ?? "—"}
            unit="pp"
            note={`same measure, ${s.abrupt} parts; no early drift to go on`}
          />
          <Tile label="Stress time" value={s.stress_hours} unit="h" note={`${s.runs} test runs`} />
        </div>

        <div className="grid grid-main">
          <section className="card">
            {device && <DeviceChart d={device} />}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Devices</h2>
              <div className="seg">
                {(["all", "gradual", "abrupt"] as const).map((k) => (
                  <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
                    {k === "all" ? "All" : k === "gradual" ? "Gradual" : "Abrupt"}
                  </button>
                ))}
              </div>
            </div>
            <div className="table-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th className="num">Hours</th>
                    <th className="num">Final ΔR</th>
                    <th className="num">Predicted</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((d) => (
                    <tr
                      key={d.test}
                      className="clickable"
                      onClick={() => setSel(d.test)}
                      style={d.test === sel ? { background: "var(--beige)" } : undefined}
                    >
                      <td>
                        <span className="mono strong">#{d.test}</span>{" "}
                        <span className="small faint">{d.kind}</span>
                      </td>
                      <td className="num mono">{(d.stress_min / 60).toFixed(1)}</td>
                      <td className="num mono">{pp(d.dr_final_pct)}</td>
                      <td className="num mono faint">{pp(d.predictions["50"])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">"Predicted" uses only the first half of that device's run.</p>
          </section>
        </div>

        <section className="card">
          <div className="card-head">
            <h2>How far ahead it can see</h2>
            <span className="small faint">median error in the final ΔR<sub>DS(on)</sub>, percentage points</span>
          </div>
          <div className="grid grid-2" style={{ gap: 32 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Share of run seen</th>
                    <th className="num">Gradual</th>
                    <th className="num">Abrupt</th>
                    <th className="num">All</th>
                  </tr>
                </thead>
                <tbody>
                  {["25", "50", "75"].map((k) => (
                    <tr key={k}>
                      <td>First {k}%</td>
                      <td className="num mono strong">{s.error_gradual[k]?.median_abs_error_pp ?? "—"}</td>
                      <td className="num mono">{s.error_abrupt[k]?.median_abs_error_pp ?? "—"}</td>
                      <td className="num mono faint">{s.error_all[k]?.median_abs_error_pp ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="small muted" style={{ lineHeight: 1.7 }}>
              <p>
                On parts that wear out gradually, the error drops steadily as the model sees more of the run. That is the
                behaviour the burn-in early-reject rule relies on.
              </p>
              <p style={{ marginTop: 10 }}>
                About half of NASA's devices failed differently: resistance stayed flat for hours and then stepped up (die-attach
                damage). Nothing in the early data gives that away, so no drift model will catch it. That is why the app
                also compares every part with its lot and inspects the surface, instead of relying on drift alone.
              </p>
            </div>
          </div>
        </section>

        <p className="small faint">
          Source: {data.source}. R<sub>DS(on)</sub> is taken as V<sub>DS</sub>/I<sub>D</sub> while the device conducts at its
          stress temperature, smoothed over 9 minutes and compared with the first 15 minutes of that device. The drift exponent
          for each device is learned from the other devices only.
        </p>
      </div>
    </>
  );
}

function DeviceChart({ d }: { d: NasaDevice }) {
  const hours = d.stress_min / 60;
  const ticks = niceTicks(0, hours, 5).filter((t) => t <= hours);
  const half = hours / 2;
  const series: Series[] = [
    {
      id: "fit",
      label: "Fitted on first half",
      color: "var(--teal)",
      dashed: true,
      points: d.fit.map((p) => ({ hour: p.t / 60, value: p.dr })),
    },
    {
      id: "dr",
      label: `Device #${d.test}`,
      color: "var(--navy)",
      width: 1.6,
      points: d.curve.map((p) => ({ hour: p.t / 60, value: p.dr })),
    },
  ];
  return (
    <div className="fade" key={d.test}>
      <div className="card-head">
        <h2>
          Device <span className="mono">#{d.test}</span>
        </h2>
        <span className="small muted">
          {d.runs} run{d.runs === 1 ? "" : "s"} · {hours.toFixed(1)} h at ~{Math.round(d.plateau_temp_C)} °C ·{" "}
          {d.kind === "abrupt" ? `abrupt step of ${d.max_step_pp} pp` : "gradual drift"}
        </span>
      </div>
      <LineChart
        series={series}
        xMax={hours}
        xTicks={ticks}
        xFormat={(h) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`}
        format={(v) => `${v.toFixed(0)}%`}
        vline={{ x: half, label: "model stops looking" }}
        height={300}
      />
      <div className="legend" style={{ marginTop: 12 }}>
        <span>
          <i className="swatch line" style={{ background: "var(--navy)" }} /> ΔR<sub>DS(on)</sub> from start of stress
        </span>
        <span style={{ color: "var(--teal)" }}>
          <i className="swatch dash" /> <span className="muted">Drift model, fitted on the first half</span>
        </span>
      </div>
      <p className="small" style={{ marginTop: 14 }}>
        Ended at <b>{pp(d.dr_final_pct)}</b>. From the first half alone the model expected <b>{pp(d.predictions["50"])}</b>
        {d.kind === "abrupt"
          ? ". The jump came without warning, so the miss is expected."
          : Math.abs((d.predictions["50"] ?? 0) - d.dr_final_pct) < 10
            ? ", close enough to make the call early."
            : "."}
      </p>
    </div>
  );
}
