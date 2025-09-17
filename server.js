// server.js (Node 18+)
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const TZ = "Europe/Kyiv";

// CORS (разрешим твой фронт; на тесты можно '*')
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// утилиты
const ymd = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .replace(/-/g, ""); // YYYYMMDD для dash.*

const toUAH = (kop) => Math.round((Number(kop) || 0) / 100); // revenue/ profit = копейки → грн (округлим до гривны)

// GET /api/waiters-sales?day=YYYY-MM-DD
app.get("/api/waiters-sales", async (req, res) => {
  try {
    const token = process.env.POSTER_TOKEN; // хранить здесь, не в браузере
    if (!token) return res.status(500).json({ error: "Missing POSTER_TOKEN" });

    const dayParam = req.query.day; // YYYY-MM-DD
    const dayYmd = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
      ? dayParam.replace(/-/g, "")
      : ymd();

    const url = new URL("https://joinposter.com/api/dash.getWaitersSales");
    url.searchParams.set("token", token);
    url.searchParams.set("dateFrom", dayYmd);
    url.searchParams.set("dateTo", dayYmd);

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);

    let r, text;
    try {
      r = await fetch(url, { signal: controller.signal });
      text = await r.text();
    } finally {
      clearTimeout(t);
    }

    if (!r.ok) {
      return res.status(r.status).json({ error: `Poster HTTP ${r.status}`, body: String(text).slice(0, 400) });
    }

    const data = JSON.parse(text || "{}");
    const rows = Array.isArray(data?.response) ? data.response : [];

    // нормализуем
    const list = rows.map((x) => ({
      id: String(x.user_id),
      name: x.name || "Невідомо",
      revenue: toUAH(x.revenue),               // коп → грн
      checks: Number(x.clients) || 0,
      avg: Number(x.middle_invoice) || 0,      // уже в гривнах
    }));

    const totalRevenue = list.reduce((s, i) => s + i.revenue, 0);
    const totalChecks  = list.reduce((s, i) => s + i.checks, 0);
    const avgOverall   = totalChecks ? Math.round((totalRevenue / totalChecks) * 100) / 100 : 0;

    res.json({
      range: { day: dayParam || new Date().toISOString().slice(0,10), tz: TZ },
      total_revenue: totalRevenue,
      total_receipts: totalChecks,
      avg_check_overall: avgOverall,
      by_employee: list.sort((a,b) => b.revenue - a.revenue),
      source: "poster/dash.getWaitersSales",
    });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`API listening on :${PORT}`));
