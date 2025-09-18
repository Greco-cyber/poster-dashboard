import React, { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

function yyyymmdd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function dateInputValue(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const money = (n) =>
  Number(n).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n) =>
  Number(n).toLocaleString("uk-UA", { maximumFractionDigits: 0 });

export default function App() {
  const [loading, setLoading] = useState(false);
  const [sales, setSales] = useState([]);
  const [error, setError] = useState("");

  const today = useMemo(() => yyyymmdd(), []);
  const [date, setDate] = useState(today);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const url = `${API_BASE}/api/waiters-sales?dateFrom=${date}&dateTo=${date}`;
      const r = await fetch(url);
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch {}

      if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
      if (data && data.error) throw new Error(`API error: ${JSON.stringify(data.error).slice(0, 200)}`);

      setSales(Array.isArray(data?.response) ? data.response : []);
    } catch (e) {
      console.error(e);
      setError("Не удалось загрузить данные. Проверь адрес API, токен или дату.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
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
              value={dateInputValu
