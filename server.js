// server.js
const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());

const POSTER_BASE = "https://joinposter.com/api";
const TOKEN = process.env.POSTER_TOKEN;

function todayYYYYMMDD() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, hasToken: Boolean(TOKEN), time: new Date().toISOString() });
});

// === Уже был: сводка по официантам ===
app.get("/api/waiters-sales", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const { dateFrom = todayYYYYMMDD(), dateTo } = req.query;
    const url = new URL(`${POSTER_BASE}/dash.getWaitersSales`);
    url.searchParams.set("token", TOKEN);
    url.searchParams.set("dateFrom", dateFrom);
    if (dateTo) url.searchParams.set("dateTo", dateTo);

    const r = await fetch(url.toString());
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// === НОВОЕ: агрегация по категориям (соусы/допы/что угодно) ===
// GET /api/waiters-categories?cats=17,37&dateFrom=YYYYMMDD&dateTo=YYYYMMDD
// Ответ: { response: [{ user_id, name, categories: { "17": {qty, sum_uah}, "37": {...} }, total_uah, total_qty }] }
app.get("/api/waiters-categories", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom, cats = "" } = req.query;
    const CATS = String(cats)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
    if (!CATS.length) return res.json({ response: [] });

    // Универсальный метод транзакций с позициями
    const METHOD = process.env.POSTER_TRANSACTIONS_METHOD || "dash.getTransactions";
    const url = new URL(`${POSTER_BASE}/${METHOD}`);
    url.searchParams.set("token", TOKEN);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    url.searchParams.set("expand", "positions");

    const r = await fetch(url.toString());
    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "Poster API error", body: raw.slice(0, 500) });

    let json; try { json = JSON.parse(raw); } catch { return res.json({ response: [] }); }
    const checks = Array.isArray(json?.response) ? json.response : [];

    const pickWaiterId   = (tr) => tr.user_id ?? tr.waiter_id ?? tr.cashier_id ?? tr.employee_id ?? null;
    const pickWaiterName = (tr) => tr.user_name ?? tr.waiter_name ?? tr.employee_name ?? tr.name ?? `ID?`;
    const pickPositions  = (tr) => tr.positions ?? tr.products ?? tr.items ?? tr.menu ?? [];
    const pickCategoryId = (p)  => p.category_id ?? p.menu_category_id ?? p.category ?? null;
    const pickQty        = (p)  => Number(p.count ?? p.quantity ?? p.qty ?? 0);
    const pickSumCents   = (p)  => Number(p.sum ?? p.total ?? p.cost_sum ?? (Number(p.price ?? 0) * Number(p.count ?? 0)));

    // waiter_id -> { name, cats: Map<catId,{qty,sum_cents}>, total_qty, total_cents }
    const byWaiter = new Map();

    for (const tr of checks) {
      const wid = pickWaiterId(tr);
      if (wid == null) continue;
      const wname = pickWaiterName(tr);

      for (const pos of pickPositions(tr)) {
        const cid = Number(pickCategoryId(pos));
        if (!CATS.includes(cid)) continue;

        const qty = pickQty(pos);
        const sumCents = pickSumCents(pos);

        if (!byWaiter.has(wid)) {
          byWaiter.set(wid, { name: wname, cats: new Map(), total_qty: 0, total_cents: 0 });
        }
        const b = byWaiter.get(wid);
        b.total_qty += qty;
        b.total_cents += sumCents;

        const slot = b.cats.get(String(cid)) || { qty: 0, sum_cents: 0 };
        slot.qty += qty;
        slot.sum_cents += sumCents;
        b.cats.set(String(cid), slot);
      }
    }

    const response = [...byWaiter.entries()].map(([user_id, v]) => ({
      user_id,
      name: v.name,
      total_qty: v.total_qty,
      total_uah: Math.round(v.total_cents) / 100,
      categories: Object.fromEntries(
        [...v.cats.entries()].map(([cid, s]) => [cid, { qty: s.qty, sum_uah: Math.round(s.sum_cents) / 100 }])
      ),
    }));

    res.json({ response });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`API server listening on ${port}`);
});
