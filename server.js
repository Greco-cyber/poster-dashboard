// server.js
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const fetchFn = global.fetch;

const TOKEN =
  process.env.POSTER_TOKEN ||
  process.env.REACT_APP_POSTER_TOKEN ||
  "";

const ACCOUNT =
  process.env.POSTER_ACCOUNT ||
  process.env.REACT_APP_POSTER_ACCOUNT ||
  "";

const POSTER_BASE =
  process.env.POSTER_BASE_URL ||
  process.env.REACT_APP_POSTER_BASE_URL ||
  (ACCOUNT ? `https://${ACCOUNT}.joinposter.com/api` : "https://joinposter.com/api");

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

  const r = await fetchFn(url.toString());
  const j = await r.json();
  return j;
}

let PRODUCT_CACHE = new Map();
let MOD_CACHE = new Map();

async function loadMenu() {
  if (PRODUCT_CACHE.size) return;

  const j = await poster("menu.getProducts");
  const arr = j.response || [];

  for (const p of arr) {
    const pid = Number(p.product_id);
    const cid = Number(p.menu_category_id);

    PRODUCT_CACHE.set(pid, {
      category: cid
    });

    const groups = p.group_modifications || [];

    for (const g of groups) {
      const mods = g.modifications || [];

      for (const m of mods) {
        MOD_CACHE.set(Number(m.dish_modification_id), {
          price: Number(m.price || 0)
        });
      }
    }
  }
}

const SAUCE_CATEGORIES = new Set([37, 41]);

app.get("/api/sauces-sales", async (req, res) => {
  try {
    const dateFrom = req.query.dateFrom || todayYYYYMMDD();
    const dateTo = req.query.dateTo || dateFrom;

    await loadMenu();

    const j = await poster("dash.getTransactions", {
      dateFrom,
      dateTo,
      status: 2,
      include_products: true
    });

    const transactions = j.response || [];

    const byWaiter = {};

    for (const tr of transactions) {
      const waiter = tr.name || "—";
      const uid = tr.user_id;

      if (!byWaiter[uid]) {
        byWaiter[uid] = {
          name: waiter,
          revenue: 0,
          modifiers: 0
        };
      }

      const products = tr.products || [];

      for (const p of products) {
        const pid = Number(p.product_id);
        const mod = Number(p.modification_id || 0);
        const qty = Number(p.num || 1);
        const price = Number(p.product_price || 0);

        const info = PRODUCT_CACHE.get(pid);

        if (info && SAUCE_CATEGORIES.has(info.category)) {
          byWaiter[uid].revenue += price;
        }

        if (mod && MOD_CACHE.has(mod)) {
          const m = MOD_CACHE.get(mod);
          byWaiter[uid].modifiers += m.price * qty * 100;
        }
      }
    }

    const result = Object.values(byWaiter).map((w) => ({
      name: w.name,
      sauces: Math.round(w.revenue / 100),
      modifiers: Math.round(w.modifiers / 100),
      total: Math.round((w.revenue + w.modifiers) / 100)
    }));

    res.json({ data: result });

  } catch (e) {
    res.status(500).json({ error: e.toString() });
  }
});

app.listen(process.env.PORT || 3001);
