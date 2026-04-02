// server.js
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const fetchFn = global.fetch;

// Берем значения либо из POSTER_*, либо из REACT_APP_* (как у тебя в Render)
const TOKEN =
  process.env.POSTER_TOKEN ||
  process.env.REACT_APP_POSTER_TOKEN ||
  "";

const ACCOUNT =
  process.env.POSTER_ACCOUNT ||
  process.env.REACT_APP_POSTER_ACCOUNT ||
  "";

// Если POSTER_BASE_URL не задан, пробуем собрать его из ACCOUNT
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
  const t = await r.text();

  let j;
  try {
    j = JSON.parse(t);
  } catch {
    j = { raw: t };
  }

  if (!r.ok) throw new Error(`${method} HTTP ${r.status}: ${t.slice(0, 400)}`);
  return j;
}

// -------------------- КЭШ: категории --------------------
let CATS_CACHE_AT = 0;
let CAT_NAME = new Map(); // cid -> name
const CATS_TTL_MS = 30 * 60 * 1000;

async function ensureCategories() {
  const now = Date.now();
  if (CAT_NAME.size && now - CATS_CACHE_AT < CATS_TTL_MS) return;

  try {
    const j = await poster("menu.getCategories");
    const arr = Array.isArray(j?.response) ? j.response : [];
    const map = new Map();

    for (const c of arr) {
      const cid = Number(c.category_id ?? c.id ?? c.menu_category_id);
      const name = String(c.category_name ?? c.name ?? "");
      if (Number.isFinite(cid)) map.set(cid, name);
    }

    if (map.size) {
      CAT_NAME = map;
      CATS_CACHE_AT = now;
    }
  } catch {
    // ignore
  }
}

// -------------------- КЭШ: продукты --------------------
let PRODUCTS_CACHE_AT = 0;
let PRODUCT_INFO = new Map(); // pid -> { name, category_id }
const PRODUCT_TTL_MS = 15 * 60 * 1000;

async function ensureProducts() {
  const now = Date.now();
  if (PRODUCT_INFO.size && now - PRODUCTS_CACHE_AT < PRODUCT_TTL_MS) return;

  const j = await poster("menu.getProducts");
  const arr = Array.isArray(j?.response) ? j.response : [];

  const map = new Map();
  for (const p of arr) {
    const pid = Number(p.product_id ?? p.id ?? p.menu_id ?? p.good_id);
    const cid = Number(p.menu_category_id ?? p.category_id ?? p.group_id ?? p.category);
    const name = String(p.product_name ?? p.name ?? "");
    if (Number.isFinite(pid)) {
      map.set(pid, { name, category_id: Number.isFinite(cid) ? cid : null });
    }
  }

  PRODUCT_INFO = map;
  PRODUCTS_CACHE_AT = now;
}

