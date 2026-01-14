import React, { useEffect, useMemo, useState } from "react";
import { Users, CreditCard, Clock, RefreshCw } from "lucide-react";

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

  // BAR block state
  const [barLoading, setBarLoading] = useState(false);
  const [barError, setBarError] = useState("");
  const [barData, setBarData] = useState(null);

  // --- Coffee product sets for category split (robust even if backend category_id is missing)
  const COFFEE_CAT_34 = useMemo(
    () =>
      new Set([
        230, 485, 307, 231, 316, 406, 183, 182, 317, // cat 34
      ]),
    []
  );
  const COFFEE_CAT_47 = useMemo(
    () =>
      new Set([
        529, 530, 533, 534, 535, // cat 47 (530 = 2 закладки)
      ]),
    []
  );

  async function fetchJsonOrThrow(url) {
    const r = await fetch(url);
    const t = await r.text();
    if (!r.ok) throw new Error(t || `HTTP ${r.status}`);
    return JSON.parse(t || "{}");
  }

  async function loadAll() {
    setLoading(true);
    setError("");

    // Бар не должен ломать весь экран — грузим отдельно и мягко
    setBarLoading(true);
    setBarError("");

    try {
      const mFrom = firstDayOfMonthStr(date);
      const mTo = lastDayOfMonthStr(date);

      // 1) Day waiters
      const dDay = await fetchJsonOrThrow(
        `${API_BASE}/api/waiters-sales?dateFrom=${date}&dateTo=${date}`
      );
      const dayList = Array.isArray(dDay?.response) ? dDay.response : [];

      // 2) Month waiters (for avg check per month)
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
    } finally {
      setLoading(false);
    }

    // BAR fetch (separately)
    try {
      const dBar = await fetchJsonOrThrow(
        `${API_BASE}/api/bar-sales?dateFrom=${date}&dateTo=${date}`
      );

      // Защита на фронте: принудительно фиксируем закладки (530 = 2)
      const shotsOverride = new Map([
        [230, 1],
        [485, 1],
        [307, 2],
        [231, 1],
        [316, 1],
        [406, 1],
        [183, 1],
        [182, 1],
        [317, 1],
        [529, 1],
        [530, 2], // ✅ фикс
        [533, 1],
        [534, 1],
        [535, 1],
      ]);

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
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    const id = setInterval(loadAll, 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalRevenue = daySales.reduce(
      (sum, w) => sum + Number(w.revenue || 0) / 100,
      0
    );
    const totalChecks = daySales.reduce((sum, w) => sum + Number(w.clients || 0), 0);
    const avgCheck = totalChecks > 0 ? totalRevenue / totalChecks : 0;

    return { totalRevenue, totalChecks, avgCheck };
  }, [daySales]);

  // BAR helpers
  const barCats = useMemo(() => {
    const arr = Array.isArray(barData?.categories) ? barData.categories : [];
    const map = new Map(arr.map((x) => [Number(x.category_id), x]));
    const pick = (id, nameFallback) => {
      const v = map.get(id);
      return {
        category_id: id,
        name: safeText(v?.name, nameFallback),
        qty: Number(v?.qty || 0),
        sum_uah: Number(v?.sum_uah || 0),
      };
    };
    return [
      pick(9, "Категорія 9"),
      pick(14, "Категорія 14"),
      pick(34, "Кофе (кат.34)"),
    ];
  }, [barData]);

  const coffee = useMemo(() => {
    const c = barData?.coffee || {};
    const by = Array.isArray(c.by_product) ? c.by_product : [];
    return {
      total_qty: Number(c.total_qty || 0),
      total_zakladki: Number(c.total_zakladki || 0),
      by_product: by,
    };
  }, [barData]);

  // ✅ Separate totals: cat 34 vs cat 47 (using product_id sets as the source of truth)
  const coffeeSplit = useMemo(() => {
    const by = coffee.by_product || [];

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

    const c34 = sumForSet(COFFEE_CAT_34);
    const c47 = sumForSet(COFFEE_CAT_47);

    return {
      cat34: c34,
      cat47: c47,
      // fallback: if by_product has unknown coffee ids in future, keep overall from backend
      overall: { qty: coffee.total_qty, zakladki: coffee.total_zakladki },
    };
  }, [coffee.by_product, coffee.total_qty, coffee.total_zakladki, COFFEE_CAT_34, COFFEE_CAT_47]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Compact Header */}
      <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-xl font-bold text-white">Продажі</h1>
                <p className="text-gray-400 text-xs">Звіт за день</p>
              </div>

              {/* Date Picker - Inline */}
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
        {/* Error */}
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

        {/* Summary Row */}
        {!loading && daySales.length > 0 && (
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

        {/* Main Content Grid */}
        {!loading && daySales.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-[calc(100vh-280px)]">
            {/* Left Column: BAR */}
            <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-hidden flex flex-col">
              <div className="px-3 py-2 border-b border-gray-700">
                <h2 className="font-semibold text-white text-sm">Бар</h2>
                <p className="text-gray-400 text-sm">Продажі по категоріям + закладки кофе</p>
              </div>

              <div className="p-3 space-y-4 overflow-y-auto">
                {/* Categories 9/14/34 */}
                <div className="bg-gray-900/40 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-white">Категорії (за день)</p>
                    <span className="text-xs text-gray-400">{dateInputValue(date)}</span>
                  </div>

                  <div className="space-y-2">
                    {barCats.map((c) => (
                      <div
                        key={c.category_id}
                        className="flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-gray-200 truncate">
                            {c.name} <span className="text-gray-500">#{c.category_id}</span>
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-white">{c.qty} шт</p>
                          <p className="text-xs text-gray-400">{money(c.sum_uah)} ₴</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Coffee shots */}
                <div className="bg-gray-900/40 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-white">Кофе: закладки</p>
                    <span className="text-xs text-gray-400">кат. 34 + 47</span>
                  </div>

                  {/* ✅ Split totals rows */}
                  <div className="space-y-2 mb-3">
                    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-2 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-400">Кофе</p>
                        <p className="text-sm font-semibold text-white">Категорія 34</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-white">{coffeeSplit.cat34.qty} шт</p>
                        <p className="text-xs text-gray-300">
                          {coffeeSplit.cat34.zakladki} закл
                        </p>
                      </div>
                    </div>

                    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-2 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-400">Кофе штат</p>
                        <p className="text-sm font-semibold text-white">Категорія 47</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-white">{coffeeSplit.cat47.qty} шт</p>
                        <p className="text-xs text-gray-300">
                          {coffeeSplit.cat47.zakladki} закл
                        </p>
                      </div>
                    </div>

                    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-2 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-400">Разом</p>
                        <p className="text-sm font-semibold text-white">Всього</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-white">{coffeeSplit.overall.qty} шт</p>
                        <p className="text-xs text-gray-300">
                          {coffeeSplit.overall.zakladki} закл
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Table by product */}
                  <div className="space-y-2">
                    {coffee.by_product.length === 0 && (
                      <p className="text-sm text-gray-400">Немає продажів по кофе.</p>
                    )}

                    {coffee.by_product.map((p) => (
                      <div
                        key={p.product_id}
                        className="bg-gray-800/60 border border-gray-700 rounded-lg p-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">
                              {safeText(p.name, "Товар")}
                            </p>
                            <p className="text-xs text-gray-400">
                              ID {p.product_id}
                              {p.category_id != null ? ` • cat ${p.category_id}` : ""}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-white">{Number(p.qty || 0)} шт</p>
                            <p className="text-xs text-gray-300">
                              {Number(p.zakladki_total || 0)} закл{" "}
                              <span className="text-gray-500">
                                ({Number(p.zakladki_per_unit || 0)}/шт)
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Warnings from backend (if any) */}
                  {Array.isArray(barData?.warnings) && barData.warnings.length > 0 && (
                    <div className="mt-3 bg-yellow-900/30 border border-yellow-700 rounded-lg p-2">
                      <p className="text-xs text-yellow-200 font-semibold mb-1">Увага:</p>
                      <ul className="text-xs text-yellow-200 space-y-1 list-disc pl-4">
                        {barData.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Columns: Employee Grid - All Employees Visible */}
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
                    <div key={uid} className="bg-gray-800 rounded-lg border border-gray-700 p-3">
                      {/* Header - Name */}
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

                      {/* Compact Stats - Single Row */}
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

        {/* Loading State - Dark Theme */}
        {(loading || barLoading) && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-700"
              >
                <div className="animate-pulse">
                  <div className="flex items-center justify-between mb-3">
                    <div className="space-y-2">
                      <div className="h-4 bg-gray-600 rounded w-24"></div>
                      <div className="h-3 bg-gray-600 rounded w-16"></div>
                    </div>
                    <div className="h-3 w-8 bg-gray-600 rounded"></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="h-3 bg-gray-600 rounded w-16 mb-1"></div>
                      <div className="h-4 bg-gray-600 rounded w-20"></div>
                    </div>
                    <div>
                      <div className="h-3 bg-gray-600 rounded w-12 mb-1"></div>
                      <div className="h-4 bg-gray-600 rounded w-16"></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State - Dark Theme */}
        {!loading && daySales.length === 0 && !error && (
          <div className="bg-gray-800 rounded-xl p-8 shadow-lg border border-gray-700 text-center">
            <Users className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="font-semibold text-white mb-2">Немає даних</h3>
            <p className="text-gray-400 text-sm">Дані по продажам не знайдено</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center py-4">
        <p className="text-gray-500 text-xs font-medium">GRECO Tech™</p>
      </div>
    </div>
  );
}
