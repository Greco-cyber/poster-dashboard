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
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok) throw new Error(`${method} HTTP ${r.status}: ${t.slice(0, 400)}`);
  return j;
}

// -------------------- КЕШ: категорії --------------------
let CATS_CACHE_AT = 0;
let CAT_NAME = new Map();
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
    if (map.size) { CAT_NAME = map; CATS_CACHE_AT = now; }
  } catch { /* ignore */ }
}

// -------------------- КЕШ: продукти --------------------
let PRODUCTS_CACHE_AT = 0;
let PRODUCT_INFO = new Map();
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
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;
    const data = await poster("dash.getWaitersSales", { dateFrom, dateTo });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- ПРОДАЖІ ПО ТОВАРАХ (для кави) --------------------
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
      const arr = [j?.response, j?.response?.products, j?.products, j?.data].find(Array.isArray) || [];
      if (!arr.length) continue;
      const norm = arr.map((x) => {
        const product_id = Number(x.product_id ?? x.menu_id ?? x.id ?? x.good_id);
        if (!Number.isFinite(product_id)) return null;
        const name = String(x.product_name ?? x.name ?? "");
        const qty = Number(x.count ?? x.quantity ?? x.qty ?? x.amount ?? 0) || 0;
        return { product_id, name, qty };
      }).filter(Boolean);
      if (norm.length) return { items: norm, used: cand };
    } catch { /* next */ }
  }
  return { items: null, used: null };
}

// -------------------- BAR SALES --------------------
app.get("/api/bar-sales", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;
    const BAR_CATS = [9, 14, 34];
    const want = new Set(BAR_CATS);
    await ensureCategories();

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
        const name = CAT_NAME.get(cid) || String(x.category_name ?? x.name ?? "") || `Категорія ${cid}`;
        map.set(cid, { category_id: cid, name, qty: Number(x.count ?? x.qty ?? 0) });
      }
      categories = BAR_CATS.map((cid) => map.get(cid) || {
        category_id: cid, name: CAT_NAME.get(cid) || `Категорія ${cid}`, qty: 0,
      });
    } catch { /* keep defaults */ }

    const shotsPerProduct = new Map([
      [230,1],[485,1],[307,2],[231,1],[316,1],[406,1],[183,1],[182,1],[317,1],
      [425,1],[424,1],[441,1],[422,1],[423,2],
      [529,1],[530,1],[531,2],[533,1],[534,1],[535,1],
    ]);

    await ensureProducts();
    let byProduct = new Map(), totalQty = 0, totalZak = 0;
    const prodSales = await fetchProductsSales({ dateFrom, dateTo });

    if (prodSales.items) {
      for (const it of prodSales.items) {
        const pid = Number(it.product_id);
        if (!shotsPerProduct.has(pid)) continue;
        const qty = Number(it.qty || 0);
        if (!qty) continue;
        const per = shotsPerProduct.get(pid);
        const zak = qty * per;
        totalQty += qty; totalZak += zak;
        const info = PRODUCT_INFO.get(pid) || {};
        byProduct.set(pid, {
          product_id: pid, name: info.name || it.name || "",
          category_id: info.category_id ?? null,
          qty, zakladki_per_unit: per, zakladki_total: zak,
        });
      }
    }

    res.json({
      dateFrom, dateTo, categories,
      coffee: {
        total_qty: totalQty, total_zakladki: totalZak,
        by_product: [...byProduct.values()].sort((a, b) => b.qty - a.qty),
      },
      debug: { usedProductsSales: prodSales.used || null },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- КЕШ: базові ціни товарів + workshop --------------------
// product_id -> { price, workshop }
let PRODUCT_BASE_PRICE = new Map();
let PRODUCT_BASE_CACHE_AT = 0;
const PRODUCT_BASE_TTL_MS = 30 * 60 * 1000;
const SPOT_ID = 1;

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
      if (Array.isArray(p.spots)) {
        const spot = p.spots.find(s => Number(s.spot_id) === SPOT_ID);
        if (spot) price = Number(spot.price) / 100;
      }
      if (price === null && p.price && typeof p.price === "object") {
        const raw = p.price[String(SPOT_ID)] ?? p.price["1"];
        if (raw != null) price = Number(raw) / 100;
      }
      const workshop = Number(p.workshop || 0);
      if (price !== null && price > 0) {
        map.set(pid, { price, workshop });
      }
    }
    if (map.size) { PRODUCT_BASE_PRICE = map; PRODUCT_BASE_CACHE_AT = now; }
  } catch (e) {
    console.error("ensureProductBasePrices error:", e);
  }
}

