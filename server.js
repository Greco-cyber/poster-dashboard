// server.js
const express = require("express");
const cors = require("cors");
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
  const r = await fetch(url.toString());
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(`${method} HTTP ${r.status}: ${t.slice(0, 400)}`);
  return j;
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

// -------------------- КЭШ ПРОДУКТОВ (product_id -> category_id) --------------------
let PRODUCT_MAP = new Map(); // product_id:number -> category_id:number
let PRODUCT_CACHE_AT = 0;
const PRODUCT_TTL_MS = 15 * 60 * 1000; // 15 мин

async function ensureProductsMap() {
  const now = Date.now();
  if (PRODUCT_MAP.size && now - PRODUCT_CACHE_AT < PRODUCT_TTL_MS) return;

  const list = await poster("menu.getProducts");
  const arr = Array.isArray(list?.response) ? list.response : [];
  const map = new Map();
  for (const p of arr) {
    const pid = Number(p.product_id ?? p.id ?? p.menu_id ?? p.good_id);
    const cid = Number(p.menu_category_id ?? p.category_id ?? p.group_id ?? p.category);
    if (Number.isFinite(pid) && Number.isFinite(cid)) map.set(pid, cid);
  }
  PRODUCT_MAP = map;
  PRODUCT_CACHE_AT = now;
}

// -------------------- утилиты парсинга чеков --------------------
const pickWaiterId   = (tr) => tr.user_id ?? tr.waiter_id ?? tr.cashier_id ?? tr.employee_id ?? null;
const pickWaiterName = (tr) => tr.user_name ?? tr.waiter_name ?? tr.employee_name ?? tr.name ?? `ID?`;

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
  ) || [];
}

function flattenPositions(basePositions) {
  const out = [];
  const stack = Array.isArray(basePositions) ? [...basePositions] : [];
  while (stack.length) {
    const p = stack.shift();
    out.push(p);
    for (const k of ["modifiers","modifications","ingredients","additives","additionals","children","extras"]) {
      if (Array.isArray(p?.[k]) && p[k].length) stack.push(...p[k]);
    }
  }
  return out;
}

const pickQty = (p) => Number(p.count ?? p.quantity ?? p.qty ?? 0) || 0;
const pickSumCents = (p) => {
  const c =
    Number(p.sum ?? p.total ?? p.cost_sum) ||
    (Number(p.price ?? p.cost_price ?? 0) * Number(p.count ?? p.quantity ?? 0));
  return Number.isFinite(c) ? c : 0;
};

const resolveProductId = (p) =>
  Number(p.product_id ?? p.menu_id ?? p.id ?? p.good_id ?? p.dish_id ?? p.product ?? p.item_id);

const resolveCategoryId = (p) =>
  Number(p.category_id ?? p.menu_category_id ?? p.product_category_id ?? p.group_id ?? p.category);

// -------------------- категории по сотрудникам (СТРОГО по ID категорий/товаров) --------------------
/**
 * GET /api/waiters-categories?cats=17,41&dateFrom=YYYYMMDD&dateTo=YYYYMMDD
 * Логика:
 *  - тянем карту всех товаров (product_id -> category_id)
 *  - формируем множество product_id, которые принадлежат указанным категориям
 *  - при обходе чеков считаем позицию, если (category_id ∈ cats) ИЛИ (product_id ∈ productIdSet)
 *  - "overall" дополнительно берём из dash.getCategoriesSales (для сверки)
 */
