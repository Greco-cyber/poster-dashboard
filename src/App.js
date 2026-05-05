import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, RefreshCw } from "lucide-react";

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
const money = (n) => Number(n).toLocaleString("uk-UA", { minimumFractionDigits:0, maximumFractionDigits:0 });

export default function App() {
  const today = useMemo(() => yyyymmdd(), []);
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [daySales, setDaySales] = useState([]);
  const [avgPerMonthMap, setAvgPerMonthMap] = useState({});
  const [upsellData, setUpsellData] = useState([]);
  const [waitersBonus, setWaitersBonus] = useState([]);
  const [waitersLoading, setWaitersLoading] = useState(false);
  const [bonusLoading, setBonusLoading] = useState(false);
  const [barmenBonus, setBarmenBonus] = useState([]);
  const [bonusCategories, setBonusCategories] = useState(null);
  const [barData, setBarData] = useState(null);

  const fetchJson = useCallback(async (url) => {
    const r = await fetch(url);
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status}: ${t.slice(0,200)}`);
    return JSON.parse(t || "{}");
  }, []);

  const loadAll = useCallback(async () => { // eslint-disable-line
    setLoading(true); setError("");
    setWaitersLoading(true);
    setBonusLoading(true);

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
    } catch(e) { setError("Помилка завантаження"); setDaySales([]); }
    finally { setLoading(false); }

    try {
      const dU = await fetchJson(`${API_BASE}/api/upsell-sales?dateFrom=${date}&dateTo=${date}`);
      setUpsellData(Array.isArray(dU?.response) ? dU.response : []);
    } catch(e) { setUpsellData([]); }

    try {
      const dW = await fetchJson(`${API_BASE}/api/waiters-bonus?dateFrom=${date}&dateTo=${date}`);
      setWaitersBonus(Array.isArray(dW?.response) ? dW.response : []);
    } catch(e) { setWaitersBonus([]); }
    finally { setWaitersLoading(false); }

    try {
      const dB = await fetchJson(`${API_BASE}/api/barmen-bonus?dateFrom=${date}&dateTo=${date}`);
      setBarmenBonus(Array.isArray(dB?.response) ? dB.response : []);
      setBonusCategories(dB?.categories || null);
    } catch(e) { setBarmenBonus([]); setBonusCategories(null); }
    finally { setBonusLoading(false); }

    try {
      const dBar = await fetchJson(`${API_BASE}/api/bar-sales?dateFrom=${date}&dateTo=${date}`);
      setBarData(dBar || null);
    } catch(e) { setBarData(null); }

  }, [date, fetchJson]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { const id = setInterval(loadAll, 5*60*1000); return () => clearInterval(id); }, [loadAll]);

  const totals = useMemo(() => {
    const rev = daySales.reduce((s,w) => s+Number(w.revenue||0)/100, 0);
    const ch = daySales.reduce((s,w) => s+Number(w.clients||0), 0);
    return { rev, ch, avg: ch>0?rev/ch:0 };
  }, [daySales]);

  const isBarName = (name) => { const n = (name || "").toLowerCase(); return n.includes("бар") || n.includes("bar"); };

  const waitersTable = useMemo(() => {
    return daySales
      .filter(w => !isBarName(w.name))
      .map(w => {
        const revenue = Number(w.revenue || 0) / 100;
        const uid = String(w.user_id);
        const up = upsellData.find(u => String(u.user_id) === uid);
        const upsellSum = up ? (up.day_sauces||0) + (up.day_kitchen||0) + (up.day_bar||0) : 0;
        const wb = waitersBonus.find(b => String(b.user_id) === uid);
        return {
          user_id: uid, name: w.name,
          revenue_bonus:   Math.round(revenue   * 0.0075 * 100) / 100,
          upsell_bonus:    Math.round(upsellSum  * 0.10   * 100) / 100,
          desserts_bonus:  wb?.desserts_bonus  || 0,
          wines_bonus:     wb?.wines_bonus     || 0,
          cocktails_bonus: wb?.cocktails_bonus || 0,
        };
      })
      .sort((a, b) => b.revenue_bonus - a.revenue_bonus);
  }, [daySales, upsellData, waitersBonus]);

  const showMain = !loading && daySales.length > 0;
  const isLoading = loading || waitersLoading || bonusLoading;

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">

      {/* HEADER */}
      <div className="bg-gray-800 border-b border-gray-700 px-3 py-2 flex items-center justify-between shrink-0">
        <div>
          <p className="text-sm font-bold text-white">GRECO · Зміна</p>
          <p className="text-gray-400 text-xs">{dateInputValue(date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-blue-400" />
          <input
            type="date"
            className="px-2 py-1 border border-gray-600 rounded text-xs text-white bg-gray-700 focus:outline-none"
            value={dateInputValue(date)}
            onChange={(e) => setDate(e.target.value.replaceAll("-",""))}
          />
          <button onClick={loadAll} disabled={isLoading}
            className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${isLoading?"animate-spin":""}`} />
            {isLoading ? "..." : "Оновити"}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-900 px-3 py-1.5 shrink-0"><p className="text-red-200 text-xs">{error}</p></div>}

      {showMain && (
        <div className="flex-1 flex flex-col gap-2 p-2">

          {/* ТОТАЛИ */}
          <div className="grid grid-cols-3 gap-2 shrink-0">
            {[
              { label:"Виручка", val:`${money(totals.rev)} ₴`, color:"text-green-400" },
              { label:"Чеки", val:totals.ch, color:"text-blue-400" },
              { label:"Серед. чек", val:`${money(totals.avg)} ₴`, color:"text-purple-400" },
            ].map((t) => (
              <div key={t.label} className="bg-gray-800 rounded-xl border border-gray-700 px-3 py-2 text-center">
                <p className="text-gray-400 text-xs mb-0.5">{t.label}</p>
                <p className={`text-lg font-bold ${t.color}`}>{t.val}</p>
              </div>
            ))}
          </div>

          {/* СПІВРОБІТНИКИ */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 shrink-0">
            <div className="px-3 py-2 border-b border-gray-700">
              <h2 className="text-sm font-bold text-white">👥 Співробітники</h2>
            </div>
            <div className="divide-y divide-gray-700/50">
              {daySales
                .sort((a,b) => Number(b.revenue||0)-Number(a.revenue||0))
                .map((w) => {
                  const rev = Number(w.revenue||0)/100;
                  const ch = Number(w.clients||0);
                  const avgDay = ch>0?rev/ch:0;
                  const avgMon = avgPerMonthMap[w.user_id];
                  const isBar = w.name?.toLowerCase().includes("бар") || w.name?.toLowerCase().includes("bar");
                  return (
                    <div key={w.user_id} className="px-3 py-2.5 flex items-center gap-3">
                      <div className="w-24 shrink-0">
                        <p className="text-sm font-semibold text-white truncate">{w.name||"—"}</p>
                        <p className="text-xs text-gray-400">{isBar?"Бармен":"Офіціант"}</p>
                      </div>
                      <div className="flex-1 grid grid-cols-4 gap-1 text-center">
                        <div>
                          <p className="text-gray-400 text-xs">Виручка</p>
                          <p className="text-sm font-bold text-white">{money(rev)}₴</p>
                        </div>
                        <div>
                          <p className="text-gray-400 text-xs">Чеки</p>
                          <p className="text-sm font-bold text-white">{ch}</p>
                        </div>
                        <div>
                          <p className="text-gray-400 text-xs">Серед</p>
                          <p className="text-sm font-bold text-white">{money(avgDay)}₴</p>
                        </div>
                        <div>
                          <p className="text-gray-400 text-xs">Міс</p>
                          <p className="text-sm font-semibold text-gray-300">{avgMon!=null?`${money(avgMon)}₴`:"—"}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* БОНУС ОФІЦІАНТІВ */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 shrink-0">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">🧾 Бонус офіціантів</h2>
              {waitersLoading && <span className="text-xs text-gray-500 animate-pulse">завантаження...</span>}
            </div>
            <div className="px-4 py-2">
              {waitersTable.length === 0 && !loading ? (
                <p className="text-gray-500 text-sm text-center py-3">Немає офіціантів за цей день</p>
              ) : (
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700/60">
                      <th className="text-left py-2 text-xs font-medium w-2/6">Ім'я</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Виторг</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Соуси + доп</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Десерти</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Вино</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Алк. коктейлі</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6 text-yellow-400">Разом</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/40">
                    {waitersTable.map((row) => {
                      const total = (row.revenue_bonus||0)+(row.upsell_bonus||0)+(row.desserts_bonus||0)+(row.wines_bonus||0)+(row.cocktails_bonus||0);
                      return (
                      <tr key={row.user_id} className="hover:bg-gray-700/20">
                        <td className="py-3 text-sm font-semibold text-white">{row.name||"—"}</td>
                        <td className="py-3 text-right text-sm font-bold text-white">{money(row.revenue_bonus)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-white">{money(row.upsell_bonus)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-pink-300">{money(row.desserts_bonus)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-purple-300">{money(row.wines_bonus)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-orange-300">{money(row.cocktails_bonus)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-yellow-300">{money(total)} ₴</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* БОНУС БАРМЕНІВ */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 shrink-0">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">🍸 Бонус барменів</h2>
              {bonusLoading && <span className="text-xs text-gray-500 animate-pulse">завантаження...</span>}
            </div>
            <div className="px-4 py-2">
              {barmenBonus.length === 0 && !bonusLoading ? (
                <p className="text-gray-500 text-sm text-center py-3">Немає барменів за цей день</p>
              ) : (
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700/60">
                      <th className="text-left py-2 text-xs font-medium w-2/6">Ім'я</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Виторг</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Соуси + доп</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Чай / Кава</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Алк. коктейлі</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6">Лимонади + Мохіто</th>
                      <th className="text-right py-2 text-xs font-medium w-1/6 text-yellow-400">Разом</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/40">
                    {barmenBonus.map((row) => {
                      const total = (row.revenue_bonus||0)+(row.upsell_bonus||0)+(row.tea_coffee_share||0)+(row.cocktails_share||0)+(row.lemonades_share||0);
                      return (
                      <tr key={row.user_id} className="hover:bg-gray-700/20">
                        <td className="py-3 text-sm font-semibold text-white">{row.name||"—"}</td>
                        <td className="py-3 text-right text-sm font-bold text-white">{money(row.revenue_bonus)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-white">{money(row.upsell_bonus)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-blue-300">{money(row.tea_coffee_share)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-purple-300">{money(row.cocktails_share)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-green-300">{money(row.lemonades_share)} ₴</td>
                        <td className="py-3 text-right text-sm font-bold text-yellow-300">{money(total)} ₴</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* БАР — кава */}
          {barData && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 shrink-0">
              <div className="px-3 py-2 border-b border-gray-700">
                <h2 className="text-sm font-bold text-white">☕ Кава</h2>
              </div>
              <div className="flex gap-2 p-2">
                <div className="flex-1 flex items-center justify-between px-3 py-2 bg-gray-700/40 rounded-lg">
                  <p className="text-xs text-gray-400">Кава в закладі</p>
                  <div className="text-right">
                    <p className="text-sm font-bold text-white">{barData.coffee?.zal?.qty ?? 0} шт</p>
                    <p className="text-xs text-gray-500">{barData.coffee?.zal?.zakladki ?? 0} зак</p>
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-between px-3 py-2 bg-gray-700/40 rounded-lg">
                  <p className="text-xs text-gray-400">Кава штат</p>
                  <div className="text-right">
                    <p className="text-sm font-bold text-white">{barData.coffee?.shtat?.qty ?? 0} шт</p>
                    <p className="text-xs text-gray-500">{barData.coffee?.shtat?.zakladki ?? 0} зак</p>
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-between px-3 py-2 rounded-lg border border-blue-400/50 bg-blue-900/20">
                  <p className="text-xs text-gray-400">Усього</p>
                  <div className="text-right">
                    <p className="text-sm font-bold text-white">{barData.coffee?.total_qty ?? 0} шт</p>
                    <p className="text-xs text-gray-500">{barData.coffee?.total_zakladki ?? 0} закл</p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {!loading && daySales.length===0 && !error && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500 text-sm">Немає даних за цей день</p>
        </div>
      )}

      <div className="text-center py-1">
        <p className="text-gray-600 text-xs">GRECO Tech™</p>
      </div>
    </div>
  );
}
