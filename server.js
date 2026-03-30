// server.js
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const fetchFn = global.fetch;

// Берем значения либо из POSTER_*, либо из REACT_APP_* (как у тебя в Render)
const TOKEN =
  process.env.POSTER_TOKEN ||
  process.env.REACT_APP_POSTER_TOKEN ||
  "";

const ACCOUNT =
  process.env.POSTER_ACCOUNT ||
  process.env.REACT_APP_POSTER_ACCOUNT ||
  "";

// Если POSTER_BASE_URL не задан, пробуем собрать его из ACCOUNT
const POSTER_BASE =
  process.env.POSTER_BASE_URL ||
  process.env.REACT_APP_POSTER_BASE_URL ||
  (ACCOUNT ? `https://${ACCOUNT}.joinposter.com/api` : "https://joinposter.com/api");

function todayYYYYMMDD() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

async function poster(method, params = {}) {
  const url = new URL(`${POSTER_BASE}/${method}`);
  url.searchParams.set("token", TOKEN);

  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const r = await fetchFn(url.toString());
  const t = await r.text();

  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = { raw: t };
  }

  if (!r.ok) throw new Error(`${method} HTTP ${r.status}: ${t.slice(0, 400)}`);
  return j;
}

// -------------------- КЭШ: категории --------------------
let CATS_CACHE_AT = 0;
let CAT_NAME = new Map(); // cid -> name
const CATS_TTL_MS = 30 * 60 * 1000;

async function ensureCategories() {
  const now = Date.now();
  if (CAT_NAME.size && now - CATS_CACHE_AT < CATS_TTL_MS) return;

  try {
    const j = await poster("menu.getCategories");
    const arr = Array.isArray(j?.response) ? j.response : [];
    const map = new Map();

    for (const c of arr) {
      const cid = Number(c.category_id ?? c.id ?? c.menu_category_id);
      const name = String(c.category_name ?? c.name ?? "");
      if (Number.isFinite(cid)) map.set(cid, name);
    }

    if (map.size) {
      CAT_NAME = map;
      CATS_CACHE_AT = now;
    }
  } catch {
    // ignore
  }
}

// -------------------- КЭШ: продукты --------------------
let PRODUCTS_CACHE_AT = 0;
let PRODUCT_INFO = new Map(); // pid -> { name, category_id }
const PRODUCT_TTL_MS = 15 * 60 * 1000;

async function ensureProducts() {
  const now = Date.now();
  if (PRODUCT_INFO.size && now - PRODUCTS_CACHE_AT < PRODUCT_TTL_MS) return;

  const j = await poster("menu.getProducts");
  const arr = Array.isArray(j?.response) ? j.response : [];

  const map = new Map();
  for (const p of arr) {
    const pid = Number(p.product_id ?? p.id ?? p.menu_id ?? p.good_id);
    const cid = Number(p.menu_category_id ?? p.category_id ?? p.group_id ?? p.category);
    const name = String(p.product_name ?? p.name ?? "");
    if (Number.isFinite(pid)) {
      map.set(pid, { name, category_id: Number.isFinite(cid) ? cid : null });
    }
  }

  PRODUCT_INFO = map;
  PRODUCTS_CACHE_AT = now;
}

