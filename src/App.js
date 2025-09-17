import React, { useEffect, useMemo, useRef, useState } from "react";
import { Users, TrendingUp, Receipt, DollarSign } from "lucide-react";

/** ===== Настройки ===== */
const API_BASE = "https://api.joinposter.com/api";
const REFRESH_MS = 300_000; // 5 минут
const REQUEST_TIMEOUT_MS = 10_000;
const TZ = "Europe/Kyiv";

/** ===== Утилиты ===== */
const env = (k) => process.env[k];
const getToken = () => env("REACT_APP_POSTER_TOKEN") || "";
const getSpotId = () => env("REACT_APP_POSTER_SPOT_ID") || "";

const ymd = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

const fmtUAH = (n) =>
  new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    maximumFractionDigits: 0,
  }).format(n || 0);

async function posterGet(path, token, params = {}) {
  const url = new URL(`${API_BASE}/${path}`);
  url.search = new URLSearchParams({ token, ...params }).toString();

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (data?.error) throw new Error(data.error?.message || "Poster API error");
    return data?.response ?? data ?? [];
  } finally {
    clearTimeout(t);
  }
}

/** ===== Компонент ===== */
export default function PosterEmployeeDashboard() {
  const [rows, setRows] = useState([]); // [{id,name,checks,revenue,avg}]
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [manualToken, setManualToken] = useState(""); // если решишь вводить руками
  const [showToken, setShowToken] = useState(false);

  const token = useMemo(() => manualToken || getToken(), [manualToken]);
  const spotId = useMemo(() => getSpotId(), []);
  const today = useMemo(() => ymd(new Date()), []);

  const intervalRef = useRef(null);
  const inflightRef = useRef(false);
  const visibleRef = useRef(document.visibilityState === "visible");

  const totalRevenue = rows.reduce((s, x) => s + x.revenue, 0);
  const totalChecks = rows.reduce((s, x) => s + x.checks, 0);
  const avgOverall =
    totalChecks > 0 ? Math.round((totalRevenue / totalChecks) * 100) / 100 : 0;

  useEffect(() => {
    if (!token) {
      setShowToken(true);
      setErr(
        "Токен Poster не найден. Добавьте REACT_APP_POSTER_TOKEN в переменные Render."
      );
      return;
    }
    setShowToken(false);
    safeLoad(); // первичная загрузка

    // автообновление каждые 5 минут (только когда вкладка активна)
    intervalRef.current = setInterval(() => {
      if (visibleRef.current) safeLoad();
    }, REFRESH_MS);

    // пауза при сворачивании вкладки
    const onVis = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current) safeLoad();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function safeLoad() {
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      setErr("");
      setLoading(true);

      // 1) сотрудники (для красивых имён)
      const employees = await posterGet("access.getEmployees", token);
      const byIdEmp = new Map(
        (employees || []).map((e) => [String(e.employee_id ?? e.id), e])
      );

      // 2) чеки за сегодня и, опционально, по точке
      const p = { dateFrom: today, dateTo: today };
      if (spotId) p.spot_id = spotId;

      const receipts = await posterGet("finance.report.receipts", token, p);

      // нормализация + агрегация по сотруднику
      const pickNum = (r, keys, def = 0) => {
        for (const k of keys) {
          const v = Number(r?.[k]);
          if (Number.isFinite(v)) return v;
        }
        return def;
      };
      const pickStr = (r, keys, def = "") => {
        for (const k of keys) {
          if (r?.[k] != null) return String(r[k]);
        }
        return def;
      };

      const byId = new Map();
      for (const r of receipts || []) {
        const id =
          pickStr(r, ["waiter_id", "cashier_id", "user_id", "employee_id"], "unknown") ||
          "unknown";
        const sum = pickNum(r, ["total_sum", "sum", "total", "totalPrice"], 0);

        const prev = byId.get(id) || { id, name: "", revenue: 0, checks: 0 };
        prev.revenue += sum;
        prev.checks += 1;
        byId.set(id, prev);
      }

      const list = Array.from(byId.values()).map((x) => {
        const e = byIdEmp.get(String(x.id));
        const name =
          x.name ||
          e?.employee_name ||
          pickStr(e, ["name", "title", "employee_name"], "Невідомо");
        const avg = x.checks ? Math.round((x.revenue / x.checks) * 100) / 100 : 0;
        return { ...x, name, avg };
      });

      list.sort((a, b) => b.revenue - a.revenue);
      setRows(list);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
      inflightRef.current = false;
    }
  }

  /** ===== UI ===== */

  if (showToken) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <Users className="w-12 h-12 text-blue-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold">Введите токен Poster</h1>
            <p className="text-gray-600 mt-2">
              В Render добавьте <code>REACT_APP_POSTER_TOKEN</code>.
            </p>
          </div>
          <input
            className="w-full px-3 py-2 border rounded mb-3"
            placeholder="861052:xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
          />
          <button
            className="w-full bg-blue-600 text-white py-2 rounded disabled:opacity-50"
            disabled={!manualToken.trim()}
            onClick={() => setShowToken(false)}
          >
            Подключиться
          </button>
          {err ? (
            <p className="mt-4 text-sm text-red-600 text-center">{err}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto" />
          <p className="mt-4 text-gray-600">Загружаем данные…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Users className="w-8 h-8 text-blue-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold">Вырочка по сотрудникам</h1>
                <p className="text-gray-500">
                  Сегодня, {new Date().toLocaleDateString("uk-UA")}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-6">
              <div className="text-right">
                <p className="text-sm text-gray-500">Чеков</p>
                <p className="text-xl font-semibold">{totalChecks}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Средний чек</p>
                <p className="text-xl font-semibold">{fmtUAH(avgOverall)}</p>
              </div>
              <button
                onClick={safeLoad}
                className="bg-blue-600 text-white px-4 py-2 rounded"
              >
                Обновить
              </button>
            </div>
          </div>

          <div className="mt-4 text-2xl font-bold">{fmtUAH(totalRevenue)}</div>
          <div className="text-gray-500 text-sm">Сумма продаж за день</div>

          {err ? (
            <div className="mt-4 text-sm text-red-600">Ошибка: {err}</div>
          ) : null}
        </div>

        {/* Grid */}
        {rows.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-gray-700">Нет данных за сегодня</h2>
            <p className="text-gray-500">
              Проверьте токен/точку или попробуйте позже.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rows.map((s) => (
              <div key={s.id} className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mr-4">
                    <span className="text-blue-700 font-semibold">
                      {(s.name || "N")[0]}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">{s.name || "Невідомо"}</h3>
                    <p className="text-sm text-gray-500">ID: {s.id}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <TrendingUp className="w-5 h-5 text-green-600 mx-auto mb-1" />
                    <p className="text-xs text-gray-500">Выручка</p>
                    <p className="font-semibold">{fmtUAH(s.revenue)}</p>
                  </div>
                  <div className="text-center">
                    <Receipt className="w-5 h-5 text-blue-600 mx-auto mb-1" />
                    <p className="text-xs text-gray-500">Чеки</p>
                    <p className="font-semibold">{s.checks}</p>
                  </div>
                  <div className="text-center">
                    <DollarSign className="w-5 h-5 text-purple-600 mx-auto mb-1" />
                    <p className="text-xs text-gray-500">Средний чек</p>
                    <p className="font-semibold">{fmtUAH(s.avg)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-xs text-gray-400 mt-6">
          Источник: Poster <code>access.getEmployees</code> +{" "}
          <code>finance.report.receipts</code>. 2 запроса. Обновление каждые 5 минут.
        </div>
      </div>
    </div>
  );
}
