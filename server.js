// server.js (CommonJS)
const express = require("express");
const fetch = require("node-fetch"); // если Node >=18, можно удалить и использовать глобальный fetch
const cors = require("cors");

const app = express();
app.use(cors());

const POSTER_BASE = "https://joinposter.com/api";
const TOKEN = process.env.POSTER_TOKEN; // Укажи в Render → Environment

if (!TOKEN) {
  console.warn("[WARN] POSTER_TOKEN не задан! Укажи переменную окружения.");
}

// Пример: продажи официантов за дату/период
app.get("/api/waiters-sales", async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query; // формата YYYYMMDD
    const url = new URL(`${POSTER_BASE}/dash.getWaitersSales`);
    url.searchParams.set("token", TOKEN);
    if (dateFrom) url.searchParams.set("dateFrom", dateFrom);
    if (dateTo) url.searchParams.set("dateTo", dateTo);

    const r = await fetch(url.toString());
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "API error" });
  }
});

// Заглушка под «данные по смене» — добавь нужный метод Poster здесь
app.get("/api/shift", async (_req, res) => {
  try {
    res.json({ ok: true, hint: "Добавь нужный эндпоинт Poster для смены" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "API error" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`API server listening on ${port}`);
});
