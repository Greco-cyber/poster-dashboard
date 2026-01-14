// server.js
const express = require("express");
const cors = require("cors");

// Node 18/20 has global fetch; for safety on older Node можно будет подключить node-fetch,
// но тебе теперь мы фиксируем Node 20.x, так что fetch есть.
const fetchFn = global.fetch;

const app = express();
app.use(cors());

const POSTER_BASE = "https://joinposter.com/api";
const TOKEN = process.env.POSTER_TOKEN;

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
  let j = {};
  try {
    j = JSON.parse(t);
  } catch {
    j = { raw: t };
  }
  if (!r.ok) throw new Error(`${method} HTTP ${r.status}: ${t.slice(0, 400)}`);
  return j;
}

// -------------------- КЭШ ПРОДУКТОВ --------------------
let PRODUCT_INFO = new Map(); // product_id -> { category_id, name }
let PRODUCT_CACHE_AT = 0;
const PRODUCT_TTL_MS = 15 * 60 * 1000;

async function ensureProductsInfo() {
  const now = Date.now();
  if (PRODUCT_INFO.size && now - PRODUCT_CACHE_AT < PRODUCT_TTL_MS) return;

  const list = await poster("menu.getProducts");
  const arr = Array.isArray(list?.response) ? list.response : [];

  const map = new Map();
  for (const p of arr) {
    const pid = Number(p.product_id ?? p.id ?? p.menu_id ?? p.good_id);
    const cid = Number(p.menu_category_id ?? p.category_id ?? p.group_id ?? p.category);
    const name = String(p.product_name ?? p.name ?? "");
    if (Number.isFinite(pid)) {
      map.set(pid, { category_id: Number.isFinite(cid) ? cid : null, name });
    }
  }

  PRODUCT_INFO = map;
  PRODUCT_CACHE_AT = now;
}

// -------------------- утилиты чеков --------------------
function pickPositions(tr) {
  return (
    tr.receipt_positions ??
    tr.positions ??
    tr.products ??
    tr.items ??
    tr.menu ??
    tr.goods ??
    tr.receipt_goods ??
    []
  );
}

function flattenPositions(basePositions) {
  const out = [];
  const stack = Array.isArray(basePositions) ? [...basePositions] : [];
  while (stack.length) {
    const p = stack.shift();
    out.push(p);
    for (const k of [
      "modifiers",
      "modifications",
      "ingredients",
      "additives",
      "additionals",
      "children",
      "extras",
    ]) {
      if (Array.isArray(p?.[k]) && p[k].length) stack.push(...p[k]);
    }
  }
  return out;
}

const pickQty = (p) => Number(p.count ?? p.quantity ?? p.qty ?? 0) || 0;

const resolveProductId = (p) =>
  Number(p.product_id ?? p.menu_id ?? p.id ?? p.good_id ?? p.dish_id ?? p.product ?? p.item_id);

async function fetchTransactionsWithPositions({ dateFrom, dateTo }) {
  const methods = [
    { m: "transactions.getTransactions", p: { include: "products,receipt_positions" } },
    { m: "transactions.getTransactions", p: { expand: "positions" } },
    { m: "dash.getTransactions", p: { include: "products,receipt_positions" } },
    { m: "dash.getTransactions", p: { expand: "positions" } },
  ];

  for (const cand of methods) {
    try {
      const j = await poster(cand.m, { dateFrom, dateTo, ...cand.p });
      const arr =
        [j?.response, j?.response?.transactions, j?.transactions, j?.data].find(Array.isArray) || [];
      if (arr.length) return { checks: arr, used: cand };
    } catch {
      // next
    }
  }
  return { checks: null, used: null };
}

// -------------------- базовый отчёт по официантам --------------------
app.get("/api/waiters-sales", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const { dateFrom = todayYYYYMMDD(), dateTo } = req.query;
    const data = await poster("dash.getWaitersSales", { dateFrom, dateTo });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- БАР: категории 9/14/34 + кофе (закладки) --------------------
app.get("/api/bar-sales", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    // 1) Категории бара: 9,14,34 (qty + sum)
    const BAR_CATS = [9, 14, 34];
    const wantCats = new Set(BAR_CATS);

    let categories = [];
    try {
      const cats = await poster("dash.getCategoriesSales", { dateFrom, dateTo });
      const resp = Array.isArray(cats?.response) ? cats.response : [];
      categories = resp
        .filter((x) => wantCats.has(Number(x.category_id)))
        .map((x) => ({
          category_id: Number(x.category_id),
          name: String(x.category_name || ""), // фронт игнорит имя, но оставим
          qty: Number(x.count || 0),
          sum_uah: Math.round(Number(x.revenue || 0)) / 100,
        }))
        .sort((a, b) => a.category_id - b.category_id);
    } catch {
      categories = [];
    }

    // 2) Кофе: закладки по продуктам (кат.34 + кат.47)
    await ensureProductsInfo();

    // ВАЖНО: 530 = 2 ✅
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
      [530, 2],
      [533, 1],
      [534, 1],
      [535, 1],
    ]);

    const { checks, used } = await fetchTransactionsWithPositions({ dateFrom, dateTo });

    const byProduct = new Map();
    let totalQty = 0;
    let totalZakladki = 0;

    if (checks) {
      for (const tr of checks) {
        const flat = flattenPositions(pickPositions(tr));
        for (const pos of flat) {
          const pid = resolveProductId(pos);
          if (!Number.isFinite(pid)) continue;
          if (!shotsPerProduct.has(pid)) continue;

          const qty = pickQty(pos);
          if (!qty) continue;

          const per = shotsPerProduct.get(pid) || 0;
          const zak = qty * per;

          totalQty += qty;
          totalZakladki += zak;

          const info = PRODUCT_INFO.get(pid) || {};
          const catId = Number.isFinite(info.category_id) ? info.category_id : null;

          if (!byProduct.has(pid)) {
            byProduct.set(pid, {
              product_id: pid,
              name: info.name || "",
              category_id: catId,
              qty: 0,
              zakladki_per_unit: per,
              zakladki_total: 0,
            });
          }
          const row = byProduct.get(pid);
          row.qty += qty;
          row.zakladki_total += zak;
        }
      }
    }

    res.json({
      dateFrom,
      dateTo,
      categories,
      coffee: {
        total_qty: totalQty,
        total_zakladki: totalZakladki,
        by_product: [...byProduct.values()].sort((a, b) => b.qty - a.qty),
      },
      debug: { usedTransactions: used },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API server listening on ${port}`));
