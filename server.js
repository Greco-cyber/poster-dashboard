// server.js
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const fetchFn = global.fetch;

// Берем значения либо из нормальных переменных, либо из REACT_APP_* (как у тебя сейчас в Render)
const TOKEN =
  process.env.POSTER_TOKEN ||
  process.env.REACT_APP_POSTER_TOKEN ||
  "";

const ACCOUNT =
  process.env.POSTER_ACCOUNT ||
  process.env.REACT_APP_POSTER_ACCOUNT ||
  "";

// Если POSTER_BASE_URL не задан, пробуем собрать его из ACCOUNT.
// В Poster часто используется https://{account}.joinposter.com/api
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

  // Самый типичный метод в Poster
  const candidates = ["menu.getCategories"];

  for (const m of candidates) {
    try {
      const j = await poster(m);
      const arr = Array.isArray(j?.response) ? j.response : [];
      if (!arr.length) continue;

      const map = new Map();
      for (const c of arr) {
        const cid = Number(c.category_id ?? c.id ?? c.menu_category_id);
        const name = String(c.category_name ?? c.name ?? "");
        if (Number.isFinite(cid)) map.set(cid, name);
      }

      if (map.size) {
        CAT_NAME = map;
        CATS_CACHE_AT = now;
        return;
      }
    } catch {
      // try next (если добавишь варианты)
    }
  }

  // если не удалось — оставим пустым, названия будем подставлять fallback'ом
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
  // На разных аккаунтах Poster может отличаться метод/структура.
  // Пробуем несколько вариантов.
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

    // 1) Категории 9/14/34: количество (название берем из menu.getCategories)
    const BAR_CATS = [9, 14, 34];
    const want = new Set(BAR_CATS);

    await ensureCategories();

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

        // иногда в ответе есть category_name, иногда нет
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
      // оставляем нули
    }

    // 2) Кофе: закладки по продуктам (кат.34 + кат.47), 530 = 2
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
      // cat 47
      [529, 1],
      [530, 2], // ✅
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

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API server listening on ${port}`));