// -------------------- КЕШ: місячні upsell --------------------
const UPSELL_MONTH_CACHE = new Map();
const UPSELL_MONTH_TTL_MS = 30 * 60 * 1000;

// -------------------- UPSELL: розрахунок за період --------------------
async function calcUpsellForPeriod(dateFrom, dateTo) {
  const txResp = await poster("dash.getTransactions", { dateFrom, dateTo });
  const transactions = Array.isArray(txResp?.response) ? txResp.response : [];
  await ensureProductBasePrices();

  const userSums = new Map(); // uid -> { name, sauces, kitchen, bar, sum }

  const BATCH = 10;
  for (let i = 0; i < transactions.length; i += BATCH) {
    const batch = transactions.slice(i, i + BATCH);
    await Promise.all(batch.map(async (tx) => {
      const uid = String(tx.user_id);
      const name = String(tx.name || "");
      const txId = String(tx.transaction_id);
      try {
        const prodResp = await poster("dash.getTransactionProducts", { transaction_id: txId });
        const products = Array.isArray(prodResp?.response) ? prodResp.response : [];

        let txSauces = 0, txKitchen = 0, txBar = 0;

        for (const p of products) {
          const catId = Number(p.category_id);
          const modId = String(p.modification_id || "0");
          const num = Number(p.num || 1);
          const payedSum = Number(p.payed_sum || 0);
          const pid = Number(p.product_id);

          if (catId === 17) {
            txSauces += payedSum / 100;
          } else if (catId === 37) {
            txKitchen += payedSum / 100;
          } else if (catId === 41) {
            txBar += payedSum / 100;
          } else if (modId !== "0") {
            const info = PRODUCT_BASE_PRICE.get(pid);
            if (info != null && info.price > 0) {
              const delta = (payedSum / num / 100) - info.price;
              if (delta >= 1) {
                if (info.workshop === 1) { txBar += delta * num; }
                else { txKitchen += delta * num; }
              }
            }
          }
        }

        const txTotal = txSauces + txKitchen + txBar;
        if (txTotal > 0) {
          if (!userSums.has(uid)) {
            userSums.set(uid, { name, sauces: 0, kitchen: 0, bar: 0, sum: 0 });
          }
          const u = userSums.get(uid);
          u.sauces += txSauces;
          u.kitchen += txKitchen;
          u.bar += txBar;
          u.sum += txTotal;
        }
      } catch { /* skip */ }
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
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    const dayMap = await calcUpsellForPeriod(dateFrom, dateTo);

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

    // Всі хто є в місяці + сьогодні
    const allUsers = new Map([...monthMap, ...dayMap]);
    const result = [];
    for (const [uid, data] of allUsers) {
      const dayData = dayMap.get(uid);
      const monthData = monthMap.get(uid);
      const r = (v) => Math.round((v || 0) * 100) / 100;
      result.push({
        user_id: uid,
        name: data.name,
        day_sum: r(dayData?.sum),
        day_sauces: r(dayData?.sauces),
        day_kitchen: r(dayData?.kitchen),
        day_bar: r(dayData?.bar),
        month_sum: r(monthData?.sum),
      });
    }

    result.sort((a, b) => b.day_sum - a.day_sum);
    res.json({ dateFrom, dateTo, response: result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- UPSELL DETAIL ENDPOINT --------------------
app.get("/api/upsell-detail", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { format = "html" } = req.query;
    let { dateFrom, dateTo } = req.query;

    if (!dateFrom && format === "html") {
      const today = todayYYYYMMDD();
      const todayInput = `${today.slice(0,4)}-${today.slice(4,6)}-${today.slice(6,8)}`;
      const html = `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<title>Деталі допів — GRECO</title>
<style>
  body{font-family:sans-serif;background:#1a1a2e;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#16213e;padding:40px;border-radius:12px;width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.4)}
  h1{color:#f0a500;margin:0 0 24px;font-size:22px}
  label{display:block;color:#aaa;font-size:13px;margin-bottom:4px;margin-top:16px}
  input[type=date]{width:100%;padding:10px;background:#0f3460;border:1px solid #444;border-radius:6px;color:#fff;font-size:15px;box-sizing:border-box}
  .btns{display:flex;gap:10px;margin-top:24px}
  .btn{flex:1;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer}
  .btn-html{background:#0f3460;color:#00d4ff}.btn-csv{background:#27ae60;color:#fff}
  .btn:hover{opacity:0.85}
  .presets{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
  .preset{padding:5px 10px;background:#0f3460;border:1px solid #444;border-radius:4px;color:#aaa;font-size:12px;cursor:pointer}
  .preset:hover{background:#1a3a6e;color:#fff}
</style></head><body>
<div class="card">
  <h1>🔥 Деталі допів/соусів</h1>
  <label>Дата від</label>
  <input type="date" id="from" value="${todayInput}">
  <label>Дата до</label>
  <input type="date" id="to" value="${todayInput}">
  <div class="presets">
    <span class="preset" onclick="setPreset(0)">Сьогодні</span>
    <span class="preset" onclick="setPreset(1)">Вчора</span>
    <span class="preset" onclick="setPreset(7)">Тиждень</span>
    <span class="preset" onclick="setPreset(30)">Місяць</span>
  </div>
  <div class="btns">
    <button class="btn btn-html" onclick="go('html')">👁 Переглянути</button>
    <button class="btn btn-csv" onclick="go('csv')">⬇ Скачати CSV</button>
  </div>
</div>
<script>
function fmt(d){return d.toISOString().slice(0,10)}
function setPreset(days){
  const to=new Date(),from=new Date();
  if(days===1){to.setDate(to.getDate()-1);from.setDate(from.getDate()-1);}
  else if(days>1){from.setDate(from.getDate()-days);}
  document.getElementById('from').value=fmt(from);
  document.getElementById('to').value=fmt(to);
}
function go(fmt){
  const from=document.getElementById('from').value.replace(/-/g,'');
  const to=document.getElementById('to').value.replace(/-/g,'');
  if(!from||!to){alert('Вкажіть дати');return;}
  window.location.href='/api/upsell-detail?dateFrom='+from+'&dateTo='+to+'&format='+fmt;
}
</script></body></html>`;
      res.setHeader("Content-Type","text/html; charset=utf-8");
      return res.send(html);
    }

    if (!dateFrom) dateFrom = todayYYYYMMDD();
    if (!dateTo) dateTo = dateFrom;

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
            let amount = 0, type = null;

            if (catId === 17) {
              amount = payedSum / 100; type = "Соус"; checkSauces += amount;
            } else if (catId === 37) {
              amount = payedSum / 100; type = "Доп кухня"; checkKitchen += amount;
            } else if (catId === 41) {
              amount = payedSum / 100; type = "Доп бар"; checkBar += amount;
            } else if (modId !== "0") {
              const info = PRODUCT_BASE_PRICE.get(pid);
              if (info && info.price > 0) {
                const delta = (payedSum / num / 100) - info.price;
                if (delta >= 1) {
                  amount = Math.round(delta * num * 100) / 100;
                  if (info.workshop === 1) { type = "Мод бар"; checkBar += amount; }
                  else { type = "Мод кухня"; checkKitchen += amount; }
                }
              }
            }

            if (type && amount > 0) {
              lines.push({
                product: modName ? `${productName} ${modName}` : productName,
                qty: num, amount: Math.round(amount * 100) / 100, type,
              });
            }
          }

          const checkTotal = checkSauces + checkKitchen + checkBar;
          if (checkTotal > 0) {
            if (!userDetails.has(uid)) userDetails.set(uid, { name, checks: [], totals: { sauces:0, kitchen:0, bar:0, sum:0 } });
            const u = userDetails.get(uid);
            u.checks.push({ transaction_id: txId, time, lines,
              sauces: Math.round(checkSauces*100)/100,
              kitchen: Math.round(checkKitchen*100)/100,
              bar: Math.round(checkBar*100)/100,
              total: Math.round(checkTotal*100)/100 });
            u.totals.sauces += checkSauces; u.totals.kitchen += checkKitchen;
            u.totals.bar += checkBar; u.totals.sum += checkTotal;
          }
        } catch { /* skip */ }
      }));
    }

    const round = v => Math.round((v||0)*100)/100;
    const sorted = [...userDetails.values()].sort((a,b) => b.totals.sum - a.totals.sum);

    if (format === "csv") {
      const rows = [["Офіціант","Чек №","Час","Позиція","К-сть","Тип","Сума (грн)"]];
      for (const u of sorted) {
        for (const ch of u.checks.sort((a,b)=>a.time.localeCompare(b.time))) {
          for (const line of ch.lines) {
            rows.push([u.name, ch.transaction_id, ch.time, line.product, line.qty, line.type, String(line.amount).replace(".",",")]);
          }
          rows.push([u.name, ch.transaction_id, ch.time, "--- ПІДСУМОК ЧЕКУ ---", "", "", String(ch.total).replace(".",",")]);
        }
        rows.push([u.name,"","","=== ПІДСУМОК ОФІЦІАНТА ===","",
          `Соуси:${round(u.totals.sauces)} Кух:${round(u.totals.kitchen)} Бар:${round(u.totals.bar)}`,
          String(round(u.totals.sum)).replace(".",",")]);
        rows.push([]);
      }
      const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(";")).join("\n");
      res.setHeader("Content-Type","text/csv; charset=utf-8");
      res.setHeader("Content-Disposition",`attachment; filename="upsell_${dateFrom}_${dateTo}.csv"`);
      return res.send("\uFEFF"+csv);
    }

    let html = `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<title>Деталі допів — ${dateFrom}</title>
<style>
  body{font-family:monospace;background:#1a1a2e;color:#eee;padding:20px}
  h1{color:#f0a500}h2{color:#00d4ff;margin-top:30px;border-bottom:1px solid #444;padding-bottom:5px}
  .check{background:#16213e;border-left:3px solid #0f3460;margin:10px 0;padding:10px 15px;border-radius:4px}
  .check-header{color:#aaa;font-size:12px;margin-bottom:6px}
  .Соус{color:#1dd1a1}.Доп-кухня,.Мод-кухня{color:#ff9f43}.Доп-бар,.Мод-бар{color:#54a0ff}
  .badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;margin-left:6px}
  .check-total{margin-top:8px;padding-top:6px;border-top:1px dashed #444;font-size:13px;color:#f9ca24}
  .user-total{background:#0f3460;padding:8px 15px;border-radius:4px;margin-top:5px;color:#f9ca24;font-weight:bold}
  .topbar{display:flex;gap:10px;align-items:center;margin-bottom:20px;flex-wrap:wrap}
  .btn{padding:8px 16px;border-radius:6px;font-size:13px;text-decoration:none;font-weight:bold;display:inline-block}
  .btn-back{background:#444;color:#fff}.btn-csv{background:#27ae60;color:#fff}
</style></head><body>
<div class="topbar">
  <h1 style="margin:0">🔥 Деталі допів — ${dateFrom}${dateFrom!==dateTo?" → "+dateTo:""}</h1>
  <a class="btn btn-back" href="/api/upsell-detail">← Назад</a>
  <a class="btn btn-csv" href="/api/upsell-detail?dateFrom=${dateFrom}&dateTo=${dateTo}&format=csv">⬇ Скачати CSV</a>
</div>`;

    for (const u of sorted) {
      html += `<h2>👤 ${u.name}</h2>`;
      for (const ch of u.checks.sort((a,b)=>a.time.localeCompare(b.time))) {
        html += `<div class="check"><div class="check-header">Чек #${ch.transaction_id} · ${ch.time}</div>`;
        for (const line of ch.lines) {
          const cls = line.type.replace(" ","-");
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
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.send(html);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API server listening on ${port}`));
