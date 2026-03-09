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
    // price field is an object like {"1": "6900"} where key is spot_id
    let basePrice = 0;
    const priceObj = p.price;
    if (priceObj && typeof priceObj === "object") {
      const firstVal = Object.values(priceObj)[0];
      basePrice = Number(firstVal) || 0;
    } else {
      basePrice = Number(priceObj ?? 0) || 0;
    }
    if (Number.isFinite(pid)) {
      map.set(pid, { name, category_id: Number.isFinite(cid) ? cid : null, basePrice });
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

// -------------------- SAUCES & EXTRAS (допи) --------------------
// Категория "ДОПИ" в Poster = category_id 37
const SAUCE_CATEGORY_IDS = new Set([17, 37, 41]);

app.get("/api/sauces-sales", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    await ensureProducts();

    // Собираем set product_id, которые принадлежат категории ДОПИ
    const sauceProductIds = new Set();
    for (const [pid, info] of PRODUCT_INFO.entries()) {
      if (SAUCE_CATEGORY_IDS.has(info.category_id)) {
        sauceProductIds.add(pid);
      }
    }

    // Загружаем все закрытые чеки с товарами за период
    let allTransactions = [];
    let nextTr = null;
    let safetyLimit = 20; // максимум 20 страниц

    while (safetyLimit-- > 0) {
      const params = {
        dateFrom,
        dateTo,
        status: 2, // только закрытые
        include_products: true,
      };
      if (nextTr) params.next_tr = nextTr;

      const j = await poster("dash.getTransactions", params);
      const batch = Array.isArray(j?.response) ? j.response : [];

      if (!batch.length) break;

      allTransactions = allTransactions.concat(batch);

      // Poster пагинация: если вернулось меньше ~100, значит последняя страница
      if (batch.length < 100) break;
      nextTr = batch[batch.length - 1].transaction_id;
    }

    // Группируем по официанту
    const byWaiter = new Map(); // user_id -> { name, revenue, qty, modRevenue, modQty }

    // Debug counters
    let totalProductsSeen = 0;
    let matchedProducts = 0;
    let matchedModifiers = 0;

    function ensureWaiter(uid, name) {
      if (!byWaiter.has(uid)) {
        byWaiter.set(uid, { user_id: uid, name, revenue: 0, qty: 0, modRevenue: 0, modQty: 0 });
      }
      return byWaiter.get(uid);
    }

    for (const tr of allTransactions) {
      const uid = String(tr.user_id);
      const waiterName = tr.name || "—";
      const products = Array.isArray(tr.products) ? tr.products : [];

      for (const p of products) {
        const pid = Number(p.product_id);
        const modId = Number(p.modification_id || 0);
        totalProductsSeen++;

        // product_price — цена за ВСЕ единицы в копейках, num — количество
        const price = Number(p.product_price ?? 0);
        const productQty = Number(p.num ?? 1);

        // 1) Отдельный товар из категории соусов/допов (17/37/41)
        if (sauceProductIds.has(pid)) {
          matchedProducts++;
          // product_price уже сумма за все num штук
          const w = ensureWaiter(uid, waiterName);
          w.revenue += price;
          w.qty += productQty;
        }

        // 2) Модификатор к любому товару: разница между ценой в чеке и базовой ценой
        if (modId !== 0) {
          const info = PRODUCT_INFO.get(pid);
          if (info && info.basePrice > 0) {
            // product_price = total for all units, so per unit = price / num
            const pricePerUnit = Math.round(price / productQty);
            const modCost = pricePerUnit - info.basePrice;
            // Skip tiny diffs (≤100 kopecks / 1₴) — these are "included" modifiers like sauce choice
            if (modCost > 100) {
              matchedModifiers++;
              const modSum = Math.round(modCost * productQty);
              const w = ensureWaiter(uid, waiterName);
              w.modRevenue += modSum;
              w.modQty += productQty;
            }
          }
        }
      }
    }

    // Конвертируем копейки → гривни, сортируем по общей выручке допов
    const result = [...byWaiter.values()]
      .map((w) => ({
        user_id: w.user_id,
        name: w.name,
        revenue: Math.round(w.revenue / 100), // соусы/допы из категорий
        qty: w.qty,
        modRevenue: Math.round(w.modRevenue / 100), // модификаторы
        modQty: w.modQty,
        totalRevenue: Math.round((w.revenue + w.modRevenue) / 100), // всё вместе
        totalQty: w.qty + w.modQty,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totalRevenue = result.reduce((s, w) => s + w.totalRevenue, 0);
    const totalQty = result.reduce((s, w) => s + w.totalQty, 0);

    res.json({
      dateFrom,
      dateTo,
      by_waiter: result,
      total: { revenue: totalRevenue, qty: totalQty },
      debug: {
        sauceProductCount: sauceProductIds.size,
        totalProductsInCache: PRODUCT_INFO.size,
        transactionsCount: allTransactions.length,
        totalProductsSeen,
        matchedProducts,
        matchedModifiers,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API server listening on ${port}`));
