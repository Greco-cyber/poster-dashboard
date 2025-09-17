// server.js — минимальный бэкенд-прокси для Poster (Node 18+)
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const TZ = "Europe/Kyiv";

// CORS (для продакшна укажи точный домен фронта через CORS_ORIGIN)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// YYYYMMDD в Europe/Kyiv
const ymd = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .replace(/-/g, "");

// копейки → гривны (округляем до гривны)
const toUAH = (kop) => Math.round((Number(kop) || 0) / 100);

// health-check
app.get("/api/health", (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Продажи по официантам за день (dash.getWaitersSales)
app.get("/api/waiters-sales", async (req, res) => {
  try {
    const token = process.env.POSTER_TOKEN; // хранится ТОЛЬКО на бэкенде
    if (!token) return res.status(500).json({ error: "Missing POSTER_TOKEN" });

    // ?day=YYYY-MM-DD (опционально)
    const dayParam = req.query.day;
    const dayYmd = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
      ? dayParam.replace(/-/g, "")
      : ymd();

    // ВНИМАНИЕ: для dash.* базовый URL такой:
    const url = new URL("https://joinposter.com/api/dash.getWaitersSales");
    url.searchParams.set("token", token);
    url.searchParams.set("dateFrom", dayYmd);
    url.searchParams.set("dateTo", dayYmd);

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);

    let resp, text;
    try {
      resp = await fetch(url, { signal: controller.signal });
      text = await resp.text();
    } finally {
      clearTimeout(t);
    }

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: `Poster HTTP ${resp.status}`,
        body: String(text).slice(0, 400)
      });
    }

    const data = JSON.parse(text || "{}");
    const rows = Array.isArray(data?.response) ? data.response : [];

    // нормализация
    const list = rows.map((x) => ({
      id: String(x.user_id),
      name: x.name || "Невідомо",
      revenue: toUAH(x.revenue),               // revenue — копейки → грн
      checks: Number(x.clients) || 0,
      avg: Number(x.middle_invoice) || 0       // средний чек уже в гривнах
    }));

    const totalRevenue = list.reduce((s, i) => s + i.revenue, 0);
    const totalChecks  = list.reduce((s, i) => s + i.checks, 0);
    const avgOverall   = totalChecks ? Math.round((totalRevenue / totalChecks) * 100) / 100 : 0;

    res.json({
      range: { day: (dayParam || new Date().toISOString().slice(0,10)), tz: TZ },
      total_revenue: totalRevenue,
      total_receipts: totalChecks,
      avg_check_overall: avgOverall,
      by_employee: list.sort((a,b) => b.revenue - a.revenue),
      source: "poster/dash.getWaitersSales"
    });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`API listening on :${PORT}`));
