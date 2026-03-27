import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

function yyyymmdd(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
function dateInputValue(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function firstDayOfMonthStr(s) { return `${s.slice(0,4)}${s.slice(4,6)}01`; }
function lastDayOfMonthStr(s) {
  const y = +s.slice(0,4), m = +s.slice(4,6);
  const d = new Date(y, m, 0);
  const p = (n) => String(n).padStart(2,"0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
}
const fmt = (n) => Number(n).toLocaleString("uk-UA", { minimumFractionDigits:0, maximumFractionDigits:0 });

export default function App() {
  const today = useMemo(() => yyyymmdd(), []);
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [daySales, setDaySales] = useState([]);
  const [avgPerMonthMap, setAvgPerMonthMap] = useState({});
  const [barData, setBarData] = useState(null);
  const [upsellLoading, setUpsellLoading] = useState(false);
  const [upsellData, setUpsellData] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  const shotsOverride = useMemo(() => new Map([
    [230,1],[485,1],[307,2],[231,1],[316,1],[406,1],[183,1],[182,1],[317,1],
    [425,1],[424,1],[441,1],[422,1],[423,2],
    [529,1],[530,1],[531,2],[533,1],[534,1],[535,1],
  ]), []);

  const fetchJson = useCallback(async (url) => {
    const r = await fetch(url);
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status}: ${t.slice(0,200)}`);
    return JSON.parse(t || "{}");
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true); setError("");
    setUpsellLoading(true);

    try {
      const mFrom = firstDayOfMonthStr(date), mTo = lastDayOfMonthStr(date);
      const dDay = await fetchJson(`${API_BASE}/api/waiters-sales?dateFrom=${date}&dateTo=${date}`);
      const dayList = Array.isArray(dDay?.response) ? dDay.response : [];
      const dMonth = await fetchJson(`${API_BASE}/api/waiters-sales?dateFrom=${mFrom}&dateTo=${mTo}`);
      const monthList = Array.isArray(dMonth?.response) ? dMonth.response : [];
      const avgMap = {};
      for (const w of monthList) {
        const rev = Number(w.revenue||0)/100, ch = Number(w.clients||0);
        avgMap[w.user_id] = ch > 0 ? rev/ch : 0;
      }
      setDaySales(dayList); setAvgPerMonthMap(avgMap);
      setLastUpdated(new Date());
    } catch(e) { setError("Помилка завантаження"); setDaySales([]); }
    finally { setLoading(false); }

    try {
      const dBar = await fetchJson(`${API_BASE}/api/bar-sales?dateFrom=${date}&dateTo=${date}`);
      const patched = { ...dBar };
      if (patched?.coffee && Array.isArray(patched.coffee.by_product)) {
        let tQ=0, tZ=0;
        const bp = patched.coffee.by_product.map((row) => {
          const pid = Number(row.product_id), qty = Number(row.qty||0);
          const per = shotsOverride.has(pid) ? shotsOverride.get(pid) : Number(row.zakladki_per_unit||0);
          const zak = qty*per; tQ+=qty; tZ+=zak;
          return { ...row, zakladki_per_unit:per, zakladki_total:zak };
        });
        patched.coffee = { ...patched.coffee, total_qty:tQ, total_zakladki:tZ, by_product:bp };
      }
      setBarData(patched);
    } catch(e) { setBarData(null); }

    try {
      const dU = await fetchJson(`${API_BASE}/api/upsell-sales?dateFrom=${date}&dateTo=${date}`);
      setUpsellData(Array.isArray(dU?.response) ? dU.response : []);
    } catch(e) { setUpsellData([]); }
    finally { setUpsellLoading(false); }

  }, [date, fetchJson, shotsOverride]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { const id = setInterval(loadAll, 5*60*1000); return () => clearInterval(id); }, [loadAll]);

  const totals = useMemo(() => {
    const rev = daySales.reduce((s,w) => s+Number(w.revenue||0)/100, 0);
    const ch = daySales.reduce((s,w) => s+Number(w.clients||0), 0);
    return { rev, ch, avg: ch>0?rev/ch:0 };
  }, [daySales]);

  const barCats = useMemo(() => {
    const arr = Array.isArray(barData?.categories) ? barData.categories : [];
    const map = new Map(arr.map((x) => [Number(x.category_id), x]));
    const pick = (id, name) => ({ id, name, qty: Number(map.get(id)?.qty||0) });
    return [pick(9,"Пиво"), pick(14,"Холодні"), pick(34,"Коктейлі")];
  }, [barData]);

  const coffeeSplit = useMemo(() => {
    const by = Array.isArray(barData?.coffee?.by_product) ? barData.coffee.by_product : [];
    const s34 = new Set([230,485,307,231,316,406,183,182,317,425,424,441,422,423]);
    const s47 = new Set([529,530,531,533,534,535]);
    const sum = (set) => by.reduce((a,r) => !set.has(Number(r.product_id)) ? a : {qty:a.qty+Number(r.qty||0), zak:a.zak+Number(r.zakladki_total||0)}, {qty:0,zak:0});
    return { hall:sum(s34), staff:sum(s47), total:{qty:barData?.coffee?.total_qty||0, zak:barData?.coffee?.total_zakladki||0} };
  }, [barData]);

  // FIX: правильный расчёт Разом для upsell
  const upsellTotals = useMemo(() => ({
    day: upsellData.reduce((s,r) => s + Number(r.day_sum||0), 0),
    month: upsellData.reduce((s,r) => s + Number(r.month_sum||0), 0),
  }), [upsellData]);

  const isLoading = loading || upsellLoading;
  const showMain = !loading && daySales.length > 0;

  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString("uk-UA", { hour:"2-digit", minute:"2-digit" })
    : "--:--";

  return (
    <div style={{
      width: "100vw",
      height: "100vh",
      overflow: "hidden",
      background: "linear-gradient(135deg, #0a0e1a 0%, #0d1529 50%, #0a1020 100%)",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      display: "flex",
      flexDirection: "column",
      padding: "6px",
      gap: "5px",
      boxSizing: "border-box",
      color: "#fff",
    }}>

      {/* ═══ HEADER ═══ */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        padding: "5px 10px",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: isLoading ? "#f59e0b" : "#10b981",
            boxShadow: `0 0 6px ${isLoading ? "#f59e0b" : "#10b981"}`,
          }} />
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "0.05em", color: "#e2e8f0" }}>
            GRECO · ЗМІНА
          </span>
          <span style={{ fontSize: 11, color: "#64748b" }}>{dateInputValue(date)}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: 10, color: "#475569" }}>оновлено {timeStr}</span>
          <input
            type="date"
            style={{
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6, color: "#cbd5e1", fontSize: 11, padding: "3px 6px",
              outline: "none",
            }}
            value={dateInputValue(date)}
            onChange={(e) => setDate(e.target.value.replaceAll("-",""))}
          />
          <button onClick={loadAll} disabled={isLoading} style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "4px 10px", borderRadius: 6, border: "none",
            background: isLoading ? "rgba(59,130,246,0.3)" : "rgba(59,130,246,0.8)",
            color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>
            <RefreshCw size={11} style={{ animation: isLoading ? "spin 1s linear infinite" : "none" }} />
            {isLoading ? "..." : "Оновити"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "4px 10px", flexShrink: 0 }}>
          <span style={{ color: "#fca5a5", fontSize: 11 }}>{error}</span>
        </div>
      )}

      {showMain && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "5px", minHeight: 0 }}>

          {/* ═══ ROW 1: ТОТАЛИ ═══ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, flexShrink: 0 }}>
            {[
              { label: "ВИРУЧКА", val: `${fmt(totals.rev)} ₴`, color: "#34d399", glow: "#34d399" },
              { label: "ЧЕКИ", val: totals.ch, color: "#60a5fa", glow: "#60a5fa" },
              { label: "СЕРЕД. ЧЕК", val: `${fmt(totals.avg)} ₴`, color: "#c084fc", glow: "#c084fc" },
            ].map((t) => (
              <div key={t.label} style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid rgba(255,255,255,0.08)`,
                borderRadius: 10,
                padding: "8px 12px",
                textAlign: "center",
              }}>
                <div style={{ fontSize: 9, color: "#64748b", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 2 }}>{t.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: t.color, textShadow: `0 0 12px ${t.glow}40` }}>{t.val}</div>
              </div>
            ))}
          </div>

          {/* ═══ ROW 2: СПІВРОБІТНИКИ + БАР ═══ */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, flexShrink: 0 }}>

            {/* Співробітники */}
            <div style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              overflow: "hidden",
            }}>
              <div style={{ padding: "5px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12 }}>👥</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#94a3b8" }}>СПІВРОБІТНИКИ</span>
              </div>
              {/* Заголовок колонок */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 68px 42px 70px 64px", gap: 0, padding: "3px 8px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {["ІМ'Я", "ВИРУЧКА", "ЧЕК", "СЕРЕД", "МІС"].map((h) => (
                  <div key={h} style={{ fontSize: 8, color: "#475569", fontWeight: 700, letterSpacing: "0.08em", textAlign: h === "ІМ'Я" ? "left" : "right" }}>{h}</div>
                ))}
              </div>
              {daySales
                .sort((a,b) => Number(b.revenue||0)-Number(a.revenue||0))
                .map((w, i) => {
                  const rev = Number(w.revenue||0)/100;
                  const ch = Number(w.clients||0);
                  const avgDay = ch>0?rev/ch:0;
                  const avgMon = avgPerMonthMap[w.user_id];
                  const isBar = w.name?.toLowerCase().includes("бар");
                  return (
                    <div key={w.user_id} style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 68px 42px 70px 64px",
                      padding: "5px 8px",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                      alignItems: "center",
                    }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name||"—"}</div>
                        <div style={{ fontSize: 9, color: isBar ? "#f59e0b" : "#60a5fa", fontWeight: 600 }}>{isBar?"Бармен":"Офіціант"}</div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "#34d399" }}>{fmt(rev)}₴</div>
                      <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "#60a5fa" }}>{ch}</div>
                      <div style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{fmt(avgDay)}₴</div>
                      <div style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: "#64748b" }}>{avgMon!=null?`${fmt(avgMon)}₴`:"—"}</div>
                    </div>
                  );
                })}
            </div>

            {/* Бар */}
            <div style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              overflow: "hidden",
            }}>
              <div style={{ padding: "5px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12 }}>🍺</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#94a3b8" }}>БАР</span>
              </div>

              <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                {/* Категорії */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                  {barCats.map((c, idx) => {
                    const colors = ["#f59e0b", "#60a5fa", "#f97316"];
                    return (
                      <div key={c.id} style={{
                        background: "rgba(255,255,255,0.05)",
                        border: `1px solid ${colors[idx]}30`,
                        borderRadius: 8,
                        padding: "5px 6px",
                        textAlign: "center",
                      }}>
                        <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>{c.name}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: colors[idx] }}>{c.qty}</div>
                        <div style={{ fontSize: 9, color: "#475569" }}>шт</div>
                      </div>
                    );
                  })}
                </div>

                {/* Кава */}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 4 }}>
                  <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 4 }}>☕ КАВА</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                    {[
                      { label: "Зал", qty: coffeeSplit.hall.qty, zak: coffeeSplit.hall.zak, color: "#fb923c" },
                      { label: "Штат", qty: coffeeSplit.staff.qty, zak: coffeeSplit.staff.zak, color: "#fbbf24" },
                    ].map((r) => (
                      <div key={r.label} style={{
                        background: `${r.color}10`,
                        border: `1px solid ${r.color}25`,
                        borderRadius: 7,
                        padding: "4px 7px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: r.color }}>{r.label}</div>
                          <div style={{ fontSize: 9, color: "#475569" }}>↳ {r.zak} закл</div>
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: r.color }}>{r.qty}</div>
                      </div>
                    ))}
                  </div>
                  {/* Всього */}
                  <div style={{
                    marginTop: 3,
                    background: "rgba(251,146,60,0.12)",
                    border: "1px solid rgba(251,146,60,0.35)",
                    borderRadius: 7,
                    padding: "4px 7px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}>
                    <div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#fb923c" }}>ВСЬОГО</span>
                      <span style={{ fontSize: 9, color: "#64748b", marginLeft: 6 }}>↳ {coffeeSplit.total.zak} закл</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#fb923c" }}>{coffeeSplit.total.qty} шт</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ ROW 3: UPSELL ═══ */}
          <div style={{
            flex: 1,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}>
            <div style={{ padding: "5px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12 }}>🔥</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#94a3b8" }}>ВИТОРГ СОУСИ / ДОПИ</span>
              </div>
              {upsellLoading && <span style={{ fontSize: 9, color: "#f59e0b", animation: "pulse 1s infinite" }}>завантаження...</span>}
            </div>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* Заголовок таблиці */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 130px", padding: "3px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0 }}>
                {["ІМ'Я", "СЬОГОДНІ", "МІСЯЦЬ"].map((h, i) => (
                  <div key={h} style={{ fontSize: 9, color: "#475569", fontWeight: 700, letterSpacing: "0.08em", textAlign: i === 0 ? "left" : "right" }}>{h}</div>
                ))}
              </div>

              {/* Рядки */}
              {upsellData.length === 0 && !upsellLoading ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 12, color: "#475569" }}>Немає даних</span>
                </div>
              ) : (
                upsellData.map((row, i) => (
                  <div key={row.user_id} style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 130px 130px",
                    padding: "5px 10px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                    alignItems: "center",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{row.name||"—"}</div>
                    <div style={{ textAlign: "right", fontSize: 14, fontWeight: 800, color: "#34d399" }}>{fmt(row.day_sum)} ₴</div>
                    <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>{fmt(row.month_sum)} ₴</div>
                  </div>
                ))
              )}

              {/* РАЗОМ — FIX: тепер правильно рахує */}
              {upsellData.length > 0 && (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 130px 130px",
                  padding: "5px 10px",
                  borderTop: "2px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.04)",
                  alignItems: "center",
                  flexShrink: 0,
                  marginTop: "auto",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: "0.08em" }}>РАЗОМ</div>
                  <div style={{ textAlign: "right", fontSize: 15, fontWeight: 800, color: "#34d399", textShadow: "0 0 10px #34d39950" }}>{fmt(upsellTotals.day)} ₴</div>
                  <div style={{ textAlign: "right", fontSize: 14, fontWeight: 700, color: "#94a3b8" }}>{fmt(upsellTotals.month)} ₴</div>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {!loading && daySales.length===0 && !error && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ color: "#475569", fontSize: 13 }}>Немає даних за цей день</p>
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: "#1e293b", letterSpacing: "0.1em" }}>GRECO TECH™</span>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        * { box-sizing: border-box; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
      `}</style>
    </div>
  );
}
