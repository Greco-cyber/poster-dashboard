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

  // ✅ ОБНОВЛЕНО: добавили "кава в зал" (424,425,441,423) + 422 уже был
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

        // кава в зал (добавлено)
        [422, 1],
        [423, 2], // ✅ 2 закладки
        [424, 1],
        [425, 1],
        [441, 1],

        // cat 47
        [529, 1],
        [530, 2],
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

  useEffect(() =>̆
    {
      const id = setInterval(loadAll, 5 * 60 * 1000);
      return () => clearInterval(id);
    },
    [loadAll]
  );

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
        name: fallback, // Використовуємо фіксовані назви
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

  // ✅ ОБНОВЛЕНО: cat34Set добавили 423,424,425,441
  const coffeeSplit = useMemo(() => {
    const by = coffee.by_product;

    const cat34Set = new Set([
      230, 485, 307, 231, 316, 406, 183, 182, 317,
      422, 423, 424, 425, 441, // ✅ добавлены
    ]);

    const cat47Set = new Set([529, 530, 533, 534, 535]);

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
      {/* ... дальше у тебя идет JSX без изменений ... */}
      {/* Я не трогаю остальную верстку, потому что ты просил только подсчет */}
    </div>
  );
}
