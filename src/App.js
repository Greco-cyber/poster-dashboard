import React, { useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Users, CreditCard, Clock, RefreshCw } from "lucide-react";

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

export default function App() {
  const today = useMemo(() => yyyymmdd(), []);
  const [date, setDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [daySales, setDaySales] = useState([]);
  const [avgPerMonthMap, setAvgPerMonthMap] = useState({});

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const mFrom = firstDayOfMonthStr(date);
      const mTo = lastDayOfMonthStr(date);

      const rDay = await fetch(
        `${API_BASE}/api/waiters-sales?dateFrom=${date}&dateTo=${date}`
      );
      const tDay = await rDay.text();
      if (!rDay.ok) throw new Error(tDay);
      const dDay = JSON.parse(tDay || "{}");
      const dayList = Array.isArray(dDay?.response) ? dDay.response : [];

      const rMonth = await fetch(
        `${API_BASE}/api/waiters-sales?dateFrom=${mFrom}&dateTo=${mTo}`
      );
      const tMonth = await rMonth.text();
      if (!rMonth.ok) throw new Error(tMonth);
      const dMonth = JSON.parse(tMonth || "{}");
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
  }

  useEffect(() => {
    loadAll();
  }, [date]);

  useEffect(() => {
    const id = setInterval(loadAll, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [date]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalRevenue = daySales.reduce((sum, w) => sum + (Number(w.revenue || 0) / 100), 0);
    const totalChecks = daySales.reduce((sum, w) => sum + Number(w.clients || 0), 0);
    const avgCheck = totalChecks > 0 ? totalRevenue / totalChecks : 0;
    
    return { totalRevenue, totalChecks, avgCheck };
  }, [daySales]);

  // лидерборд: Δ средний чек (день — міс)
  const avgDiff = useMemo(() => {
    return daySales.map((w) => {
      const uid = w.user_id;
      const revenueUAH = Number(w.revenue || 0) / 100;
      const checks = Number(w.clients || 0);
      const avgDay = checks > 0 ? revenueUAH / checks : 0;
      const avgMonth = avgPerMonthMap[uid] ?? 0;
      const diff = avgDay - avgMonth;
      return {
        id: uid,
        name: w.name,
        role: w.name?.toLowerCase().includes("бар") ? "бармен" : "офіціант",
        diff,
        avgDay,
        avgMonth,
        revenue: revenueUAH,
        checks
      };
    });
  }, [daySales, avgPerMonthMap]);

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
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Оновлення...' : 'Оновити'}
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

        {/* Summary Row */}
        {!loading && daySales.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-5 h-5 text-green-400" />
                <span className="text-gray-300 text-sm font-medium">Виручка</span>
              </div>
              <p className="text-2xl font-bold text-white">{money(totals.totalRevenue)} ₴</p>
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
                <TrendingUp className="w-5 h-5 text-purple-400" />
                <span className="text-gray-300 text-sm font-medium">Серед. чек</span>
              </div>
              <p className="text-2xl font-bold text-white">{money(totals.avgCheck)} ₴</p>
            </div>
          </div>
        )}

        {/* Main Content Grid */}
        {!loading && daySales.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[calc(100vh-280px)]">
            
            {/* Left Column: Performance Ranking - Smaller */}
            <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700">
                <h2 className="font-semibold text-white text-sm">Рейтинг ефективності</h2>
                <p className="text-gray-400 text-xs">Δ середній чек (день - місяць)</p>
              </div>
              <div className="divide-y divide-gray-700 overflow-y-auto h-full">
                {avgDiff
                  .sort((a, b) => b.diff - a.diff)
                  .map((w, i) => (
                    <div key={w.id} className="px-4 py-3 hover:bg-gray-750 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-6 h-6 bg-gray-700 rounded-full flex items-center justify-center">
                            <span className="text-xs font-semibold text-gray-300">{i + 1}</span>
                          </div>
                          <div>
                            <p className="font-medium text-white text-sm">{w.name}</p>
                            <p className="text-xs text-gray-400">{w.role}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`text-sm font-semibold ${w.diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {w.diff >= 0 ? '+' : ''}{money(w.diff)} ₴
                          </span>
                          {w.diff >= 0 ? (
                            <TrendingUp className="w-4 h-4 text-green-400" />
                          ) : (
                            <TrendingDown className="w-4 h-4 text-red-400" />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Right Columns: Employee Grid - Larger, More Readable */}
            <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 overflow-y-auto h-full">
              {daySales
                .sort((a, b) => (Number(b.revenue || 0) - Number(a.revenue || 0)))
                .map((w) => {
                  const uid = w.user_id;
                  const revenueUAH = Number(w.revenue || 0) / 100;
                  const checks = Number(w.clients || 0);
                  const avgDay = checks > 0 ? revenueUAH / checks : 0;
                  const avgMonth = avgPerMonthMap[uid];
                  const diff = avgDay - (avgMonth || 0);

                  return (
                    <div key={uid} className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="font-semibold text-white text-base">
                            {w.name || "—"}
                          </h3>
                          <p className="text-gray-400 text-sm">
                            {w.name?.toLowerCase().includes("бар") ? "Бармен" : "Офіціант"}
                          </p>
                        </div>
                        {avgMonth != null && (
                          <div className="flex items-center gap-1">
                            <span className={`text-sm font-semibold ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {diff >= 0 ? '+' : ''}{money(diff)}₴
                            </span>
                            {diff >= 0 ? (
                              <TrendingUp className="w-4 h-4 text-green-400" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-red-400" />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-400 font-medium mb-1">Виручка</p>
                          <p className="font-bold text-white text-lg">{money(revenueUAH)} ₴</p>
                        </div>
                        <div>
                          <p className="text-gray-400 font-medium mb-1">Чеки</p>
                          <p className="font-bold text-white text-lg">{checks}</p>
                        </div>
                        <div>
                          <p className="text-gray-400 font-medium mb-1">Серед. чек</p>
                          <p className="font-bold text-white text-lg">{money(avgDay)} ₴</p>
                        </div>
                        <div>
                          <p className="text-gray-400 font-medium mb-1">Серед/міс</p>
                          <p className="font-semibold text-gray-300 text-base">
                            {avgMonth != null ? `${money(avgMonth)} ₴` : "—"}
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
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-700">
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
