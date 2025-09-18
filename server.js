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

// -------------------- БАЗОВИЙ ДАШБОРД ПО ОФІЦІАНТАХ --------------------
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

// -------------------- КЕШ ПРОДУКТІВ (product_id -> category_id) --------------------
let PRODUCT_MAP = new Map(); // product_id:number -> category_id:number
let PRODUCT_CACHE_AT = 0;
const PRODUCT_TTL_MS = 15 * 60 * 1000; // 15 хв

async function ensureProductsMap() {
  const now = Date.now();
  if (PRODUCT_MAP.size && now - PRODUCT_CACHE_AT < PRODUCT_TTL_MS) return;

  const list = await poster("menu.getProducts"); // повертає всі товари з category_id
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

// -------------------- ДОПОМОЖНІ ПАРСЕРИ --------------------
const pickWaiterId   = (tr) => tr.user_id ?? tr.waiter_id ?? tr.cashier_id ?? tr.employee_id ?? null;
const pickWaiterName = (tr) => tr.user_name ?? tr.waiter_name ?? tr.employee_name ?? tr.name ?? `ID?`;

// можливі поля з позиціями
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

// «сплющуємо» модифікатори, інгредієнти тощо
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
const pickSumCents = (p) => {
  const c =
    Number(p.sum ?? p.total ?? p.cost_sum) ||
    Number(p.price ?? p.cost_price ?? 0) * Number(p.count ?? p.quantity ?? 0);
  return Number.isFinite(c) ? c : 0;
};

// витягнути category_id з позиції з урахуванням мапи продуктів
function resolveCategoryId(pos) {
  // 1) пряме поле
  const direct = Number(
    pos.category_id ?? pos.menu_category_id ?? pos.product_category_id ?? pos.group_id ?? pos.category
  );
  if (Number.isFinite(direct)) return direct;

  // 2) за product_id через мапу
  const pid = Number(
    pos.product_id ?? pos.menu_id ?? pos.id ?? pos.good_id ?? pos.dish_id ?? pos.product ?? pos.item_id
  );
  if (Number.isFinite(pid) && PRODUCT_MAP.has(pid)) return PRODUCT_MAP.get(pid);

  return null;
}

// -------------------- КАТЕГОРІЇ ПО СПІВРОБІТНИКАХ (СТРОГО ЗА ID) --------------------
/**
 * GET /api/waiters-categories?cats=17,41&dateFrom=YYYYMMDD&dateTo=YYYYMMDD
 * - Рахує по співробітнику: шукаємо позиції чеків і виводимо лише ті, що вказаних категорій.
 * - «overall» додаємо з офіційного звіту dash.getCategoriesSales (сума/кількість без розрізу).
 */
app.get("/api/waiters-categories", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;
    const CATS = String(req.query.cats || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);

    // 0) карта товар->категорія
    await ensureProductsMap();

    // A) overall (надійно працює завжди)
    let overall = [];
    if (CATS.length) {
      const cats = await poster("dash.getCategoriesSales", { dateFrom, dateTo });
      const resp = Array.isArray(cats?.response) ? cats.response : [];
      const want = new Set(CATS.map(String));
      overall = resp
        .filter((x) => want.has(String(x.category_id)))
        .map((x) => ({
          category_id: Number(x.category_id),
          count: Number(x.count || 0),
          sum_uah: Math.round(Number(x.revenue || 0)) / 100,
          name: x.category_name || "",
        }));
    }

    // B) транзакції з позиціями
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
        const arr =
          [j?.response, j?.response?.transactions, j?.transactions, j?.data].find(Array.isArray) || [];
        if (arr.length) { checks = arr; used = cand; break; }
      } catch { /* try next */ }
    }

    let response = [];
    if (checks && CATS.length) {
      const want = new Set(CATS);
      const byWaiter = new Map();
      let scanned = 0, matched = 0;

      for (const tr of checks) {
        const wid = pickWaiterId(tr);
        if (wid == null) continue;
        const wname = pickWaiterName(tr);

        const flat = flattenPositions(pickPositions(tr));
        for (const pos of flat) {
          scanned += 1;
          const cid = resolveCategoryId(pos);
          if (!Number.isFinite(cid)) continue;
          if (!want.has(cid)) continue;

          matched += 1;
          const qty = pickQty(pos);
          const cents = pickSumCents(pos);

          if (!byWaiter.has(wid)) byWaiter.set(wid, { name: wname, qty: 0, cents: 0, cats: new Map() });
          const w = byWaiter.get(wid);
          w.qty += qty; w.cents += cents;

          const slot = w.cats.get(cid) || { qty: 0, cents: 0 };
          slot.qty += qty; slot.cents += cents;
          w.cats.set(cid, slot);
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

// -------------------- ДІАГНОСТИКА: ЧИ Є ПОЗИЦІЇ --------------------
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
        const arr =
          [j?.response, j?.response?.transactions, j?.transactions, j?.data].find(Array.isArray) || [];
        if (arr.length) {
          const out = arr.slice(0, Number(limit)).map((tr) => ({
            waiter_id: tr.user_id ?? tr.waiter_id ?? tr.employee_id ?? null,
            positions_sample: flattenPositions(pickPositions(tr))
              .slice(0, 6)
              .map((p) => ({
                name: p.product_name ?? p.name ?? "",
                product_id: p.product_id ?? p.menu_id ?? p.id ?? p.good_id ?? null,
                category_id: p.category_id ?? p.group_id ?? p.menu_category_id ?? p.category ?? null,
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
