import React, { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || ""; // "" => относительный путь (локально через proxy)

function yyyymmdd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function dateInputValue(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export default function App() {
  const [loading, setLoading] = useState(false);
  const [sales, setSales] = useState([]);
  const [error, setError] = useState("");

  const today = useMemo(() => yyyymmdd(), []);
  const [dateFrom, setDateFrom] = useState(today);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const finalUrl = API_BASE
        ? `${API_BASE}/api/waiters-sales?dateFrom=${dateFrom}`
        : `/api/waiters-sales?dateFrom=${dateFrom}`;

      const r = await fetch(finalUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setSales(Array.isArray(data?.response) ? data.response : []);
    } catch (e) {
      console.error(e);
      setError("Не удалось загрузить данные. Проверь API/токен/дату.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [dateFrom]);

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto p-4">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-semibold">Смена: продажи официантов</h1>

          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-400">Дата:</label>
            <input
              type="date"
              className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2"
              value={dateInputValue(dateFrom)}
              onChange={(e) => setDateFrom(e.target.value.replaceAll("-", ""))}
            />
            <button
              onClick={load}
              className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
            >
              Обновить
            </button>
          </div>
        </header>

        {loading && <div className="animate-pulse text-neutral-300">Загружаю…</div>}
        {error && <div className="text-red-400">{error}</div>}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sales.map((w) => (
              <div
                key={w.user_id}
                className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-lg font-medium">{w.name || "—"}</div>
                  <div className="text-xs text-neutral-500">ID {w.user_id}</div>
                </div>
                <div className="space-y-1 text-sm">
                  <div>Выручка: {Number(w.revenue || 0).toLocaleString("uk-UA")}</div>
                  <div>Прибыль (брутто): {Number(w.profit || 0).toLocaleString("uk-UA")}</div>
                  <div>Прибыль (нетто): {Number(w.profit_netto || 0).toLocaleString("uk-UA")}</div>
                  <div>Клиенты: {Number(w.clients || 0).toLocaleString("uk-UA")}</div>
                  <div>
                    Ср. чек: {Math.round(Number(w.middle_invoice || 0)).toLocaleString("uk-UA")}
                  </div>
                  {w.middle_time != null && (
                    <div>
                      Ср. время, сек: {Math.round(Number(w.middle_time)).toLocaleString("uk-UA")}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sales.length === 0 && (
              <div className="text-neutral-400">Нет данных за выбранную дату.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
