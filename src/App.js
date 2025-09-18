import React, { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

// --- utils ---
function yyyymmdd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function dateInputValue(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function firstDayOfMonthStr(s) {
  // YYYYMM01
  return `${s.slice(0, 4)}${s.slice(4, 6)}01`;
}
function lastDayOfMonthStr(s) {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)); // 1..12
  const last = new Date(y, m, 0); // последний день месяца
  const pad = (n) => String(n).padStart(2, "0");
  return `${last.getFullYear()}${pad(last.getMonth() + 1)}${pad(last.getDate())}`;
}
const money = (n) =>
  Number(n).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n) => Number(n).toLocaleString("uk-UA", { maximumFractionDigits: 0 });

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // дневные данные по официантам
  const [daySales, setDaySales] = useState([]);
  // мапа user_id -> средний чек за месяц (в грн)
  const [avgPerMonthMap, setAvgPerMonthMap] = useState({});

  const today = useMemo(() => yyyymmdd(), []);
  const [date, setDate] = useState(today); // один выбранный день

  // основной лоадер: тянем ДЕНЬ и МЕСЯЦ
  async function load() {
    setLoading(true);
    setError("");
    try {
      const base = API_BASE || "";
      // День
      const dayUrl = `${base}/api/waiters-sales?dateFrom=${date}&dateTo=${date}`;
      // Месяц (тот, в который входит выбранный день)
      const mFrom = firstDayOfMonthStr(date);
      const mTo = lastDayOfMonthStr(date);
      const monthUrl = `${base}/api/waiters-sales?dateFrom=${mFrom}&dateTo=${mTo}`;

      const [rDay, rMonth] = await Promise.all([fetch(dayUrl), fetch(monthUrl)]);
      const [tDay, tMonth] = await Promise.all([rDay.text(), rMonth.text()]);

      if (!rDay.ok) throw new Error(`HTTP ${rDay.status}: ${tDay.slice(0, 200)}`);
      if (!rMonth.ok) throw new Error(`HTTP ${rMonth.status}: ${tMonth.slice(0, 200)}`);

      const dDay = JSON.parse(tDay || "{}");
      const dMonth = JSON.parse(tMonth || "{}");

      const dayList = Array.isArray(dDay?.response) ? dDay.response : [];
      const monthList = Array.isArray(dMonth?.response) ? dMonth.response : [];

      // суммы из Poster приходят в копейках → делим на 100
      // считаем средний чек за МЕСЯЦ для каждого user_id
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
      setError("Не удалось загрузить данные. Проверь адрес API, токен или дату.");
    } finally {
      setLoading(false);
    }
  }

  // загружаем при смене даты
  useEffect(() => {
    load();
  }, [date]);

  // автообновление каждые 5 минут
  useEffect(() => {
    const id = setInterval(() => {
      load();
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
    // привязываем к выбранной дате — при её смене таймер пересоздаётся
  }, [date]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto p-4">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-semibold">Смена: продажи официантов (за день)</h1>

          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-400">Дата:</label>
            <input
              type="date"
              className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2"
              value={dateInputValue(date)}
              onChange={(e) => setDate(e.target.value.replaceAll("-", ""))}
            />
            <button
              onClick={load}
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
              title="Обновить (автообновление каждые 5 минут включено)"
            >
              Обновить
            </button>
          </div>
        </header>

        {loading && <div className="animate-pulse text-neutral-300">Загружаю…</div>}
        {error && <div className="text-red-400">{error}</div>}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {daySales.map((w) => {
              // ДЕНЬ: суммы в копейках → делим на 100
              const revenueUAH = Number(w.revenue || 0) / 100;
              const checks = Number(w.clients || 0);
              const avgDay = checks > 0 ? revenueUAH / checks : 0;

              // МЕСЯЦ: уже посчитали карту средних чеков
              const avgMonth = avgPerMonthMap[w.user_id] ?? null;

              return (
                <div key={w.user_id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-lg font-medium">{w.name || "—"}</div>
                    <div className="text-xs text-neutral-500">ID {w.user_id}</div>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div>Выручка за день: {money(revenueUAH)} ₴</div>
                    <div>Количество чеков за день: {intf(checks)}</div>
                    <div>Средний чек за день: {money(avgDay)} ₴</div>
                    <div>Средний чек/мес: {avgMonth != null ? `${money(avgMonth)} ₴` : "—"}</div>
                  </div>
                </div>
              );
            })}
            {daySales.length === 0 && (
              <div className="text-neutral-400">Нет данных за выбранную дату.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