app.get("/api/waiters-categories", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;
    const CATS = String(req.query.cats || "")
      .split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    if (!CATS.length) return res.json({ response: [], overall: [] });

    // 0) гарантируем карту товаров
    await ensureProductsMap();

    // множество product_id из требуемых категорий
    const wantCats = new Set(CATS);
    const productIdSet = new Set(
      [...PRODUCT_MAP.entries()]
        .filter(([, cid]) => wantCats.has(cid))
        .map(([pid]) => pid)
    );

    // A) overall (официальный отчёт по категориям)
    let overall = [];
    try {
      const cats = await poster("dash.getCategoriesSales", { dateFrom, dateTo });
      const resp = Array.isArray(cats?.response) ? cats.response : [];
      overall = resp
        .filter((x) => wantCats.has(Number(x.category_id)))
        .map((x) => ({
          category_id: Number(x.category_id),
          count: Number(x.count || 0),
          sum_uah: Math.round(Number(x.revenue || 0)) / 100,
          name: x.category_name || "",
        }));
    } catch { /* необязательно, служит только для сверки */ }

    // B) транзакции с позициями
    const methods = [
      { m: "transactions.getTransactions", p: { include: "products,receipt_positions" } },
      { m: "transactions.getTransactions", p: { expand: "positions" } },
      { m: "dash.getTransactions",         p: { include: "products,receipt_positions" } },
      { m: "dash.getTransactions",         p: { expand: "positions" } },
    ];

    let checks = null, used = null;
    for (const cand of methods) {
      try {
        const j = await poster(cand.m, { dateFrom, dateTo, ...cand.p });
        const arr = [j?.response, j?.response?.transactions, j?.transactions, j?.data]
          .find(Array.isArray) || [];
        if (arr.length) { checks = arr; used = cand; break; }
      } catch { /* try next */ }
    }

    let response = [];
    if (checks) {
      const byWaiter = new Map();

      for (const tr of checks) {
        const wid = pickWaiterId(tr);
        if (wid == null) continue;
        const wname = pickWaiterName(tr);

        const flat = flattenPositions(pickPositions(tr));
        for (const pos of flat) {
          const cid = resolveCategoryId(pos);
          const pid = resolveProductId(pos);

          // матч по категории ИЛИ по product_id из нужных категорий
          const belongsByCat = Number.isFinite(cid) && wantCats.has(cid);
          const belongsByPid = Number.isFinite(pid) && productIdSet.has(pid);
          if (!belongsByCat && !belongsByPid) continue;

          const qty = pickQty(pos);
          const cents = pickSumCents(pos);

          if (!byWaiter.has(wid)) byWaiter.set(wid, { name: wname, qty: 0, cents: 0, cats: new Map() });
          const w = byWaiter.get(wid);
          w.qty += qty; w.cents += cents;

          const finalCid = belongsByCat ? cid : (PRODUCT_MAP.get(pid) ?? cid);
          const slot = w.cats.get(finalCid) || { qty: 0, cents: 0 };
          slot.qty += qty; slot.cents += cents;
          w.cats.set(finalCid, slot);
        }
      }

      response = [...byWaiter.entries()].map(([user_id, v]) => ({
        user_id,
        name: v.name,
        total_qty: v.qty,
        total_uah: Math.round(v.cents) / 100,
        categories: Object.fromEntries(
          [...v.cats.entries()].map(([cid, s]) => [cid, { qty: s.qty, sum_uah: Math.round(s.cents) / 100 }])
        ),
      }));
    }

    res.json({ response, overall, debug: { usedTransactions: used } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- меню категорий (для поиска ID) --------------------
app.get("/api/menu-categories", async (_req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const data = await poster("menu.getCategories");
    const list = Array.isArray(data?.response) ? data.response : [];
    res.json({
      response: list.map((c) => ({
        category_id: Number(c.category_id ?? c.id ?? 0),
        category_name: String(c.category_name ?? c.name ?? ""),
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- диагностика: показывает пример позиций --------------------
app.get("/api/debug/tx", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom, limit = 3 } = req.query;

    const methods = [
      { m: "transactions.getTransactions", p: { include: "products,receipt_positions" } },
      { m: "transactions.getTransactions", p: { expand: "positions" } },
      { m: "dash.getTransactions",         p: { include: "products,receipt_positions" } },
      { m: "dash.getTransactions",         p: { expand: "positions" } },
    ];

    for (const cand of methods) {
      try {
        const j = await poster(cand.m, { dateFrom, dateTo, ...cand.p });
        const arr = [j?.response, j?.response?.transactions, j?.transactions, j?.data]
          .find(Array.isArray) || [];
        if (arr.length) {
          const out = arr.slice(0, Number(limit)).map((tr) => ({
            waiter_id: tr.user_id ?? tr.waiter_id ?? tr.employee_id ?? null,
            positions_sample: flattenPositions(pickPositions(tr))
              .slice(0, 8)
              .map((p) => ({
                name: p.product_name ?? p.name ?? "",
                product_id: resolveProductId(p),
                category_id: resolveCategoryId(p),
                qty: p.count ?? p.quantity ?? p.qty ?? 0,
                sum: p.sum ?? p.total ?? p.cost_sum ?? null,
              })),
          }));
          return res.json({ ok: true, method: cand.m, paramsTried: cand.p, sample: out });
        }
      } catch { /* try next */ }
    }
    res.json({ ok: false, message: "No transactions with positions returned by API" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API server listening on ${port}`));
