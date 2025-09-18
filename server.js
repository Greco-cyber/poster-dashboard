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

// === Базова зведенка по офіціантах (як була) ===
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

// === Універсальна агрегація по категоріях + fallback за ключовими словами ===
// GET /api/waiters-categories?cats=17,41&keywords=соус,соуси,sauce&dateFrom=YYYYMMDD&dateTo=YYYYMMDD
app.get("/api/waiters-categories", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    const CATS = String(req.query.cats || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));

    const KEYWORDS = String(req.query.keywords || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const METHOD = process.env.POSTER_TRANSACTIONS_METHOD || "dash.getTransactions";
    const url = new URL(`${POSTER_BASE}/${METHOD}`);
    url.searchParams.set("token", TOKEN);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    url.searchParams.set("expand", "positions");

    const r = await fetch(url.toString());
    const raw = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: "Poster API error", body: raw.slice(0, 800) });

    let json;
    try { json = JSON.parse(raw); } catch { return res.json({ response: [] }); }

    // Гнучкий пошук масиву транзакцій
    let checks =
      (Array.isArray(json?.response) && json.response) ||
      (Array.isArray(json?.response?.transactions) && json.response.transactions) ||
      (Array.isArray(json?.transactions) && json.transactions) ||
      (Array.isArray(json?.data) && json.data) ||
      [];

    const pickWaiterId   = (tr) => tr.user_id ?? tr.waiter_id ?? tr.cashier_id ?? tr.employee_id ?? null;
    const pickWaiterName = (tr) => tr.user_name ?? tr.waiter_name ?? tr.employee_name ?? tr.name ?? `ID?`;
    const pickPositions  = (tr) => tr.positions ?? tr.products ?? tr.items ?? tr.menu ?? tr.receipt_positions ?? [];
    const pickCategoryId = (p)  => p.category_id ?? p.menu_category_id ?? p.category ?? p.group_id ?? null;
    const pickName       = (p)  => p.product_name ?? p.name ?? p.title ?? "";
    const pickQty        = (p)  => Number(p.count ?? p.quantity ?? p.qty ?? 0);
    const pickSumCents   = (p)  => Number(p.sum ?? p.total ?? p.cost_sum ?? (Number(p.price ?? 0) * Number(p.count ?? 0)));

    const byWaiter = new Map(); // waiter_id -> { name, cats: Map<cid,{qty,sum_cents}>, total_qty, total_cents }

    const isMatch = (pos) => {
      const byCat = CATS.length ? CATS.includes(Number(pickCategoryId(pos))) : false;
      const nm = String(pickName(pos)).toLowerCase();
      const byKw = KEYWORDS.length ? KEYWORDS.some((kw) => nm.includes(kw)) : false;
      return byCat || byKw;
    };

    for (const tr of checks) {
      const wid = pickWaiterId(tr);
      if (wid == null) continue;
      const wname = pickWaiterName(tr);

      const positions = pickPositions(tr) || [];
      for (const pos of positions) {
        if (!isMatch(pos)) continue;

        const cid = String(pickCategoryId(pos) ?? "kw"); // якщо збіг лише за ключовим словом
        const qty = pickQty(pos);
        const sumCents = pickSumCents(pos);

        if (!byWaiter.has(wid)) {
          byWaiter.set(wid, { name: wname, cats: new Map(), total_qty: 0, total_cents: 0 });
        }
        const b = byWaiter.get(wid);
        b.total_qty += qty;
        b.total_cents += sumCents;

        const slot = b.cats.get(cid) || { qty: 0, sum_cents: 0 };
        slot.qty += qty;
        slot.sum_cents += sumCents;
        b.cats.set(cid, slot);
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
