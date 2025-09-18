import React, { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

/** ==================== helpers ==================== */
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

/** ==================== app ==================== */
export default function App() {
  const today = useMemo(() => yyyymmdd(), []);
  const [date, setDate] = useState(today);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // дані на день (по співробітниках)
  const [daySales, setDaySales] = useState([]);
  // середній чек за місяць у розрізі співробітників
  const [avgPerMonthMap, setAvgPerMonthMap] = useState({});

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const mFrom = firstDayOfMonthStr(date);
      const mTo = lastDayOfMonthStr(date);

      // waiters — за день
      const rDay = await fetch(
        `${API_BASE}/api/waiters-sales?dateFrom=${date}&dateTo=${date}`
      );
      const tDay = await rDay.text();
      if (!rDay.ok) throw new Error(tDay);
      const dDay = JSON.parse(tDay || "{}");
      const dayList = Array.isArray(dDay?.response) ? dDay.response : [];

      // waiters — за місяць (для середнього чека / міс)
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
      setError(
        "Не вдалося завантажити дані. Перевір адресу API, токен або дату."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [date]);

  // автооновлення кожні 5 хв
  useEffect(() => {
    const id = setInterval(loadAll, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [date]);

  return (
    <div className="min-h-screen bg-black text-white relative">
      <div className="max-w-6xl mx-auto p-4 pb-20">
        {/* header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <h1 className="text-2xl font-semibold">
            Зміна: продажі офіціантів (за день)
          </h1>
          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-400">Дата:</label>
            <input
              type="date"
              className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2"
              value={dateInputValue(date)}
              onChange={(e) =>
                setDate(e.target.value.replaceAll("-", ""))
              }
            />
            <button
              onClick={loadAll}
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
              title="Оновити (автооновлення кожні 5 хв)"
            >
              Оновити
            </button>
          </div>
        </header>

        {/* повідомлення */}
        {loading && (
          <div className="animate-pulse text-neutral-300 mb-4">
            Завантаження…
          </div>
        )}
        {error && <div className="text-red-400 mb-4">{error}</div>}

        {/* карточки співробітників — компактний вигляд */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {daySales.map((w) => {
              const uid = w.user_id;
              const revenueUAH = Number(w.revenue || 0) / 100;
              const checks = Number(w.clients || 0);
              const avgDay = checks > 0 ? revenueUAH / checks : 0;
              const avgMonth = avgPerMonthMap[uid];

              return (
                <div
                  key={uid}
                  className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
                >
                  {/* Ім’я */}
                  <h3 className="text-lg font-medium mb-3">
                    {w.name || "—"}
                  </h3>

                  {/* 4 ключові метрики з виділенням значень */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-400">Виручка:</span>
                      <span className="text-xl font-semibold">
                        {money(revenueUAH)} ₴
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-neutral-400">Кільк чеків:</span>
                      <span className="text-xl font-semibold">
                        {checks.toLocaleString("uk-UA")}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-neutral-400">Серед чек:</span>
                      <span className="text-xl font-semibold">
                        {money(avgDay)} ₴
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-neutral-400">Серед чек/міс:</span>
                      <span className="text-xl font-semibold">
                        {avgMonth != null ? `${money(avgMonth)} ₴` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {daySales.length === 0 && !error && (
              <div className="text-neutral-400">
                Немає даних за обрану дату.
              </div>
            )}
          </div>
        )}
      </div>

      {/* логотип */}
      <div className="fixed right-3 bottom-3 text-xs text-neutral-500/80 select-none">
        GRECO Tech ™
      </div>
    </div>
  );
}
