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

// ===== Базовий дашборд по офіціантах (було) =====
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

/**
 * ===== Нове: категорії по співробітниках (з надійним фолбеком) =====
 *
 * GET /api/waiters-categories?cats=17,41&keywords=соус,соуси,sauce&dateFrom=YYYYMMDD&dateTo=YYYYMMDD
 *
 * 1) Перший шлях (пріоритет): витягнути чеки з позиціями і порахувати по співробітнику.
 *    Ми пробуємо кілька комбінацій методів/параметрів:
 *      - transactions.getTransactions?include=products,receipt_positions
 *      - transactions.getTransactions?expand=positions
 *      - dash.getTransactions?include=products,receipt_positions
 *      - dash.getTransactions?expand=positions
 *    і розумно інтерпретуємо різні назви полів у відповіді.
 *
 * 2) Фолбек: якщо позицій не вдалося отримати/розпізнати —
 *    звертаємось до офіційного методу  dash.getCategoriesSales
 *    і віддаємо загальні значення по категоріях у полі "overall".
 *    Розріз по співробітниках у фолбеку неможливий (обмеження API).
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
      .filter((n) => Number.isFinite(n));

    const KEYWORDS = String(req.query.keywords || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    // ---- 1) Спроба отримати транзакції з позиціями ----
    const methods = [
      { m: "transactions.getTransactions", p: { include: "products,receipt_positions" } },
      { m: "transactions.getTransactions", p: { expand: "positions" } },
      { m: "dash.getTransactions",         p: { include: "products,receipt_positions" } },
      { m: "dash.getTransactions",         p: { expand: "positions" } },
    ];

    let checks = null;
    let usedUrl = "";

    for (const cand of methods) {
      const url = new URL(`${POSTER_BASE}/${cand.m}`);
      url.searchParams.set("token", TOKEN);
      url.searchParams.set("dateFrom", dateFrom);
      url.searchParams.set("dateTo", dateTo);
      for (const [k, v] of Object.entries(cand.p)) url.searchParams.set(k, v);

      const r = await fetch(url.toString());
      const raw = await r.text();
      if (!r.ok) continue;

      let json;
      try { json = JSON.parse(raw); } catch { continue; }

      const candidates = [
        json?.response,
        json?.response?.transactions,
        json?.transactions,
        json?.data,
      ].filter(Array.isArray);

      if (candidates.length && candidates[0].length) {
        checks = candidates[0];
        usedUrl = url.toString().replace(TOKEN, "***TOKEN***");
        break;
      }
    }

    // хелпери для різних схем полів
    const pickWaiterId   = (tr) => tr.user_id ?? tr.waiter_id ?? tr.cashier_id ?? tr.employee_id ?? null;
    const pickWaiterName = (tr) => tr.user_name ?? tr.waiter_name ?? tr.employee_name ?? tr.name ?? `ID?`;
    const pickPositions  = (tr) =>
      tr.receipt_positions ?? tr.positions ?? tr.products ?? tr.items ?? tr.menu ?? [];
    const pickCategoryId = (p) =>
      p.category_id ?? p.menu_category_id ?? p.product_category_id ?? p.group_id ?? p.category ?? null;
    const pickName       = (p) => p.product_name ?? p.name ?? p.title ?? "";
    const pickQty        = (p) => Number(p.count ?? p.quantity ?? p.qty ?? 0);
    const pickSumCents   = (p) =>
      Number(p.sum ?? p.total ?? p.cost_sum ?? (Number(p.price ?? 0) * Number(p.count ?? 0)));

    const isMatch = (pos) => {
      const byCat = CATS.length ? CATS.includes(Number(pickCategoryId(pos))) : false;
      const nm = String(pickName(pos)).toLowerCase();
      const byKw = KEYWORDS.length ? KEYWORDS.some((kw) => nm.includes(kw)) : false;
      return byCat || byKw;
    };

    if (checks && checks.length) {
      // Групуємо по співробітнику
      const byWaiter = new Map(); // waiter_id -> { name, cats: Map<cid,{qty,sum_cents}>, total_qty, total_cents }
      for (const tr of checks) {
        const wid = pickWaiterId(tr);
        if (wid == null) continue;
        const wname = pickWaiterName(tr);

        const positions = pickPositions(tr) || [];
        for (const pos of positions) {
          if (!isMatch(pos)) continue;

          const cid = String(pickCategoryId(pos) ?? "kw");
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
          [...v.cats.entries()].map(([cid, s]) => [
            cid,
            { qty: s.qty, sum_uah: Math.round(s.sum_cents) / 100 },
          ])
        ),
      }));

      return res.json({ response, debug: { source: usedUrl } });
    }

    // ---- 2) Фолбек: офіційний categories report (без розрізу по співробітниках) ----
    const catUrl = new URL(`${POSTER_BASE}/dash.getCategoriesSales`);
    catUrl.searchParams.set("token", TOKEN);
    catUrl.searchParams.set("dateFrom", dateFrom);
    catUrl.searchParams.set("dateTo", dateTo);

    const rc = await fetch(catUrl.toString());
    const rawc = await rc.text();
    let jcat = {};
    try { jcat = JSON.parse(rawc); } catch {}

    // фільтруємо тільки потрібні категорії
    const list = Array.isArray(jcat?.response) ? jcat.response : [];
    const wanted = new Set(CATS.map(String));
    const overall = list
      .filter((x) => wanted.has(String(x.category_id)))
      .map((x) => ({
        category_id: Number(x.category_id),
        count: Number(x.count || 0),
        sum_uah: Math.round(Number(x.revenue || 0)) / 100,
        name: x.category_name || "",
      }));

    return res.json({
      response: [],              // по співробітниках нема — обмеження API
      overall,                   // але віддаємо коректну суму/кількість по категоріях
      debug: { source: "dash.getCategoriesSales" },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`API server listening on ${port}`);
});