// -------------------- WAITERS --------------------
app.get("/api/waiters-sales", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN (or REACT_APP_POSTER_TOKEN) is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;
    const data = await poster("dash.getWaitersSales", { dateFrom, dateTo });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- ПРОДАЖИ ПО ТОВАРАМ (для кофе) --------------------
async function fetchProductsSales({ dateFrom, dateTo }) {
  const methods = [
    { m: "dash.getProductsSales", p: { dateFrom, dateTo } },
    { m: "dash.getProductsSales", p: {} },
    { m: "report.getProductsSales", p: { dateFrom, dateTo } },
    { m: "report.getProductsSales", p: {} },
    { m: "dash.getProducts", p: { dateFrom, dateTo } },
    { m: "dash.getProducts", p: {} },
  ];

  for (const cand of methods) {
    try {
      const j = await poster(cand.m, cand.p);

      const arr =
        [j?.response, j?.response?.products, j?.products, j?.data].find(Array.isArray) || [];

      if (!arr.length) continue;

      const norm = arr
        .map((x) => {
          const product_id = Number(x.product_id ?? x.menu_id ?? x.id ?? x.good_id);
          if (!Number.isFinite(product_id)) return null;

          const name = String(x.product_name ?? x.name ?? "");
          const qty = Number(x.count ?? x.quantity ?? x.qty ?? x.amount ?? 0) || 0;

          return { product_id, name, qty };
        })
        .filter(Boolean);

      if (norm.length) return { items: norm, used: cand };
    } catch {
      // next
    }
  }

  return { items: null, used: null };
}

// -------------------- BAR SALES --------------------
app.get("/api/bar-sales", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN (or REACT_APP_POSTER_TOKEN) is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    // Категории бара
    const BAR_CATS = [9, 14, 34];
    const want = new Set(BAR_CATS);

    await ensureCategories();

    // 1) Categories qty + name
    let categories = BAR_CATS.map((cid) => ({
      category_id: cid,
      name: CAT_NAME.get(cid) || `Категорія ${cid}`,
      qty: 0,
    }));

    try {
      const cats = await poster("dash.getCategoriesSales", { dateFrom, dateTo });
      const resp = Array.isArray(cats?.response) ? cats.response : [];

      const map = new Map();
      for (const x of resp) {
        const cid = Number(x.category_id);
        if (!want.has(cid)) continue;

        const nameFromDash = String(x.category_name ?? x.name ?? "");
        const name = CAT_NAME.get(cid) || nameFromDash || `Категорія ${cid}`;

        map.set(cid, {
          category_id: cid,
          name,
          qty: Number(x.count ?? x.qty ?? 0),
        });
      }

      categories = BAR_CATS.map((cid) => map.get(cid) || {
        category_id: cid,
        name: CAT_NAME.get(cid) || `Категорія ${cid}`,
        qty: 0,
      });
    } catch {
      // keep defaults
    }

    // 2) Coffee shots mapping (кат.34 + кат.47)
    // ✅ 530=1, 531=2, 423=2
    const shotsPerProduct = new Map([
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

      // ✅ кава в зал
      [425, 1],
      [424, 1],
      [441, 1],
      [422, 1],
      [423, 2],

      // cat 47 (штат)
      [529, 1],
      [530, 1], // 🔁
      [531, 2], // ✅
      [533, 1],
      [534, 1],
      [535, 1],
    ]);

    await ensureProducts();

    let byProduct = new Map();
    let totalQty = 0;
    let totalZak = 0;

    const prodSales = await fetchProductsSales({ dateFrom, dateTo });

    if (prodSales.items) {
      for (const it of prodSales.items) {
        const pid = Number(it.product_id);
        if (!shotsPerProduct.has(pid)) continue;

        const qty = Number(it.qty || 0);
        if (!qty) continue;

        const per = shotsPerProduct.get(pid);
        const zak = qty * per;

        totalQty += qty;
        totalZak += zak;

        const info = PRODUCT_INFO.get(pid) || {};
        byProduct.set(pid, {
          product_id: pid,
          name: info.name || it.name || "",
          category_id: info.category_id ?? null,
          qty,
          zakladki_per_unit: per,
          zakladki_total: zak,
        });
      }
    }

    res.json({
      dateFrom,
      dateTo,
      categories,
      coffee: {
        total_qty: totalQty,
        total_zakladki: totalZak,
        by_product: [...byProduct.values()].sort((a, b) => b.qty - a.qty),
      },
      debug: { usedProductsSales: prodSales.used || null },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- КЭШ: базові ціни товарів --------------------
// product_id -> base_price (грн, вже не копійки)
let PRODUCT_BASE_PRICE = new Map();
let PRODUCT_BASE_CACHE_AT = 0;
const PRODUCT_BASE_TTL_MS = 30 * 60 * 1000;
const SPOT_ID = 1; // наш spot

async function ensureProductBasePrices() {
  const now = Date.now();
  if (PRODUCT_BASE_PRICE.size && now - PRODUCT_BASE_CACHE_AT < PRODUCT_BASE_TTL_MS) return;

  try {
    const j = await poster("menu.getProducts");
    const arr = Array.isArray(j?.response) ? j.response : [];
    const map = new Map();

    for (const p of arr) {
      const pid = Number(p.product_id ?? p.id);
      if (!Number.isFinite(pid)) continue;

      let price = null;

      // Шукаємо ціну для нашого spot_id в spots[]
      if (Array.isArray(p.spots)) {
        const spot = p.spots.find(s => Number(s.spot_id) === SPOT_ID);
        if (spot) price = Number(spot.price) / 100; // копійки -> грн
      }

      // Якщо немає в spots — беремо з price object
      if (price === null && p.price && typeof p.price === "object") {
        const raw = p.price[String(SPOT_ID)] ?? p.price["1"];
        if (raw != null) price = Number(raw) / 100;
      }

      if (price !== null && price > 0) {
        map.set(pid, price);
      }
    }

    if (map.size) {
      PRODUCT_BASE_PRICE = map;
      PRODUCT_BASE_CACHE_AT = now;
    }
  } catch (e) {
    console.error("ensureProductBasePrices error:", e);
  }
}

// -------------------- КЭШ: місячні upsell --------------------
const UPSELL_MONTH_CACHE = new Map();
const UPSELL_MONTH_TTL_MS = 30 * 60 * 1000;

// -------------------- UPSELL: категорії --------------------
const UPSELL_CATS = new Set([17, 37, 41]); // СОУСИ, ДОПИ, ДОПИ БАР

// -------------------- UPSELL: розрахунок за період --------------------
async function calcUpsellForPeriod(dateFrom, dateTo) {
  const txResp = await poster("dash.getTransactions", { dateFrom, dateTo });
  const transactions = Array.isArray(txResp?.response) ? txResp.response : [];

  await ensureProductBasePrices();

  const userSums = new Map(); // user_id -> { name, sum }

  const BATCH = 10;
  for (let i = 0; i < transactions.length; i += BATCH) {
    const batch = transactions.slice(i, i + BATCH);

    await Promise.all(batch.map(async (tx) => {
      const uid = String(tx.user_id);
      const name = String(tx.name || "");
      const txId = String(tx.transaction_id);

      try {
        const prodResp = await poster("dash.getTransactionProducts", {
          transaction_id: txId,
        });
        const products = Array.isArray(prodResp?.response) ? prodResp.response : [];

        let txSauces = 0;   // cat 17 — СОУСИ
        let txKitchen = 0;  // cat 37 — ДОПИ кухня + модифікатори
        let txBar = 0;      // cat 41 — ДОПИ БАР

        for (const p of products) {
          const catId = Number(p.category_id);
          const modId = String(p.modification_id || "0");
          const num = Number(p.num || 1);
          const payedSum = Number(p.payed_sum || 0); // копійки
          const pid = Number(p.product_id);

          if (catId === 17) {
            txSauces += payedSum / 100;
          } else if (catId === 37) {
            txKitchen += payedSum / 100;
          } else if (catId === 41) {
            txBar += payedSum / 100;
          } else if (modId !== "0") {
            // Модифікатор — дельта йде в ДОПИ кухня
            const basePrice = PRODUCT_BASE_PRICE.get(pid);
            if (basePrice != null && basePrice > 0) {
              const payedPerUnit = (payedSum / num) / 100;
              const delta = payedPerUnit - basePrice;
              if (delta > 0) {
                txKitchen += delta * num;
              }
            }
          }
        }

        const txTotal = txSauces + txKitchen + txBar;
        if (txTotal > 0) {
          if (!userSums.has(uid)) {
            userSums.set(uid, { name, sauces: 0, kitchen: 0, bar: 0, sum: 0 });
          }
          const u = userSums.get(uid);
          u.sauces += txSauces;
          u.kitchen += txKitchen;
          u.bar += txBar;
          u.sum += txTotal;
        }
      } catch {
        // пропускаємо проблемну транзакцію
      }
    }));
  }

  return userSums;
}

function lastDayOfMonthForUpsell(s) {
  const y = +s.slice(0, 4), m = +s.slice(4, 6);
  const d = new Date(y, m, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// -------------------- UPSELL ENDPOINT --------------------
app.get("/api/upsell-sales", async (req, res) => {
  try {
    if (!TOKEN)
      return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    // --- День ---
    const dayMap = await calcUpsellForPeriod(dateFrom, dateTo);

    // --- Місяць ---
    const monthKey = dateFrom.slice(0, 6);
    const mFrom = `${monthKey}01`;
    const mTo = lastDayOfMonthForUpsell(dateFrom);

    let monthMap;
    const cached = UPSELL_MONTH_CACHE.get(monthKey);
    const now = Date.now();

    if (cached && now - cached.computedAt < UPSELL_MONTH_TTL_MS) {
      monthMap = cached.data;
    } else {
      monthMap = await calcUpsellForPeriod(mFrom, mTo);
      UPSELL_MONTH_CACHE.set(monthKey, { computedAt: now, data: monthMap });
    }

    // --- Збираємо відповідь (всі хто є в місяці + сьогодні) ---
    const allUsers = new Map([...monthMap, ...dayMap]);
    const result = [];
    for (const [uid, data] of allUsers) {
      const dayData = dayMap.get(uid);
      const monthData = monthMap.get(uid);
      const r = (v) => Math.round((v || 0) * 100) / 100;
      result.push({
        user_id: uid,
        name: data.name,
        day_sum: r(dayData?.sum),
        day_sauces: r(dayData?.sauces),
        day_kitchen: r(dayData?.kitchen),
        day_bar: r(dayData?.bar),
        month_sum: r(monthData?.sum),
        month_sauces: r(monthData?.sauces),
        month_kitchen: r(monthData?.kitchen),
        month_bar: r(monthData?.bar),
      });
    }

    result.sort((a, b) => b.day_sum - a.day_sum);

    res.json({ dateFrom, dateTo, response: result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API server listening on ${port}`));
