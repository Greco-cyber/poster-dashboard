import React, { useEffect, useMemo, useState } from "react";
import { ChevronRight, TrendingUp, TrendingDown, Users, CreditCard, Clock, RefreshCw } from "lucide-react";

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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Продажі</h1>
              <p className="text-gray-600 text-sm mt-1">Звіт за день</p>
            </div>
            <button
              onClick={loadAll}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-full font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Оновлення...' : 'Оновити'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Date Picker Card */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <Clock className="w-4 h-4 text-blue-600" />
              </div>
              <span className="font-medium text-gray-900">Дата</span>
            </div>
            <input
              type="date"
              className="px-3 py-2 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={dateInputValue(date)}
              onChange={(e) => setDate(e.target.value.replaceAll("-", ""))}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-red-600 text-sm font-bold">!</span>
              </div>
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        {!loading && daySales.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-green-600" />
                </div>
                <span className="text-gray-600 text-sm font-medium">Загальна виручка</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{money(totals.totalRevenue)} ₴</p>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                  <Users className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-gray-600 text-sm font-medium">Всього чеків</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{totals.totalChecks.toLocaleString('uk-UA')}</p>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-purple-600" />
                </div>
                <span className="text-gray-600 text-sm font-medium">Середній чек</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">{money(totals.avgCheck)} ₴</p>
            </div>
          </div>
        )}

        {/* Performance Leaderboard */}
        {!loading && avgDiff.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Рейтинг ефективності</h2>
              <p className="text-gray-600 text-sm mt-1">Різниця середнього чека (день - місяць)</p>
            </div>
            <div className="divide-y divide-gray-100">
              {avgDiff
                .sort((a, b) => b.diff - a.diff)
                .map((w, i) => (
                  <div key={w.id} className="px-4 py-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center w-8 h-8 bg-gray-100 rounded-full">
                          <span className="text-sm font-semibold text-gray-600">
                            {i + 1}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{w.name}</p>
                          <p className="text-sm text-gray-600">{w.role}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right mr-2">
                          <p className={`font-semibold ${w.diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {w.diff >= 0 ? '+' : ''}{money(w.diff)} ₴
                          </p>
                          <p className="text-xs text-gray-500">
                            {money(w.avgDay)} ₴ → {money(w.avgMonth)} ₴
                          </p>
                        </div>
                        {w.diff >= 0 ? (
                          <TrendingUp className="w-5 h-5 text-green-600" />
                        ) : (
                          <TrendingDown className="w-5 h-5 text-red-600" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Employee Cards */}
        {!loading && daySales.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 px-1">Детальна статистика</h2>
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
                  <div
                    key={uid}
                    className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
                  >
                    <div className="px-4 py-4">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="font-semibold text-gray-900 text-lg">
                            {w.name || "—"}
                          </h3>
                          <p className="text-gray-600 text-sm">
                            {w.name?.toLowerCase().includes("бар") ? "Бармен" : "Офіціант"}
                          </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-3">
                          <div>
                            <p className="text-gray-600 text-sm font-medium mb-1">Виручка</p>
                            <p className="text-xl font-bold text-gray-900">
                              {money(revenueUAH)} ₴
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-600 text-sm font-medium mb-1">Кількість чеків</p>
                            <p className="text-xl font-bold text-gray-900">
                              {checks.toLocaleString("uk-UA")}
                            </p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <p className="text-gray-600 text-sm font-medium mb-1">Середній чек (день)</p>
                            <p className="text-xl font-bold text-gray-900">
                              {money(avgDay)} ₴
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-600 text-sm font-medium mb-1">Середній чек (місяць)</p>
                            <p className="text-lg font-semibold text-gray-700">
                              {avgMonth != null ? `${money(avgMonth)} ₴` : "—"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {avgMonth != null && (
                        <div className="mt-4 pt-3 border-t border-gray-100">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 text-sm font-medium">Динаміка</span>
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {diff >= 0 ? '+' : ''}{money(diff)} ₴
                              </span>
                              {diff >= 0 ? (
                                <TrendingUp className="w-4 h-4 text-green-600" />
                              ) : (
                                <TrendingDown className="w-4 h-4 text-red-600" />
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <div className="animate-pulse">
                  <div className="flex items-center justify-between mb-4">
                    <div className="space-y-2">
                      <div className="h-5 bg-gray-200 rounded w-32"></div>
                      <div className="h-3 bg-gray-200 rounded w-20"></div>
                    </div>
                    <div className="h-5 w-5 bg-gray-200 rounded"></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div>
                        <div className="h-3 bg-gray-200 rounded w-16 mb-2"></div>
                        <div className="h-6 bg-gray-200 rounded w-24"></div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="h-3 bg-gray-200 rounded w-20 mb-2"></div>
                        <div className="h-6 bg-gray-200 rounded w-24"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && daySales.length === 0 && !error && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Немає даних</h3>
            <p className="text-gray-600 text-sm">
              Дані по продажам за вибрану дату не знайдено
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center py-8">
        <p className="text-gray-400 text-sm font-medium tracking-wide">
          GRECO Tech™
        </p>
      </div>
    </div>
  );
}
