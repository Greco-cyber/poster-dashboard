import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Clock, RefreshCw } from "lucide-react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

function yyyymmdd(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
function dateInputValue(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function firstDayOfMonthStr(s) {
  return `${s.slice(0, 4)}${s.slice(4, 6)}01`;
}
function lastDayOfMonthStr(s) {
  const y = +s.slice(0, 4), m = +s.slice(4, 6);
  const d = new Date(y, m, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
const money = (n) =>
  Number(n).toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function App() {
  const today = useMemo(() => yyyymmdd(), []);
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [daySales, setDaySales] = useState([]);
  const [avgPerMonthMap, setAvgPerMonthMap] = useState({});
  const [barLoading, setBarLoading] = useState(false);
  const [barData, setBarData] = useState(null);
  const [upsellLoading, setUpsellLoading] = useState(false);
  const [upsellError, setUpsellError] = useState("");
  const [upsellData, setUpsellData] = useState([]);

  const shotsOverride = useMemo(() => new Map([
    [230,1],[485,1],[307,2],[231,1],[316,1],[406,1],[183,1],[182,1],[317,1],
    [425,1],[424,1],[441,1],[422,1],[423,2],
    [529,1],[530,1],[531,2],[533,1],[534,1],[535,1],
  ]), []);

  const fetchJson = useCallback(async (url) => {
    const r = await fetch(url);
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status}: ${t.slice(0, 200)}`);
    return JSON.parse(t || "{}");
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true); setError("");
    setBarLoading(true);
    setUpsellLoading(true); setUpsellError("");

    // Waiters
    try {
      const mFrom = firstDayOfMonthStr(date);
      const mTo = lastDayOfMonthStr(date);
      const dDay = await fetchJson(`${API_BASE}/api/waiters-sales?dateFrom=${date}&dateTo=${date}`);
      const dayList = Array.isArray(dDay?.response) ? dDay.response : [];
      const dMonth = await fetchJson(`${API_BASE}/api/waiters-sales?dateFrom=${mFrom}&dateTo=${mTo}`);
      const monthList = Array.isArray(dMonth?.response) ? dMonth.response : [];
      const avgMap = {};
      for (const w of monthList) {
        const rev = Number(w.revenue || 0) / 100;
        const ch = Number(w.clients || 0);
        avgMap[w.user_id] = ch > 0 ? rev / ch : 0;
      }
      setDaySales(dayList);
      setAvgPerMonthMap(avgMap);
    } catch (e) {
      setError("Помилка завантаження даних");
      setDaySales([]);
    } finally { setLoading(false); }

    // Bar
    try {
      const dBar = await fetchJson(`${API_BASE}/api/bar-sales?dateFrom=${date}&dateTo=${date}`);
      const patched = { ...dBar };
      if (patched?.coffee && Array.isArray(patched.coffee.by_product)) {
        let tQty = 0, tZak = 0;
        const bp = patched.coffee.by_product.map((row) => {
          const pid = Number(row.product_id);
          const qty = Number(row.qty || 0);
          const per = shotsOverride.has(pid) ? shotsOverride.get(pid) : Number(row.zakladki_per_unit || 0);
          const zak = qty * per;
          tQty += qty; tZak += zak;
          return { ...row, zakladki_per_unit: per, zakladki_total: zak };
        });
        patched.coffee = { ...patched.coffee, total_qty: tQty, total_zakladki: tZak, by_product: bp.sort((a,b) => Number(b.qty||0)-Number(a.qty||0)) };
      }
      setBarData(patched);
    } catch (e) {
      setBarData(null);
    } finally { setBarLoading(false); }

    // Upsell
    try {
      const dU = await fetchJson(`${API_BASE}/api/upsell-sales?dateFrom=${date}&dateTo=${date}`);
      setUpsellData(Array.isArray(dU?.response) ? dU.response : []);
    } catch (e) {
      setUpsellError("Помилка завантаження допів");
      setUpsellData([]);
    } finally { setUpsellLoading(false); }
  }, [date, fetchJson, shotsOverride]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { const id = setInterval(loadAll, 5*60*1000); return () => clearInterval(id); }, [loadAll]);

  const totals = useMemo(() => {
    const rev = daySales.reduce((s, w) => s + Number(w.revenue||0)/100, 0);
    const ch = daySales.reduce((s, w) => s + Number(w.clients||0), 0);
    return { rev, ch, avg: ch > 0 ? rev/ch : 0 };
  }, [daySales]);

  const barCats = useMemo(() => {
    const arr = Array.isArray(barData?.categories) ? barData.categories : [];
    const map = new Map(arr.map((x) => [Number(x.category_id), x]));
    const pick = (id, name) => ({ id, name, qty: Number(map.get(id)?.qty || 0) });
    return [pick(9,"Пиво"), pick(14,"Холодні напої"), pick(34,"Коктейлі")];
  }, [barData]);

  const coffeeSplit = useMemo(() => {
    const by = Array.isArray(barData?.coffee?.by_product) ? barData.coffee.by_product : [];
    const cat34 = new Set([230,485,307,231,316,406,183,182,317,425,424,441,422,423]);
    const cat47 = new Set([529,530,531,533,534,535]);
    const sum = (set) => by.reduce((acc, r) => {
      if (!set.has(Number(r.product_id))) return acc;
      return { qty: acc.qty + Number(r.qty||0), zak: acc.zak + Number(r.zakladki_total||0) };
    }, { qty:0, zak:0 });
    return { hall: sum(cat34), staff: sum(cat47), total: { qty: barData?.coffee?.total_qty||0, zak: barData?.coffee?.total_zakladki||0 } };
  }, [barData]);

  const showMain = !loading && daySales.length > 0;
  const isLoading = loading || barLoading || upsellLoading;

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden">

      {/* HEADER — компактний */}
      <div className="bg-gray-800 border-b border-gray-700 px-3 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-base font-bold text-white leading-tight">GRECO · Зміна</h1>
            <p className="text-gray-400 text-xs">{dateInputValue(date)}</p>
          </div>
          {/* Totals inline */}
          {showMain && (
            <div className="flex items-center gap-3 ml-2">
              <div className="bg-gray-700 rounded-lg px-3 py-1">
                <span className="text-xs text-gray-400">Виручка </span>
                <span className="text-sm font-bold text-white">{money(totals.rev)} ₴</span>
              </div>
              <div className="bg-gray-700 rounded-lg px-3 py-1">
                <span className="text-xs text-gray-400">Чеки </span>
                <span className="text-sm font-bold text-white">{totals.ch}</span>
              </div>
              <div className="bg-gray-700 rounded-lg px-3 py-1">
                <span className="text-xs text-gray-400">Серед. </span>
                <span className="text-sm font-bold text-white">{money(totals.avg)} ₴</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-blue-400" />
          <input
            type="date"
            className="px-2 py-1 border border-gray-600 rounded text-xs text-white bg-gray-700 focus:outline-none"
            value={dateInputValue(date)}
            onChange={(e) => setDate(e.target.value.replaceAll("-", ""))}
          />
          <button
            onClick={loadAll}
            disabled={isLoading}
            className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
            {isLoading ? "..." : "Оновити"}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900 border-b border-red-700 px-3 py-1.5 shrink-0"><p className="text-red-200 text-xs">{error}</p></div>}

      {/* MAIN — 3 колонки, заповнюють екран */}
      {showMain && (
        <div className="flex-1 grid grid-cols-12 gap-2 p-2 min-h-0">

          {/* COL 1: БАР (3/12) */}
          <div className="col-span-3 bg-gray-800 rounded-xl border border-gray-700 flex flex-col min-h-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-700 shrink-0">
              <h2 className="font-bold text-white text-sm">🍺 Бар</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {/* Категорії */}
              {barCats.map((c, idx) => (
                <div key={c.id} className="bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${idx===0?"bg-amber-400":idx===1?"bg-blue-400":"bg-orange-400"}`} />
                    <span className="text-xs text-white font-medium">{c.name}</span>
                  </div>
                  <span className="text-sm font-bold text-white">{c.qty} <span className="text-xs text-gray-400">шт</span></span>
                </div>
              ))}

              {/* Кава */}
              <div className="pt-2 border-t border-gray-700">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">☕ Закладки кави</p>
                <div className="space-y-1.5">
                  <div className="bg-orange-900/20 border border-orange-700/40 rounded-lg px-3 py-2 flex justify-between items-center">
                    <div>
                      <p className="text-xs text-orange-300">Зал</p>
                      <p className="text-xs font-semibold text-white">Кава в залі</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-white">{coffeeSplit.hall.qty} шт</p>
                      <p className="text-xs text-orange-300">↳ {coffeeSplit.hall.zak} зак</p>
                    </div>
                  </div>
                  <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2 flex justify-between items-center">
                    <div>
                      <p className="text-xs text-amber-300">Персонал</p>
                      <p className="text-xs font-semibold text-white">Штат</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-white">{coffeeSplit.staff.qty} шт</p>
                      <p className="text-xs text-amber-300">↳ {coffeeSplit.staff.zak} зак</p>
                    </div>
                  </div>
                  <div className="bg-gray-900/60 border-2 border-orange-600/50 rounded-lg px-3 py-2 flex justify-between items-center">
                    <p className="text-xs font-bold text-orange-400">Всього</p>
                    <div className="text-right">
                      <p className="text-base font-bold text-orange-400">{coffeeSplit.total.qty} шт</p>
                      <p className="text-xs text-gray-300">↳ {coffeeSplit.total.zak} зак</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* COL 2: СПІВРОБІТНИКИ (5/12) */}
          <div className="col-span-5 bg-gray-800 rounded-xl border border-gray-700 flex flex-col min-h-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-700 shrink-0">
              <h2 className="font-bold text-white text-sm">👥 Співробітники</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-1 gap-2">
                {daySales
                  .sort((a, b) => Number(b.revenue||0) - Number(a.revenue||0))
                  .map((w) => {
                    const uid = w.user_id;
                    const rev = Number(w.revenue||0) / 100;
                    const ch = Number(w.clients||0);
                    const avgDay = ch > 0 ? rev/ch : 0;
                    const avgMon = avgPerMonthMap[uid];
                    const isBar = w.name?.toLowerCase().includes("бар");
                    return (
                      <div key={uid} className="bg-gray-900/60 border border-gray-700 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <h3 className="font-semibold text-white text-sm">{w.name || "—"}</h3>
                            <p className="text-xs text-gray-400">{isBar ? "Бармен" : "Офіціант"}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-1 text-center">
                          <div>
                            <p className="text-gray-400 text-xs mb-0.5">Виручка</p>
                            <p className="font-bold text-white text-sm">{money(rev)}₴</p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-xs mb-0.5">Чеки</p>
                            <p className="font-bold text-white text-sm">{ch}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-xs mb-0.5">Серед</p>
                            <p className="font-bold text-white text-sm">{money(avgDay)}₴</p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-xs mb-0.5">Міс</p>
                            <p className="font-semibold text-gray-300 text-sm">{avgMon != null ? `${money(avgMon)}₴` : "—"}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* COL 3: ВИТОРГ СОУСИ/ДОПИ (4/12) */}
          <div className="col-span-4 bg-gray-800 rounded-xl border border-gray-700 flex flex-col min-h-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-700 shrink-0 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-white text-sm">🔥 Виторг соуси/допи</h2>
                <p className="text-gray-400 text-xs">{dateInputValue(date)}</p>
              </div>
              {upsellLoading && <span className="text-xs text-gray-500 animate-pulse">завантаження...</span>}
            </div>

            {upsellError && (
              <div className="px-3 py-1.5 bg-yellow-900/30 border-b border-yellow-700/30 shrink-0">
                <p className="text-yellow-300 text-xs">{upsellError}</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3">
              {upsellData.length === 0 && !upsellLoading ? (
                <p className="text-gray-500 text-xs text-center py-4">Немає даних</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="text-gray-400 text-xs uppercase">
                      <th className="text-left pb-2 font-medium">Ім'я</th>
                      <th className="text-right pb-2 font-medium">Сьогодні</th>
                      <th className="text-right pb-2 font-medium">Місяць</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {upsellData.map((row) => (
                      <tr key={row.user_id} className="hover:bg-gray-700/20">
                        <td className="py-2 text-xs font-medium text-white">{row.name || "—"}</td>
                        <td className="py-2 text-right">
                          <span className="text-sm font-bold text-green-400">{money(row.day_sum)} ₴</span>
                        </td>
                        <td className="py-2 text-right">
                          <span className="text-sm font-semibold text-gray-300">{money(row.month_sum)} ₴</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-600">
                      <td className="pt-2 text-xs text-gray-400 font-bold uppercase">Разом</td>
                      <td className="pt-2 text-right">
                        <span className="text-sm font-bold text-green-400">
                          {money(upsellData.reduce((s,r) => s+r.day_sum, 0))} ₴
                        </span>
                      </td>
                      <td className="pt-2 text-right">
                        <span className="text-sm font-bold text-gray-300">
                          {money(upsellData.reduce((s,r) => s+r.month_sum, 0))} ₴
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>

        </div>
      )}

      {!loading && daySales.length === 0 && !error && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500 text-sm">Немає даних за цей день</p>
        </div>
      )}

      <div className="text-center py-1 shrink-0">
        <p className="text-gray-600 text-xs">GRECO Tech™</p>
      </div>
    </div>
  );
}
