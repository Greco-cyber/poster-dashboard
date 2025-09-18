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

// -------- базовий звіт по офіціантах --------
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

/**
 * Продажі по категоріях у розрізі співробітників (СТРОГО за ID категорій)
 * GET /api/waiters-categories?cats=17,41&dateFrom=YYYYMMDD&dateTo=YYYYMMDD
 *
 * Логіка:
 * 1) Прагнемо отримати транзакції з позиціями і фільтруємо позиції з category_id ∈ cats.
 * 2) Додатково рахуємо "overall" через офіційний dash.getCategoriesSales (тільки загальна сума/кількість).
 */
app.get("/api/waiters-categories", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;
    const CATS = String(req.query.cats || "")
      .split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);

    // ---- overall через офіційний звіт ----
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

    // ---- транзакції з позиціями для розрізу по співробітниках ----
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

    const pickWaiterId   = (tr) => tr.user_id ?? tr.waiter_id ?? tr.cashier_id ?? tr.employee_id ?? null;
    const pickWaiterName = (tr) => tr.user_name ?? tr.waiter_name ?? tr.employee_name ?? tr.name ?? `ID?`;
    const pickPositions  = (tr) => tr.receipt_positions ?? tr.positions ?? tr.products ?? tr.items ?? tr.menu ?? [];
    const pickCategoryId = (p)  => p.category_id ?? p.menu_category_id ?? p.product_category_id ?? p.group_id ?? p.category ?? null;
    const pickQty        = (p)  => Number(p.count ?? p.quantity ?? p.qty ?? 0);
    const pickSumCents   = (p)  => Number(p.sum ?? p.total ?? p.cost_sum ?? ((Number(p.price || 0)) * Number(p.count || 0)));

    let response = [];
    if (checks && CATS.length) {
      const byWaiter = new Map();
      for (const tr of checks) {
        const wid = pickWaiterId(tr);
        if (wid == null) continue;
        const wname = pickWaiterName(tr);
        const pos = pickPositions(tr) || [];
        for (const p of pos) {
          const cid = Number(pickCategoryId(p));
          if (!Number.isFinite(cid)) continue;
          if (!CATS.includes(cid)) continue; // СТРОГО по ID категорій

          const qty = pickQty(p);
          const sum = pickSumCents(p);

          if (!byWaiter.has(wid)) byWaiter.set(wid, { name: wname, qty: 0, cents: 0, cats: new Map() });
          const w = byWaiter.get(wid);
          w.qty += qty; w.cents += sum;
          const slot = w.cats.get(cid) || { qty: 0, cents: 0 };
          slot.qty += qty; slot.cents += sum; w.cats.set(cid, slot);
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

// діагностика: чи повертає API позиції
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
            positions_sample: (tr.receipt_positions ?? tr.positions ?? tr.products ?? tr.items ?? tr.menu ?? [])
              .slice(0, 5)
              .map((p) => ({
                name: p.product_name ?? p.name ?? "",
                category_id: p.category_id ?? p.group_id ?? p.menu_category_id ?? p.category ?? null,
                qty: p.count ?? p.quantity ?? p.qty ?? 0,
                sum: p.sum ?? p.total ?? p.cost_sum ?? null,
              })),
          }));
          return res.json({ ok: true, method: cand.m, paramsTried: cand.p, sample: out });
        }
      } catch {}
    }
    res.json({ ok: false, message: "No transactions with positions returned by API" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API server listening on ${port}`));
