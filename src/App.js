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

function safeText(s, fallback = "—") {
  const v = String(s || "").trim();
  return v ? v : fallback;
}

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

  // ✅ ОБНОВЛЕНО: 530=1, 531=2, + кава в зал, 423=2
  const shotsOverride = useMemo(
    () =>
      new Map([
        // cat 34
        [230, 1],
        [485, 1],
        [307, 2],
        [231, 1],
        [316, 1],
        [406, 1],
        [183, 1],
        [182, 1],
        [317, 1],

        // кава в зал
        [425, 1],
        [424, 1],
        [441, 1],
        [422, 1],
        [423, 2],

        // cat 47 (штат)
        [529, 1],
        [530, 1], // 🔁
        [531, 2], // ✅
        [533, 1],
        [534, 1],
        [535, 1],
      ]),
    []
  );

  const fetchJsonOrThrow = useCallback(async (url) => {
    const r = await fetch(url);
    const t = await r.text();
    if (!r.ok) {
      throw new Error(`${r.status} ${r.statusText}: ${t.slice(0, 250)}`);
    }
    return JSON.parse(t || "{}");
  }, []);

  const loadAll = useCallback(async () => {
    // Waiters
    setLoading(true);
    setError("");

    // Bar
    setBarLoading(true);
    setBarError("");

    try {
      const mFrom = firstDayOfMonthStr(date);
      const mTo = lastDayOfMonthStr(date);

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
      setError("Не вдалося завантажити дані. Перевір адресу API, токен або дату.");
      setDaySales([]);
      setAvgPerMonthMap({});
    } finally {
      setLoading(false);
    }

    // BAR load
    try {
      const dBar = await fetchJsonOrThrow(
        `${API_BASE}/api/bar-sales?dateFrom=${date}&dateTo=${date}`
      );

      // Patch coffee per-unit totals (front safety)
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

          return {
            ...row,
            zakladki_per_unit: per,
            zakladki_total: zak,
          };
        });

        patched.coffee = {
          ...patched.coffee,
          total_qty: totalQty,
          total_zakladki: totalZak,
          by_product: byProduct.sort(
            (a, b) => Number(b.qty || 0) - Number(a.qty || 0)
          ),
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
  }, [date, fetchJsonOrThrow, shotsOverride]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const id = setInterval(loadAll, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadAll]);

  // Totals
  const totals = useMemo(() => {
    const totalRevenue = daySales.reduce(
      (sum, w) => sum + Number(w.revenue || 0) / 100,
      0
    );
    const totalChecks = daySales.reduce(
      (sum, w) => sum + Number(w.clients || 0),
      0
    );
    const avgCheck = totalChecks > 0 ? totalRevenue / totalChecks : 0;
    return { totalRevenue, totalChecks, avgCheck };
  }, [daySales]);

  // BAR categories
  const barCats = useMemo(() => {
    const arr = Array.isArray(barData?.categories) ? barData.categories : [];
    const map = new Map(arr.map((x) => [Number(x.category_id), x]));

    const pick = (id, fallback) => {
      const v = map.get(id);
      return {
        category_id: id,
        name: fallback, // фикс. названия
        qty: Number(v?.qty || 0),
      };
    };

    return [
      pick(9, "Пиво"),
      pick(14, "Холодні напої"),
      pick(34, "Кава"),
    ];
  }, [barData]);

  // Coffee
  const coffee = useMemo(() => {
    const c = barData?.coffee || {};
    return {
      total_qty: Number(c.total_qty || 0),
      total_zakladki: Number(c.total_zakladki || 0),
      by_product: Array.isArray(c.by_product) ? c.by_product : [],
    };
  }, [barData]);

  // Split totals by categories using product_id mapping
  const coffeeSplit = useMemo(() => {
    const by = coffee.by_product;

    // ✅ cat 34 + кава в зал
    const cat34Set = new Set([
      230, 485, 307, 231, 316, 406, 183, 182, 317,
      425, 424, 441, 422, 423,
    ]);

    // ✅ cat 47 + 531
    const cat47Set = new Set([529, 530, 531, 533, 534, 535]);

    const sumForSet = (set) => {
      let qty = 0;
      let zak = 0;
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
  }, [coffee.by_product, coffee.total_qty, coffee.total_zakladki]);

  const showMain = !loading && daySales.length > 0;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
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
              disabled={loading || barLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading || barLoading ? "animate-spin" : ""}`}
              />
              {loading || barLoading ? "Оновлення..." : "Оновити"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-4">
        {error && (
          <div className="bg-red-900 border border-red-700 rounded-xl p-3">
            <p className="text-red-200 text-sm">{error}</p>
          </div>
        )}

        {barError && (
          <div className="bg-yellow-900 border border-yellow-700 rounded-xl p-3">
            <p className="text-yellow-200 text-sm">{barError}</p>
          </div>
        )}

        {/* Summary */}
        {showMain && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-5 h-5 text-green-400" />
                <span className="text-gray-300 text-sm font-medium">Виручка</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {money(totals.totalRevenue)} ₴
              </p>
            </div>

            <div className="bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-blue-400" />
                <span className="text-gray-300 text-sm font-medium">Чеки</span>
              </div>
              <p className="text-2xl font-bold text-white">{totals.totalChecks}</p>
            </div>

            <div className="bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-5 h-5 text-purple-400" />
                <span className="text-gray-300 text-sm font-medium">Серед. чек</span>
              </div>
              <p className="text-2xl font-bold text-white">
                {money(totals.avgCheck)} ₴
              </p>
            </div>
          </div>
        )}

        {/* Main grid */}
        {showMain && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-[calc(100vh-280px)]">
            {/* LEFT: Bar */}
            <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-gray-700 bg-gradient-to-r from-gray-800 to-gray-750">
                <h2 className="font-bold text-white text-lg">🍺 Бар</h2>
                <p className="text-gray-400 text-xs mt-0.5">
                  Продажі за {dateInputValue(date)}
                </p>
              </div>

              <div className="p-4 space-y-4 overflow-y-auto">
                {/* Categories */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Категорії напоїв
                  </h3>

                  <div className="space-y-2">
                    {barCats.map((c, idx) => (
                      <div
                        key={c.category_id}
                        className="bg-gray-900/50 hover:bg-gray-900/70 transition-colors border border-gray-700 rounded-lg p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                idx === 0
                                  ? "bg-amber-400"
                                  : idx === 1
                                  ? "bg-blue-400"
                                  : "bg-orange-400"
                              }`}
                            />
                            <p className="text-sm font-medium text-white">{c.name}</p>
                          </div>

                          <div className="text-right">
                            <p className="text-lg font-bold text-white">{c.qty}</p>
                            <p className="text-xs text-gray-400">шт</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Coffee shots */}
                <div className="pt-3 border-t border-gray-700">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    ☕ Закладки кави
                  </h3>

                  <div className="space-y-2">
                    <div className="bg-gradient-to-br from-orange-900/30 to-orange-800/20 border border-orange-700/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-xs text-orange-300/80 font-medium">Зал</p>
                          <p className="text-sm font-semibold text-white">Кава в залі</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-white">
                            {coffeeSplit.cat34.qty}
                          </p>
                          <p className="text-xs text-orange-200">шт</p>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-orange-700/30">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-orange-300/70">Закладок:</span>
                          <span className="text-sm font-bold text-orange-200">
                            {coffeeSplit.cat34.zakladki}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gradient-to-br from-amber-900/30 to-amber-800/20 border border-amber-700/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-xs text-amber-300/80 font-medium">Персонал</p>
                          <p className="text-sm font-semibold text-white">Кава штат</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-white">
                            {coffeeSplit.cat47.qty}
                          </p>
                          <p className="text-xs text-amber-200">шт</p>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-amber-700/30">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-amber-300/70">Закладок:</span>
                          <span className="text-sm font-bold text-amber-200">
                            {coffeeSplit.cat47.zakladki}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gradient-to-br from-gray-800 to-gray-750 border-2 border-orange-600/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-xs text-orange-400 font-medium">Разом</p>
                          <p className="text-base font-bold text-white">Всього кави</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-orange-400">
                            {coffeeSplit.overall.qty}
                          </p>
                          <p className="text-xs text-gray-300">шт</p>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-orange-600/30">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-gray-300">Закладок:</span>
                          <span className="text-lg font-bold text-orange-400">
                            {coffeeSplit.overall.zakladki}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* RIGHT: Employees */}
            <div className="lg:col-span-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-4 overflow-y-auto h-full">
              {daySales
                .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
                .map((w) => {
                  const uid = w.user_id;
                  const revenueUAH = Number(w.revenue || 0) / 100;
                  const checks = Number(w.clients || 0);
                  const avgDay = checks > 0 ? revenueUAH / checks : 0;
                  const avgMonth = avgPerMonthMap[uid];

                  return (
                    <div
                      key={uid}
                      className="bg-gray-800 rounded-lg border border-gray-700 p-3"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-white text-base truncate">
                            {w.name || "—"}
                          </h3>
                          <p className="text-gray-400 text-sm">
                            {w.name?.toLowerCase().includes("бар") ? "Бармен" : "Офіціант"}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 text-xl">
                        <div className="text-center">
                          <p className="text-gray-400 mb-1 text-xs">Виручка</p>
                          <p className="font-bold text-white">{money(revenueUAH)}₴</p>
                        </div>
                        <div className="text-center">
                          <p className="text-gray-400 mb-1 text-xs">Чеки</p>
                          <p className="font-bold text-white">{checks}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-gray-400 mb-1 text-xs">Серед</p>
                          <p className="font-bold text-white">{money(avgDay)}₴</p>
                        </div>
                        <div className="text-center">
                          <p className="text-gray-400 mb-1 text-xs">Міс</p>
                          <p className="font-semibold text-gray-300">
                            {avgMonth != null ? `${money(avgMonth)}₴` : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {!loading && daySales.length === 0 && !error && (
          <div className="bg-gray-800 rounded-xl p-8 shadow-lg border border-gray-700 text-center">
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="font-semibold text-white mb-2">Немає даних</h3>
            <p className="text-gray-400 text-sm">Дані по продажам не знайдено</p>
          </div>
        )}
      </div>

      <div className="text-center py-4">
        <p className="text-gray-500 text-xs font-medium">GRECO Tech™</p>
      </div>
    </div>
  );
}
