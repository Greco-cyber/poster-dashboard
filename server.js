// server.js
import express from "express";
import fetch from "node-fetch"; // если Node <18, иначе можно глобальный fetch
import cors from "cors";

const app = express();
app.use(cors());

// Настройки
const POSTER_BASE = "https://joinposter.com/api";
const TOKEN = process.env.POSTER_TOKEN; // задай в Render → Environment

if (!TOKEN) {
  console.warn("WARNING: POSTER_TOKEN не задан в переменных окружения!");
}

// Пример: продажи официантов за период
app.get("/api/waiters-sales", async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query; // YYYYMMDD
    const url = new URL(`${POSTER_BASE}/dash.getWaitersSales`);
    url.searchParams.set("token", TOKEN);
    if (dateFrom) url.searchParams.set("dateFrom", dateFrom);
    if (dateTo) url.searchParams.set("dateTo", dateTo);

    const r = await fetch(url.toString());
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Пример: выручка по смене (если используешь другой ендпоинт — добавь тут)
app.get("/api/shift", async (req, res) => {
  try {
    // TODO: подставь нужный метод Poster + параметры
    res.json({ ok: true, hint: "Добавь тут нужный метод Poster для смены" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`API server listening on ${port}`);
});