// -------------------- WAITERS --------------------
app.get("/api/waiters-sales", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN (or REACT_APP_POSTER_TOKEN) is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;
    const data = await poster("dash.getWaitersSales", { dateFrom, dateTo });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- ПРОДАЖИ ПО ТОВАРАМ (для кофе) --------------------
async function fetchProductsSales({ dateFrom, dateTo }) {
  const methods = [
    { m: "dash.getProductsSales", p: { dateFrom, dateTo } },
    { m: "dash.getProductsSales", p: {} },
    { m: "report.getProductsSales", p: { dateFrom, dateTo } },
    { m: "report.getProductsSales", p: {} },
    { m: "dash.getProducts", p: { dateFrom, dateTo } },
    { m: "dash.getProducts", p: {} },
  ];

  for (const cand of methods) {
    try {
      const j = await poster(cand.m, cand.p);

      const arr =
        [j?.response, j?.response?.products, j?.products, j?.data].find(Array.isArray) || [];

      if (!arr.length) continue;

      const norm = arr
        .map((x) => {
          const product_id = Number(x.product_id ?? x.menu_id ?? x.id ?? x.good_id);
          if (!Number.isFinite(product_id)) return null;

          const name = String(x.product_name ?? x.name ?? "");
          const qty = Number(x.count ?? x.quantity ?? x.qty ?? x.amount ?? 0) || 0;

          return { product_id, name, qty };
        })
        .filter(Boolean);

      if (norm.length) return { items: norm, used: cand };
    } catch {
      // next
    }
  }

  return { items: null, used: null };
}

// -------------------- BAR SALES --------------------
app.get("/api/bar-sales", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN (or REACT_APP_POSTER_TOKEN) is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    // Категории бара
    const BAR_CATS = [9, 14, 34];
    const want = new Set(BAR_CATS);

    await ensureCategories();

    // 1) Categories qty + name
    let categories = BAR_CATS.map((cid) => ({
      category_id: cid,
      name: CAT_NAME.get(cid) || `Категорія ${cid}`,
      qty: 0,
    }));

    try {
      const cats = await poster("dash.getCategoriesSales", { dateFrom, dateTo });
      const resp = Array.isArray(cats?.response) ? cats.response : [];

      const map = new Map();
      for (const x of resp) {
        const cid = Number(x.category_id);
        if (!want.has(cid)) continue;

        const nameFromDash = String(x.category_name ?? x.name ?? "");
        const name = CAT_NAME.get(cid) || nameFromDash || `Категорія ${cid}`;

        map.set(cid, {
          category_id: cid,
          name,
          qty: Number(x.count ?? x.qty ?? 0),
        });
      }

      categories = BAR_CATS.map((cid) => map.get(cid) || {
        category_id: cid,
        name: CAT_NAME.get(cid) || `Категорія ${cid}`,
        qty: 0,
      });
    } catch {
      // keep defaults
    }

    // 2) Coffee shots mapping (кат.34 + кат.47)
    // ✅ 530=1, 531=2, 423=2
    const shotsPerProduct = new Map([
      // cat 34
      [230, 1],
      [485, 1],
      [307, 2],
      [231, 1],
      [316, 1],
      [406, 1],
      [183, 1],
      [182, 1],
      [317, 1],

      // ✅ кава в зал
      [425, 1],
      [424, 1],
      [441, 1],
      [422, 1],
      [423, 2],

      // cat 47 (штат)
      [529, 1],
      [530, 1], // 🔁
      [531, 2], // ✅
      [533, 1],
      [534, 1],
      [535, 1],
    ]);

    await ensureProducts();

    let byProduct = new Map();
    let totalQty = 0;
    let totalZak = 0;

    const prodSales = await fetchProductsSales({ dateFrom, dateTo });

    if (prodSales.items) {
      for (const it of prodSales.items) {
        const pid = Number(it.product_id);
        if (!shotsPerProduct.has(pid)) continue;

        const qty = Number(it.qty || 0);
        if (!qty) continue;

        const per = shotsPerProduct.get(pid);
        const zak = qty * per;

        totalQty += qty;
        totalZak += zak;

        const info = PRODUCT_INFO.get(pid) || {};
        byProduct.set(pid, {
          product_id: pid,
          name: info.name || it.name || "",
          category_id: info.category_id ?? null,
          qty,
          zakladki_per_unit: per,
          zakladki_total: zak,
        });
      }
    }

    res.json({
      dateFrom,
      dateTo,
      categories,
      coffee: {
        total_qty: totalQty,
        total_zakladki: totalZak,
        by_product: [...byProduct.values()].sort((a, b) => b.qty - a.qty),
      },
      debug: { usedProductsSales: prodSales.used || null },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- КЭШ: базові ціни товарів --------------------
// product_id -> base_price (грн, вже не копійки)
let PRODUCT_BASE_PRICE = new Map();
let PRODUCT_BASE_CACHE_AT = 0;
const PRODUCT_BASE_TTL_MS = 30 * 60 * 1000;
const SPOT_ID = 1; // наш spot

async function ensureProductBasePrices() {
  const now = Date.now();
  if (PRODUCT_BASE_PRICE.size && now - PRODUCT_BASE_CACHE_AT < PRODUCT_BASE_TTL_MS) return;

  try {
    const j = await poster("menu.getProducts");
    const arr = Array.isArray(j?.response) ? j.response : [];
    const map = new Map();

    for (const p of arr) {
      const pid = Number(p.product_id ?? p.id);
      if (!Number.isFinite(pid)) continue;

      let price = null;

      // Шукаємо ціну для нашого spot_id в spots[]
      if (Array.isArray(p.spots)) {
        const spot = p.spots.find(s => Number(s.spot_id) === SPOT_ID);
        if (spot) price = Number(spot.price) / 100; // копійки -> грн
      }

      // Якщо немає в spots — беремо з price object
      if (price === null && p.price && typeof p.price === "object") {
        const raw = p.price[String(SPOT_ID)] ?? p.price["1"];
        if (raw != null) price = Number(raw) / 100;
      }

      if (price !== null && price > 0) {
        map.set(pid, price);
      }
    }

    if (map.size) {
      PRODUCT_BASE_PRICE = map;
      PRODUCT_BASE_CACHE_AT = now;
    }
  } catch (e) {
    console.error("ensureProductBasePrices error:", e);
  }
}

// -------------------- КЭШ: місячні upsell --------------------
const UPSELL_MONTH_CACHE = new Map();
const UPSELL_MONTH_TTL_MS = 30 * 60 * 1000;

// -------------------- UPSELL: категорії --------------------
const UPSELL_CATS = new Set([17, 37, 41]); // СОУСИ, ДОПИ, ДОПИ БАР

// -------------------- UPSELL: розрахунок за період --------------------
async function calcUpsellForPeriod(dateFrom, dateTo) {
  const txResp = await poster("dash.getTransactions", { dateFrom, dateTo });
  const transactions = Array.isArray(txResp?.response) ? txResp.response : [];

  await ensureProductBasePrices();

  const userSums = new Map(); // user_id -> { name, sum }

  const BATCH = 10;
  for (let i = 0; i < transactions.length; i += BATCH) {
    const batch = transactions.slice(i, i + BATCH);

    await Promise.all(batch.map(async (tx) => {
      const uid = String(tx.user_id);
      const name = String(tx.name || "");
      const txId = String(tx.transaction_id);

      try {
        const prodResp = await poster("dash.getTransactionProducts", {
          transaction_id: txId,
        });
        const products = Array.isArray(prodResp?.response) ? prodResp.response : [];

        let txUpsell = 0;

        for (const p of products) {
          const catId = Number(p.category_id);
          const modId = String(p.modification_id || "0");
          const num = Number(p.num || 1);
          const payedSum = Number(p.payed_sum || 0); // копійки
          const pid = Number(p.product_id);

          // А) Соус або доп — окрема позиція в чеку
          if (UPSELL_CATS.has(catId)) {
            txUpsell += payedSum / 100; // копійки -> грн
          }
          // Б) Модифікатор — тільки дельта ціни
          else if (modId !== "0") {
            const basePrice = PRODUCT_BASE_PRICE.get(pid); // грн за 1 шт
            if (basePrice != null && basePrice > 0) {
              const payedPerUnit = (payedSum / num) / 100; // грн за 1 шт
              const delta = payedPerUnit - basePrice;
              if (delta > 0) {
                txUpsell += delta * num;
              }
            }
          }
        }

        if (txUpsell > 0) {
          if (!userSums.has(uid)) {
            userSums.set(uid, { name, sum: 0 });
          }
          userSums.get(uid).sum += txUpsell;
        }
      } catch {
        // пропускаємо проблемну транзакцію
      }
    }));
  }

  return userSums;
}

function lastDayOfMonthForUpsell(s) {
  const y = +s.slice(0, 4), m = +s.slice(4, 6);
  const d = new Date(y, m, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// -------------------- UPSELL ENDPOINT --------------------
app.get("/api/upsell-sales", async (req, res) => {
  try {
    if (!TOKEN)
      return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    // --- День ---
    const dayMap = await calcUpsellForPeriod(dateFrom, dateTo);

    // --- Місяць ---
    const monthKey = dateFrom.slice(0, 6);
    const mFrom = `${monthKey}01`;
    const mTo = lastDayOfMonthForUpsell(dateFrom);

    let monthMap;
    const cached = UPSELL_MONTH_CACHE.get(monthKey);
    const now = Date.now();

    if (cached && now - cached.computedAt < UPSELL_MONTH_TTL_MS) {
      monthMap = cached.data;
    } else {
      monthMap = await calcUpsellForPeriod(mFrom, mTo);
      UPSELL_MONTH_CACHE.set(monthKey, { computedAt: now, data: monthMap });
    }

    // --- Збираємо відповідь (тільки ті хто є в дні) ---
    const result = [];
    for (const [uid, dayData] of dayMap) {
      const monthData = monthMap.get(uid);
      result.push({
        user_id: uid,
        name: dayData.name,
        day_sum: Math.round(dayData.sum * 100) / 100,
        month_sum: monthData ? Math.round(monthData.sum * 100) / 100 : 0,
      });
    }

    result.sort((a, b) => b.day_sum - a.day_sum);

    res.json({ dateFrom, dateTo, response: result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API server listening on ${port}`));

// -------------------- UPSELL DETAIL ENDPOINT --------------------
app.get("/api/upsell-detail", async (req, res) => {
  try {
    if (!TOKEN)
      return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom, format = "html" } = req.query;

    await ensureProductBasePrices();

    const txResp = await poster("dash.getTransactions", { dateFrom, dateTo });
    const transactions = Array.isArray(txResp?.response) ? txResp.response : [];

    const userDetails = new Map();

    const BATCH = 10;
    for (let i = 0; i < transactions.length; i += BATCH) {
      const batch = transactions.slice(i, i + BATCH);
      await Promise.all(batch.map(async (tx) => {
        const uid = String(tx.user_id);
        const name = String(tx.name || "");
        const txId = String(tx.transaction_id);
        const time = String(tx.date_close_date || "");

        try {
          const prodResp = await poster("dash.getTransactionProducts", { transaction_id: txId });
          const products = Array.isArray(prodResp?.response) ? prodResp.response : [];

          const lines = [];
          let checkSauces = 0, checkKitchen = 0, checkBar = 0;

          for (const p of products) {
            const catId = Number(p.category_id);
            const modId = String(p.modification_id || "0");
            const num = Number(p.num || 1);
            const payedSum = Number(p.payed_sum || 0);
            const pid = Number(p.product_id);
            const productName = String(p.product_name || "");
            const modName = String(p.modificator_name || "");

            let amount = 0;
            let type = null;

            if (catId === 17) {
              amount = payedSum / 100;
              type = "Соус";
              checkSauces += amount;
            } else if (catId === 37) {
              amount = payedSum / 100;
              type = "Доп кухня";
              checkKitchen += amount;
            } else if (catId === 41) {
              amount = payedSum / 100;
              type = "Доп бар";
              checkBar += amount;
            } else if (modId !== "0") {
              const info = PRODUCT_BASE_PRICE.get(pid);
              if (info && info.price > 0) {
                const payedPerUnit = (payedSum / num) / 100;
                const delta = payedPerUnit - info.price;
                if (delta > 0) {
                  amount = Math.round(delta * num * 100) / 100;
                  if (info.workshop === 1) {
                    type = "Мод бар";
                    checkBar += amount;
                  } else {
                    type = "Мод кухня";
                    checkKitchen += amount;
                  }
                }
              }
            }

            if (type && amount > 0) {
              lines.push({
                product: modName ? `${productName} ${modName}` : productName,
                qty: num,
                amount: Math.round(amount * 100) / 100,
                type,
              });
            }
          }

          const checkTotal = checkSauces + checkKitchen + checkBar;
          if (checkTotal > 0) {
            if (!userDetails.has(uid)) {
              userDetails.set(uid, { name, checks: [], totals: { sauces: 0, kitchen: 0, bar: 0, sum: 0 } });
            }
            const u = userDetails.get(uid);
            u.checks.push({
              transaction_id: txId,
              time,
              lines,
              sauces: Math.round(checkSauces * 100) / 100,
              kitchen: Math.round(checkKitchen * 100) / 100,
              bar: Math.round(checkBar * 100) / 100,
              total: Math.round(checkTotal * 100) / 100,
            });
            u.totals.sauces += checkSauces;
            u.totals.kitchen += checkKitchen;
            u.totals.bar += checkBar;
            u.totals.sum += checkTotal;
          }
        } catch { /* skip */ }
      }));
    }

    const round = v => Math.round((v || 0) * 100) / 100;
    const sorted = [...userDetails.values()].sort((a, b) => b.totals.sum - a.totals.sum);

    // ---- CSV ----
    if (format === "csv") {
      const rows = [["Офіціант", "Чек №", "Час", "Позиція", "К-сть", "Тип", "Сума (грн)"]];

      for (const u of sorted) {
        const sortedChecks = u.checks.sort((a, b) => a.time.localeCompare(b.time));
        for (const ch of sortedChecks) {
          for (const line of ch.lines) {
            rows.push([
              u.name,
              ch.transaction_id,
              ch.time,
              line.product,
              line.qty,
              line.type,
              String(line.amount).replace(".", ","),
            ]);
          }
          // Підсумок по чеку
          rows.push([
            u.name,
            ch.transaction_id,
            ch.time,
            "--- ПІДСУМОК ЧЕКУ ---",
            "",
            "",
            String(ch.total).replace(".", ","),
          ]);
        }
        // Підсумок по офіціанту
        rows.push([
          u.name, "", "", "=== ПІДСУМОК ОФІЦІАНТА ===",
          "", "Соуси: " + round(u.totals.sauces),
          String(round(u.totals.sum)).replace(".", ","),
        ]);
        rows.push([]); // порожній рядок між офіціантами
      }

      const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
      const filename = `upsell_${dateFrom}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send("\uFEFF" + csv); // BOM для коректного відкриття в Excel
      return;
    }

    // ---- HTML ----
    let html = `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<title>Деталі допів — ${dateFrom}</title>
<style>
  body{font-family:monospace;background:#1a1a2e;color:#eee;padding:20px}
  h1{color:#f0a500}h2{color:#00d4ff;margin-top:30px;border-bottom:1px solid #444;padding-bottom:5px}
  .check{background:#16213e;border-left:3px solid #0f3460;margin:10px 0;padding:10px 15px;border-radius:4px}
  .check-header{color:#aaa;font-size:12px;margin-bottom:6px}
  .line{padding:2px 0}
  .Соус{color:#1dd1a1}.Доп-кухня,.Мод-кухня{color:#ff9f43}.Доп-бар,.Мод-бар{color:#54a0ff}
  .badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;margin-left:6px}
  .check-total{margin-top:8px;padding-top:6px;border-top:1px dashed #444;font-size:13px;color:#f9ca24}
  .user-total{background:#0f3460;padding:8px 15px;border-radius:4px;margin-top:5px;color:#f9ca24;font-weight:bold}
  .csv-btn{display:inline-block;margin-top:10px;padding:8px 16px;background:#27ae60;color:#fff;text-decoration:none;border-radius:6px;font-size:14px}
</style></head><body>
<h1>🔥 Деталі допів/соусів — ${dateFrom}</h1>
<a class="csv-btn" href="/api/upsell-detail?dateFrom=${dateFrom}&dateTo=${dateTo}&format=csv">⬇ Скачати CSV</a>`;

    for (const u of sorted) {
      html += `<h2>👤 ${u.name}</h2>`;
      const sortedChecks = u.checks.sort((a, b) => a.time.localeCompare(b.time));
      for (const ch of sortedChecks) {
        html += `<div class="check"><div class="check-header">Чек #${ch.transaction_id} · ${ch.time}</div>`;
        for (const line of ch.lines) {
          const cls = line.type.replace(" ", "-");
          const qty = line.qty > 1 ? ` × ${line.qty}` : "";
          html += `<div class="line"><span>${line.product}${qty}</span><span class="badge ${cls}">${line.type}</span> → <span class="${cls}">+${line.amount} ₴</span></div>`;
        }
        html += `<div class="check-total">`;
        if (ch.sauces) html += `Соуси: ${round(ch.sauces)} ₴ &nbsp;`;
        if (ch.kitchen) html += `Кухня: ${round(ch.kitchen)} ₴ &nbsp;`;
        if (ch.bar) html += `Бар: ${round(ch.bar)} ₴ &nbsp;`;
        html += `| <strong>Разом: ${ch.total} ₴</strong></div></div>`;
      }
      html += `<div class="user-total">Соуси: ${round(u.totals.sauces)} ₴ &nbsp;|&nbsp; Допи кух: ${round(u.totals.kitchen)} ₴ &nbsp;|&nbsp; Допи бар: ${round(u.totals.bar)} ₴ &nbsp;|&nbsp; <span style="color:#ff6b6b">РАЗОМ: ${round(u.totals.sum)} ₴</span></div>`;
    }
    html += `</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});
