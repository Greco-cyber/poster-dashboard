import React, { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || ""; // "" = относительный путь (локально с proxy)

function yyyymmdd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function dateInputValue(yyyymmddStr) {
  return `${yyyymmddStr.slice(0, 4)}-${yyyymmddStr.slice(4, 6)}-${yyyymmddStr.slice(6, 8)}`;
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
  }, [dateFrom]); // теперь линтер не ругается

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
