import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Users, CreditCard, Clock, RefreshCw } from "lucide-react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

// ---------------- utils ----------------
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
  const y = +s.slice(0, 4),
    m = +s.slice(4, 6);
  const d = new Date(y, m, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

const money = (n) =>
  Number(n).toLocaleString("uk-UA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

export default function App() {
  const today = useMemo(() => yyyymmdd(), []);
  const [date, setDate] = useState(today);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [daySales, setDaySales] = useState([]);
  const [avgPerMonthMap, setAvgPerMonthMap] = useState({});

  // BAR
  const [barLoading, setBarLoading] = useState(false);
  const [barError, setBarError] = useState("");
  const [barData, setBarData] = useState(null);

  // SAUCES (placeholder — заполним когда будет category_id)
  const [saucesLoading, setSaucesLoading] = useState(false);
  const [saucesData, setSaucesData] = useState(null);

  // ✅ Coffee shots mapping
  const shotsOverride = useMemo(
    () =>
      new Map([
        [230, 1], [485, 1], [307, 2], [231, 1], [316, 1],
        [406, 1], [183, 1], [182, 1], [317, 1],
        [425, 1], [424, 1], [441, 1], [422, 1], [423, 2],
        [529, 1], [530, 1], [531, 2], [533, 1], [534, 1], [535, 1],
      ]),
    []
  );

  // ==================== SAUCES CONFIG ====================
  // TODO: Антон, впиши сюда category_id соусов и допов из Poster
  const SAUCE_CATEGORY_IDS = useMemo(() => new Set([37, 41]), []);

  const fetchJsonOrThrow = useCallback(async (url) => {
    const r = await fetch(url);
    const t = await r.text();
    if (!r.ok) {
      throw new Error(`${r.status} ${r.statusText}: ${t.slice(0, 250)}`);
    }
    return JSON.parse(t || "{}");
  }, []);

  // ==================== LOAD SAUCES ====================
  const loadSauces = useCallback(async () => {
    if (SAUCE_CATEGORY_IDS.size === 0) return; // нет категорий — пропускаем

    setSaucesLoading(true);
    try {
      const mFrom = firstDayOfMonthStr(date);
      const mTo = date;

      // День: все закрытые чеки с товарами
      const dayData = await fetchJsonOrThrow(
        `${API_BASE}/api/sauces-sales?dateFrom=${date}&dateTo=${date}`
      );

      // Месяц
      const monthData = await fetchJsonOrThrow(
        `${API_BASE}/api/sauces-sales?dateFrom=${mFrom}&dateTo=${mTo}`
      );

      setSaucesData({ day: dayData, month: monthData });
    } catch (e) {
      console.error("Sauces load error:", e);
      setSaucesData(null);
    } finally {
      setSaucesLoading(false);
    }
  }, [date, fetchJsonOrThrow, SAUCE_CATEGORY_IDS.size]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    setBarLoading(true);
    setBarError("");

    try {
      const mFrom = firstDayOfMonthStr(date);
      const mTo = date;

      const dDay = await fetchJsonOrThrow(
        `${API_BASE}/api/waiters-sales?dateFrom=${date}&dateTo=${date}`
      );
      const dayList = Array.isArray(dDay?.response) ? dDay.response : [];

      const dMonth = await fetchJsonOrThrow(
        `${API_BASE}/api/waiters-sales?dateFrom=${mFrom}&dateTo=${mTo}`
      );
      const monthList = Array.isArray(dMonth?.response) ? dMonth.response : [];

      const avgMap = {};
      for (const w of monthList) {
        const revenueUAH = Number(w.revenue || 0) / 100;
        const checks = Number(w.clients || 0);
        avgMap[w.user_id] = checks > 0 ? revenueUAH / checks : 0;
      }

      setDaySales(dayList);
      setAvgPerMonthMap(avgMap);
    } catch (e) {
      console.error(e);
      setError("Не вдалося завантажити дані.");
      setDaySales([]);
      setAvgPerMonthMap({});
    } finally {
      setLoading(false);
    }

    // BAR
    try {
      const dBar = await fetchJsonOrThrow(
        `${API_BASE}/api/bar-sales?dateFrom=${date}&dateTo=${date}`
      );

      const patched = { ...dBar };
      if (patched?.coffee && Array.isArray(patched.coffee.by_product)) {
        let totalQty = 0;
        let totalZak = 0;

        const byProduct = patched.coffee.by_product.map((row) => {
          const pid = Number(row.product_id);
          const qty = Number(row.qty || 0);
          const per = shotsOverride.has(pid)
            ? shotsOverride.get(pid)
            : Number(row.zakladki_per_unit || 0);

          const zak = qty * per;
          totalQty += qty;
          totalZak += zak;

          return { ...row, zakladki_per_unit: per, zakladki_total: zak };
        });

        patched.coffee = {
          ...patched.coffee,
          total_qty: totalQty,
          total_zakladki: totalZak,
          by_product: byProduct.sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0)),
        };
      }

      setBarData(patched);
    } catch (e) {
      console.error(e);
      setBarError("Не вдалося завантажити дані по бару.");
      setBarData(null);
    } finally {
      setBarLoading(false);
    }

    // SAUCES
    loadSauces();
  }, [date, fetchJsonOrThrow, shotsOverride, loadSauces]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => {
    const id = setInterval(loadAll, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadAll]);

  // ==================== Computed ====================
  const totals = useMemo(() => {
    const totalRevenue = daySales.reduce((s, w) => s + Number(w.revenue || 0) / 100, 0);
    const totalChecks = daySales.reduce((s, w) => s + Number(w.clients || 0), 0);
    const avgCheck = totalChecks > 0 ? totalRevenue / totalChecks : 0;
    return { totalRevenue, totalChecks, avgCheck };
  }, [daySales]);

  const barCats = useMemo(() => {
    const arr = Array.isArray(barData?.categories) ? barData.categories : [];
    const map = new Map(arr.map((x) => [Number(x.category_id), x]));
    const pick = (id, fallback) => ({
      category_id: id,
      name: fallback,
      qty: Number(map.get(id)?.qty || 0),
    });
    return [pick(9, "Пиво"), pick(14, "Холодні напої"), pick(34, "Коктейлі")];
  }, [barData]);

  const coffee = useMemo(() => {
    const c = barData?.coffee || {};
    return {
      total_qty: Number(c.total_qty || 0),
      total_zakladki: Number(c.total_zakladki || 0),
      by_product: Array.isArray(c.by_product) ? c.by_product : [],
    };
  }, [barData]);

  const coffeeSplit = useMemo(() => {
    const by = coffee.by_product;
    const cat34Set = new Set([230, 485, 307, 231, 316, 406, 183, 182, 317, 425, 424, 441, 422, 423]);
    const cat47Set = new Set([529, 530, 531, 533, 534, 535]);

    const sumForSet = (set) => {
      let qty = 0, zak = 0;
      for (const row of by) {
        const pid = Number(row.product_id);
        if (!set.has(pid)) continue;
        qty += Number(row.qty || 0);
        zak += Number(row.zakladki_total || 0);
      }
      return { qty, zakladki: zak };
    };

    return {
      cat34: sumForSet(cat34Set),
      cat47: sumForSet(cat47Set),
      overall: { qty: coffee.total_qty, zakladki: coffee.total_zakladki },
    };
  }, [coffee]);

  // Sorted employees
  const sortedEmployees = useMemo(
    () => [...daySales].sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0)),
    [daySales]
  );

  const showMain = !loading && daySales.length > 0;
  const isLoading = loading || barLoading;

  // ==================== CATEGORY COLORS ====================
  const catColors = ["bg-amber-400", "bg-blue-400", "bg-orange-400"];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* ===================== HEADER ===================== */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-xl font-bold text-white">Продажі</h1>
                <p className="text-gray-400 text-xs">Звіт за день</p>
              </div>

              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-400" />
                <input
                  type="date"
                  className="px-3 py-1.5 border border-gray-600 rounded-lg text-sm text-white bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={dateInputValue(date)}
                  onChange={(e) => setDate(e.target.value.replaceAll("-", ""))}
                />
              </div>
            </div>

            <button
              onClick={loadAll}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              {isLoading ? "Оновлення..." : "Оновити"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-4">
        {error && (
          <div className="bg-red-900/60 border border-red-700 rounded-xl p-3">
            <p className="text-red-200 text-sm">{error}</p>
          </div>
        )}
        {barError && (
          <div className="bg-yellow-900/60 border border-yellow-700 rounded-xl p-3">
            <p className="text-yellow-200 text-sm">{barError}</p>
          </div>
        )}

        {/* ===================== KPI CARDS ===================== */}
        {showMain && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <CreditCard className="w-4 h-4 text-green-400" />
                <span className="text-gray-400 text-xs font-medium">Виручка</span>
              </div>
              <p className="text-2xl font-bold">{money(totals.totalRevenue)} ₴</p>
            </div>

            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-blue-400" />
                <span className="text-gray-400 text-xs font-medium">Чеки</span>
              </div>
              <p className="text-2xl font-bold">{totals.totalChecks}</p>
            </div>

            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <CreditCard className="w-4 h-4 text-purple-400" />
                <span className="text-gray-400 text-xs font-medium">Серед. чек</span>
              </div>
              <p className="text-2xl font-bold">{money(totals.avgCheck)} ₴</p>
            </div>
          </div>
        )}

        {/* ===================== MAIN GRID ===================== */}
        {showMain && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

            {/* -------- LEFT COLUMN: Bar + Coffee (compact) -------- */}
            <div className="lg:col-span-3 space-y-4">

              {/* BAR CATEGORIES */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <h2 className="font-bold text-white text-base mb-3">🍺 Бар</h2>
                <div className="space-y-2">
                  {barCats.map((c, idx) => (
                    <div
                      key={c.category_id}
                      className="flex items-center justify-between bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${catColors[idx]}`} />
                        <span className="text-sm text-white">{c.name}</span>
                      </div>
                      <span className="text-lg font-bold text-white">{c.qty}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* COFFEE */}
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <h2 className="font-bold text-white text-base mb-3">☕ Кава</h2>

                <div className="space-y-2">
                  {/* Зал */}
                  <div className="bg-orange-900/20 border border-orange-700/40 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-orange-300/80">Зал</p>
                        <p className="text-sm font-semibold text-white">Кава в залі</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-white">{coffeeSplit.cat34.qty}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-1 pt-1 border-t border-orange-700/30">
                      <span className="text-xs text-orange-300/60">Закладок</span>
                      <span className="text-sm font-bold text-orange-300">{coffeeSplit.cat34.zakladki}</span>
                    </div>
                  </div>

                  {/* Штат */}
                  <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-amber-300/80">Персонал</p>
                        <p className="text-sm font-semibold text-white">Кава штат</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-white">{coffeeSplit.cat47.qty}</p>
                      </div>
                    </div>
                    <div className="flex justify-between items-center mt-1 pt-1 border-t border-amber-700/30">
                      <span className="text-xs text-amber-300/60">Закладок</span>
                      <span className="text-sm font-bold text-amber-300">{coffeeSplit.cat47.zakladki}</span>
                    </div>
                  </div>

                  {/* Итого */}
                  <div className="bg-gray-900/60 border-2 border-orange-600/40 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-orange-400">Всього</p>
                      <p className="text-xl font-bold text-orange-400">{coffeeSplit.overall.qty}</p>
                    </div>
                    <div className="flex justify-between items-center mt-1 pt-1 border-t border-orange-600/30">
                      <span className="text-xs text-gray-300">Закладок</span>
                      <span className="text-base font-bold text-orange-400">{coffeeSplit.overall.zakladki}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* -------- CENTER: Employees (one block, table) -------- */}
            <div className="lg:col-span-5">
              <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-700">
                  <h2 className="font-bold text-white text-base">👥 Співробітники</h2>
                  <p className="text-gray-400 text-xs">Продажі за {dateInputValue(date)}</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-700 text-xs text-gray-400 uppercase">
                        <th className="text-left px-4 py-2 font-medium">Ім'я</th>
                        <th className="text-right px-3 py-2 font-medium">Виручка</th>
                        <th className="text-right px-3 py-2 font-medium">Чеки</th>
                        <th className="text-right px-3 py-2 font-medium">Серед</th>
                        <th className="text-right px-4 py-2 font-medium">Міс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedEmployees.map((w, idx) => {
                        const uid = w.user_id;
                        const revenueUAH = Number(w.revenue || 0) / 100;
                        const checks = Number(w.clients || 0);
                        const avgDay = checks > 0 ? revenueUAH / checks : 0;
                        const avgMonth = avgPerMonthMap[uid];
                        const isBar = w.name?.toLowerCase().includes("бар");

                        return (
                          <tr
                            key={uid}
                            className={`border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors ${
                              idx === 0 ? "bg-gray-700/20" : ""
                            }`}
                          >
                            <td className="px-4 py-3">
                              <p className="font-semibold text-white text-sm">{w.name || "—"}</p>
                              <p className="text-xs text-gray-400">{isBar ? "Бармен" : "Офіціант"}</p>
                            </td>
                            <td className="text-right px-3 py-3">
                              <p className="font-bold text-white text-base">{money(revenueUAH)}₴</p>
                            </td>
                            <td className="text-right px-3 py-3">
                              <p className="font-bold text-white text-base">{checks}</p>
                            </td>
                            <td className="text-right px-3 py-3">
                              <p className="font-bold text-white text-base">{money(avgDay)}₴</p>
                            </td>
                            <td className="text-right px-4 py-3">
                              <p className="font-semibold text-gray-300 text-base">
                                {avgMonth != null ? `${money(avgMonth)}₴` : "—"}
                              </p>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>

                    {/* Footer totals */}
                    <tfoot>
                      <tr className="bg-gray-700/30 border-t-2 border-gray-600">
                        <td className="px-4 py-3">
                          <p className="font-bold text-white text-sm">Разом</p>
                        </td>
                        <td className="text-right px-3 py-3">
                          <p className="font-bold text-green-400 text-base">{money(totals.totalRevenue)}₴</p>
                        </td>
                        <td className="text-right px-3 py-3">
                          <p className="font-bold text-blue-400 text-base">{totals.totalChecks}</p>
                        </td>
                        <td className="text-right px-3 py-3">
                          <p className="font-bold text-purple-400 text-base">{money(totals.avgCheck)}₴</p>
                        </td>
                        <td className="text-right px-4 py-3">
                          <p className="text-gray-500 text-sm">—</p>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>

            {/* -------- RIGHT: Sauces & Extras -------- */}
            <div className="lg:col-span-4">
              <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-700">
                  <h2 className="font-bold text-white text-base">🥫 Соуси та допи</h2>
                  <p className="text-gray-400 text-xs">Виручка по співробітниках</p>
                </div>

                {SAUCE_CATEGORY_IDS.size === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-gray-400 text-sm">
                      Потрібно налаштувати category_id соусів та допів
                    </p>
                  </div>
                ) : saucesLoading ? (
                  <div className="p-6 text-center">
                    <RefreshCw className="w-5 h-5 text-gray-400 animate-spin mx-auto mb-2" />
                    <p className="text-gray-400 text-sm">Завантаження...</p>
                  </div>
                ) : saucesData ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-700 text-xs text-gray-400 uppercase">
                          <th className="text-left px-4 py-2 font-medium">Ім'я</th>
                          <th className="text-right px-3 py-2 font-medium">Сьогодні</th>
                          <th className="text-right px-4 py-2 font-medium">Місяць</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(saucesData.day?.by_waiter || []).map((w) => {
                          const monthRow = (saucesData.month?.by_waiter || []).find(
                            (m) => m.user_id === w.user_id
                          );
                          return (
                            <tr
                              key={w.user_id}
                              className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors"
                            >
                              <td className="px-4 py-3">
                                <p className="font-semibold text-white text-sm">{w.name || "—"}</p>
                              </td>
                              <td className="text-right px-3 py-3">
                                <p className="font-bold text-white text-base">
                                  {money(w.revenue ?? 0)}₴
                                </p>
                              </td>
                              <td className="text-right px-4 py-3">
                                <p className="font-semibold text-gray-300 text-base">
                                  {money(monthRow?.revenue ?? 0)}₴
                                </p>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-700/30 border-t-2 border-gray-600">
                          <td className="px-4 py-3">
                            <p className="font-bold text-white text-sm">Разом</p>
                          </td>
                          <td className="text-right px-3 py-3">
                            <p className="font-bold text-green-400 text-base">
                              {money(saucesData.day?.total?.revenue || 0)}₴
                            </p>
                          </td>
                          <td className="text-right px-4 py-3">
                            <p className="font-bold text-green-400 text-base">
                              {money(saucesData.month?.total?.revenue || 0)}₴
                            </p>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center">
                    <p className="text-gray-500 text-sm">Немає даних</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* Empty state */}
        {!loading && daySales.length === 0 && !error && (
          <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="font-semibold text-white mb-2">Немає даних</h3>
            <p className="text-gray-400 text-sm">Дані по продажам не знайдено</p>
          </div>
        )}
      </div>

      <div className="text-center py-3">
        <p className="text-gray-600 text-xs font-medium">GRECO Tech™</p>
      </div>
    </div>
  );
}
