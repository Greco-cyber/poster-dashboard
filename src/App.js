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
  const [barData, setBarData] = useState(null);
  const [bonusLoading, setBonusLoading] = useState(false);
  const [barmenBonus, setBarmenBonus] = useState([]);
  const [bonusCategories, setBonusCategories] = useState(null);

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
      const dB = await fetchJson(`${API_BASE}/api/barmen-bonus?dateFrom=${date}&dateTo=${date}`);
      setBarmenBonus(Array.isArray(dB?.response) ? dB.response : []);
      setBonusCategories(dB?.categories || null);
    } catch(e) { setBarmenBonus([]); setBonusCategories(null); }
    finally { setBonusLoading(false); }

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
    return [pick(9,"Пиво"), pick(14,"Холодні напої"), pick(34,"Коктейлі")];
  }, [barData]);

  const coffeeSplit = useMemo(() => {
    const by = Array.isArray(barData?.coffee?.by_product) ? barData.coffee.by_product : [];
    const s34 = new Set([230,485,307,231,316,406,183,182,317,425,424,441,422,423]);
    const s47 = new Set([529,530,531,533,534,535]);
    const sum = (set) => by.reduce((a,r) => !set.has(Number(r.product_id)) ? a : {qty:a.qty+Number(r.qty||0), zak:a.zak+Number(r.zakladki_total||0)}, {qty:0,zak:0});
    return { hall:sum(s34), staff:sum(s47), total:{qty:barData?.coffee?.total_qty||0, zak:barData?.coffee?.total_zakladki||0} };
  }, [barData]);

  const showMain = !loading && daySales.length > 0;
  const isLoading = loading || bonusLoading;

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
                  const isBar = w.name?.toLowerCase().includes("бар");
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

          {/* БАР */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 shrink-0">
            <div className="px-3 py-2 border-b border-gray-700">
              <h2 className="text-sm font-bold text-white">🍺 Бар</h2>
            </div>
            <div className="p-2 grid grid-cols-2 gap-2">
              {/* Категорії */}
              <div className="space-y-1.5">
                {barCats.map((c,idx) => (
                  <div key={c.id} className="bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${idx===0?"bg-amber-400":idx===1?"bg-blue-400":"bg-orange-400"}`} />
                      <span className="text-xs text-white">{c.name}</span>
                    </div>
                    <span className="text-sm font-bold text-white ml-2">{c.qty} <span className="text-xs text-gray-400">шт</span></span>
                  </div>
                ))}
              </div>
              {/* Кава */}
              <div className="space-y-1.5">
                {[
                  { label:"Зал", sub:"Кава в залі", qty:coffeeSplit.hall.qty, zak:coffeeSplit.hall.zak, cls:"border-orange-700/40 bg-orange-900/20", txt:"text-orange-300" },
                  { label:"Штат", sub:"Кава персонал", qty:coffeeSplit.staff.qty, zak:coffeeSplit.staff.zak, cls:"border-amber-700/40 bg-amber-900/20", txt:"text-amber-300" },
                  { label:"Всього", sub:`↳ ${coffeeSplit.total.zak} закл`, qty:coffeeSplit.total.qty, zak:null, cls:"border-orange-600/60 bg-gray-900/60 border-2", txt:"text-orange-400" },
                ].map((r) => (
                  <div key={r.label} className={`border rounded-lg px-3 py-2 flex items-center justify-between ${r.cls}`}>
                    <div>
                      <p className={`text-xs font-semibold ${r.txt}`}>{r.label}</p>
                      <p className="text-xs text-gray-400">{r.sub}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${r.txt}`}>{r.qty} шт</p>
                      {r.zak !== null && <p className="text-xs text-gray-400">↳ {r.zak} зак</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* БОНУС БАРМЕНІВ */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between shrink-0">
              <h2 className="text-sm font-bold text-white">🍸 Бонус барменів</h2>
              {bonusLoading && <span className="text-xs text-gray-500 animate-pulse">завантаження...</span>}
            </div>
            <div className="p-2 flex-1 overflow-x-auto">
              {barmenBonus.length === 0 && !bonusLoading ? (
                <p className="text-gray-500 text-xs text-center py-2">Немає барменів за цей день</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700">
                      <th className="text-left pb-2 font-medium">Ім'я</th>
                      <th className="text-right pb-2 font-medium">
                        Виторг<br/><span className="text-gray-600 font-normal">1.3%</span>
                      </th>
                      <th className="text-right pb-2 font-medium">
                        Соуси/Допи<br/><span className="text-gray-600 font-normal">7%</span>
                      </th>
                      <th className="text-right pb-2 font-medium">
                        Чай/Кофе<br/><span className="text-gray-600 font-normal">7%</span>
                      </th>
                      <th className="text-right pb-2 font-medium">
                        Алко<br/><span className="text-gray-600 font-normal">15%</span>
                      </th>
                      <th className="text-right pb-2 font-medium">
                        Лімонади<br/><span className="text-gray-600 font-normal">10%</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {barmenBonus.map((row) => (
                      <tr key={row.user_id} className="hover:bg-gray-700/20">
                        <td className="py-2 font-semibold text-white">{row.name||"—"}</td>
                        <td className="py-2 text-right font-bold text-white">{money(row.revenue_bonus)} ₴</td>
                        <td className="py-2 text-right font-bold text-white">{money(row.upsell_bonus)} ₴</td>
                        <td className="py-2 text-right font-bold text-blue-300">{money(row.tea_coffee_share)} ₴</td>
                        <td className="py-2 text-right font-bold text-purple-300">{money(row.cocktails_share)} ₴</td>
                        <td className="py-2 text-right font-bold text-green-300">{money(row.lemonades_share)} ₴</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

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
