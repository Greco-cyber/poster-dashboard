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

    // Зал — кава для гостей; Штат — кава для персоналу
    const ZAL_SHOTS   = new Map([[230,1],[485,1],[307,2],[231,1],[316,1],[406,1],[183,1],[182,1],[317,1],[425,1],[424,1],[441,1],[422,1],[423,2]]);
    const SHTAT_SHOTS = new Map([[529,1],[530,1],[531,2],[533,1],[534,1],[535,1]]);
    const shotsPerProduct = new Map([...ZAL_SHOTS, ...SHTAT_SHOTS]);

    await ensureProducts();
    let byProduct = new Map();
    let totalQty = 0, totalZak = 0;
    let zalQty   = 0, zalZak   = 0;
    let shtatQty = 0, shtatZak = 0;
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
        if (ZAL_SHOTS.has(pid))   { zalQty   += qty; zalZak   += zak; }
        else                       { shtatQty += qty; shtatZak += zak; }
        const info = PRODUCT_INFO.get(pid) || {};
        byProduct.set(pid, {
          product_id: pid, name: info.name || it.name || "",
          category_id: info.category_id ?? null,
          group: ZAL_SHOTS.has(pid) ? "zal" : "shtat",
          qty, zakladki_per_unit: per, zakladki_total: zak,
        });
      }
    }

    res.json({
      dateFrom, dateTo, categories,
      coffee: {
        total_qty: totalQty, total_zakladki: totalZak,
        zal:   { qty: zalQty,   zakladki: zalZak   },
        shtat: { qty: shtatQty, zakladki: shtatZak },
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

// -------------------- Ціни доставки (LOKO/Choice) --------------------
// Для чеків service_mode=2/3 використовуємо ці ціни як базові для дельти
const DELIVERY_PRICES = new Map([[8,69.0], [9,36.0], [12,65.0], [13,65.0], [14,69.0], [17,59.0], [27,79.0], [31,99.0], [37,139.0], [39,22.0], [40,239.0], [42,169.0], [44,36.0], [47,119.0], [49,119.0], [51,139.0], [53,179.0], [55,269.0], [57,79.0], [61,139.0], [63,139.0], [64,79.0], [66,139.0], [67,275.0], [68,79.0], [69,219.0], [71,329.0], [72,259.0], [73,65.0], [74,65.0], [75,69.0], [76,69.0], [81,19.0], [82,79.0], [92,495.0], [93,495.0], [96,750.0], [98,495.0], [99,495.0], [101,750.0], [106,495.0], [107,750.0], [114,109.0], [115,89.0], [116,145.0], [117,55.0], [122,119.0], [125,59.0], [129,69.0], [130,199.0], [131,119.0], [132,99.0], [133,159.0], [134,99.0], [135,89.0], [136,119.0], [137,99.0], [138,79.0], [139,129.0], [140,79.0], [141,79.0], [142,109.0], [143,35.0], [144,6.99], [145,13.0], [147,1.0], [149,1.0], [154,189.0], [163,89.0], [164,59.0], [166,95.0], [168,95.0], [170,125.0], [173,95.0], [174,135.0], [176,135.0], [177,125.0], [182,45.0], [183,59.0], [185,49.0], [186,179.0], [187,6.99], [189,43.0], [190,43.0], [191,43.0], [192,35.0], [193,43.0], [194,35.0], [195,45.0], [196,45.0], [197,59.0], [198,44.0], [199,109.0], [200,139.0], [201,119.0], [202,69.0], [203,109.0], [204,109.0], [206,159.0], [208,289.0], [209,289.0], [210,299.0], [211,209.0], [212,249.0], [214,179.0], [219,269.0], [221,22.0], [222,369.0], [224,79.0], [225,189.0], [226,199.0], [227,219.0], [228,219.0], [229,139.0], [230,79.0], [231,89.0], [233,109.0], [234,169.0], [243,52.0], [244,52.0], [247,13.0], [252,179.0], [254,12.0], [255,9.0], [256,199.0], [257,239.0], [258,750.0], [259,125.0], [262,159.0], [265,22.0], [273,199.0], [274,169.0], [275,199.0], [276,219.0], [277,23.0], [278,19.0], [279,19.0], [280,21.0], [281,23.0], [282,19.0], [283,29.0], [285,129.0], [288,159.0], [290,199.0], [293,9.0], [295,289.0], [296,1550.0], [297,22.0], [299,9.99], [300,79.0], [301,59.0], [302,59.0], [303,59.0], [304,59.0], [305,99.0], [306,99.0], [307,69.0], [308,19.0], [309,495.0], [310,95.0], [311,59.0], [312,59.0], [313,18.0], [314,24.0], [315,23.0], [316,60.0], [317,49.0], [320,59.0], [321,59.0], [325,199.0], [327,59.0], [330,43.0], [331,159.0], [332,99.0], [335,495.0], [336,69.0], [337,69.0], [338,69.0], [339,69.0], [340,69.0], [345,69.0], [346,69.0], [347,69.0], [349,69.0], [351,233.0], [353,95.0], [355,69.0], [356,750.0], [357,125.0], [360,299.0], [363,139.0], [365,69.0], [366,599.0], [367,95.0], [368,750.0], [369,135.0], [370,569.0], [371,50.0], [375,69.0], [379,5.0], [384,189.0], [387,199.0], [391,49.0], [395,89.0], [397,129.0], [399,189.0], [401,149.0], [402,99.0], [403,169.0], [404,169.0], [405,199.0], [406,69.0], [407,19.0], [408,19.0], [409,19.0], [410,19.0], [411,19.0], [412,19.0], [413,43.0], [414,109.0], [415,135.0], [416,750.0], [418,109.0], [421,19.0], [422,69.0], [423,79.0], [424,55.0], [425,79.0], [429,36.0], [438,199.0], [440,159.0], [441,60.0], [443,20.0], [444,189.0], [446,16.0], [447,13.0], [448,9.0], [451,149.0], [452,89.0], [453,29.0], [454,19.0], [455,36.0], [456,69.0], [457,59.0], [458,40.0], [468,45.0], [469,45.0], [473,2.49], [475,39.0], [476,499.0], [477,750.0], [478,135.0], [480,599.0], [481,149.0], [482,119.0], [483,59.0], [485,89.0], [487,279.0], [493,199.0], [494,169.0], [495,199.0], [497,189.0], [498,69.0], [502,65.0], [503,109.0], [504,199.0], [505,109.0], [506,109.0], [507,199.0], [508,219.0], [510,199.0], [515,369.0], [517,16.0], [518,14.0], [519,129.0], [520,369.0], [521,189.0], [523,19.0], [526,199.0], [528,259.0], [529,10.0], [530,12.0], [531,12.0], [532,10.0], [533,6.99], [534,12.0], [535,10.0], [536,10.0], [537,5.0], [540,109.0], [541,7.0], [542,19.0], [545,299.0], [548,199.0], [550,26.0], [551,329.0], [554,75.0], [558,79.0], [560,59.0], [565,22.0], [569,229.0], [570,79.0], [571,289.0], [573,209.0], [576,69.0], [577,49.0], [578,1.99], [589,199.0], [596,750.0], [597,149.0], [598,139.0], [599,229.0], [600,129.0], [601,149.0], [602,299.0], [603,149.0], [604,495.0], [605,149.0], [616,199.0], [620,199.0], [622,189.0], [623,1.0], [624,20.0], [627,299.0], [631,229.0], [632,199.0], [634,95.0], [636,39.0], [637,139.0], [638,22.0], [643,109.0], [646,289.0], [648,289.0], [650,299.0], [652,289.0], [654,289.0], [656,109.0], [657,289.0], [659,289.0], [660,289.0], [661,289.0], [662,289.0], [663,299.0], [664,289.0], [665,109.0], [666,369.0], [667,495.0], [668,135.0], [669,450.0], [670,599.0], [671,495.0], [672,135.0], [673,229.0], [674,135.0]]);

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

// -------------------- КЕШ: ціни допів по назві --------------------
// normalized_name -> { price, workshop }
let MOD_PRICES = new Map();
let MOD_PRICES_CACHE_AT = 0;
const MOD_PRICES_TTL_MS = 30 * 60 * 1000;

// Заміна латинських букв що схожі на кириличні
function latinToCyrillic(s) {
  const map = {
    'a': 'а', 'e': 'е', 'i': 'і', 'o': 'о', 'p': 'р', 'c': 'с',
    'y': 'у', 'x': 'х', 'A': 'А', 'E': 'Е', 'I': 'І', 'O': 'О',
    'P': 'Р', 'C': 'С', 'Y': 'У', 'X': 'Х', 'B': 'В', 'H': 'Н',
    'K': 'К', 'M': 'М', 'T': 'Т',
  };
  return s.split('').map(c => map[c] || c).join('');
}

function normalizeName(s) {
  return latinToCyrillic(String(s || ""))
    .replace(/\s*(?:[×xX\*]|&times;?)\s*\d+\s*$/, "") // прибираємо × 3 з кінця
    .toLowerCase().replace(/\s+/g, " ").trim();
}

// Парсимо назву модифікатора і кількість з рядка типу "Хліб білий × 3"
function parseModPart(part) {
  // Шукаємо × або x або * або &times або &times; перед числом в кінці
  const match = part.match(/^(.+?)\s*(?:[×xX\*]|&times;?)\s*(\d+)\s*$/);
  if (match) {
    return { name: match[1].trim(), qty: Number(match[2]) };
  }
  return { name: part.trim(), qty: 1 };
}

// Ключові слова для нечіткого пошуку (без цифр і одиниць виміру)
function keyWords(s) {
  return new Set(
    String(s || "").toLowerCase()
      .replace(/\d+/g, "")
      .replace(/\b(г|мл|кг|шт|л)\b/g, "")
      .split(/[\s,+.]+/)
      .filter(w => w.length > 2)
  );
}

// Шукаємо доп по назві: спочатку точний збіг, потім по ключових словах
function findModByName(rawPart, modPricesMap) {
  const norm = normalizeName(rawPart);
  // 1. Точний збіг
  if (modPricesMap.has(norm)) return modPricesMap.get(norm);
  // 2. Пошук по ключових словах
  const kw = keyWords(rawPart);
  if (kw.size === 0) return null;
  let best = null, bestScore = 0;
  for (const [name, info] of modPricesMap) {
    const kwName = keyWords(name);
    const overlap = [...kw].filter(w => kwName.has(w)).length;
    const score = overlap / Math.max(kw.size, kwName.size);
    if (overlap >= 1 && score > bestScore) {
      bestScore = score;
      best = info;
    }
  }
  return best;
}

// Скорочена назва — без цифр, одиниць виміру, розділових знаків
// "Філе курки, 60 г" → "філе курки"
function shortName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[+,]/g, " ")           // прибираємо + і ,
    .replace(/\d+\s*(г|мл|кг|л|шт)?/g, "") // прибираємо числа з одиницями
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureModPrices() {
  const now = Date.now();
  if (MOD_PRICES.size && now - MOD_PRICES_CACHE_AT < MOD_PRICES_TTL_MS) return;

  try {
    const j = await poster("menu.getProducts");
    const arr = Array.isArray(j?.response) ? j.response : [];
    const map = new Map();
    const DOP_CATS = new Set([17, 37, 41]);

    for (const p of arr) {
      const catId = Number(p.menu_category_id ?? p.category_id);
      if (!DOP_CATS.has(catId)) continue;

      const workshop = Number(p.workshop || 0);
      const name = normalizeName(p.product_name);
      let price = null;

      if (Array.isArray(p.spots)) {
        const spot = p.spots.find(s => Number(s.spot_id) === SPOT_ID);
        if (spot) price = Number(spot.price) / 100;
      }
      if (price === null && p.price && typeof p.price === "object") {
        const raw = p.price[String(SPOT_ID)] ?? p.price["1"];
        if (raw != null) price = Number(raw) / 100;
      }

      if (name && price !== null && price > 0) {
        map.set(name, { price, workshop });
        // Також зберігаємо по скороченій назві (без цифр і одиниць)
        const sName = shortName(p.product_name);
        if (sName && sName !== name && !map.has(sName)) {
          map.set(sName, { price, workshop });
        }
      }
    }

    if (map.size) {
      MOD_PRICES = map;
      MOD_PRICES_CACHE_AT = now;
      console.log(`MOD_PRICES loaded: ${map.size} items`);
    }
  } catch (e) {
    console.error("ensureModPrices error:", e);
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
  await ensureModPrices();

  const userSums = new Map(); // uid -> { name, sauces, kitchen, bar, sum }

  const BATCH = 10;
  // Тільки закриті чеки (status=2) з ненульовою оплатою
  const closedTx = transactions.filter(tx => tx.status === "2" && Number(tx.payed_sum) > 0);
  for (let i = 0; i < closedTx.length; i += BATCH) {
    const batch = closedTx.slice(i, i + BATCH);
    await Promise.all(batch.map(async (tx) => {
      const uid = String(tx.user_id);
      const name = String(tx.name || "");
      const txId = String(tx.transaction_id);
      const isDelivery = Number(tx.service_mode) === 2 || Number(tx.service_mode) === 3;
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
            // Якщо payed_sum має копійки — акційний доп (0.01 грн), пропускаємо
            if (payedSum % 100 !== 0) continue;
            const rawMod = String(p.modificator_name || "");
            // Спочатку точний збіг повної назви, потім розбиваємо по "+"
            const { name: rawModName, qty: rawModQty } = parseModPart(rawMod);
            // Якщо × N не вбудовано в назву — беремо num (кількість страв)
            const effectiveQty = rawModQty > 1 ? rawModQty : num;
            const fullNorm = normalizeName(rawModName);
            const fullExact = MOD_PRICES.get(fullNorm);
            if (fullExact && fullExact.price > 0) {
              const amount = fullExact.price * effectiveQty;
              if (fullExact.workshop === 1) { txBar += amount; }
              else { txKitchen += amount; }
            } else {
              const parts = rawMod.split(/,\s*\+/).map(s => s.replace(/^\+/,"").trim()).filter(s => s.length > 3);
              for (const part of parts) {
                const { name: partName, qty: modQty } = parseModPart(part);
                const partQty = modQty > 1 ? modQty : num;
                const modInfo = findModByName(partName, MOD_PRICES);
                if (modInfo && modInfo.price > 0) {
                  const amount = modInfo.price * partQty;
                  if (modInfo.workshop === 1) { txBar += amount; }
                  else { txKitchen += amount; }
                }
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

// -------------------- BONUS DETAIL ENDPOINT --------------------
app.get("/api/upsell-detail", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });

    const { format = "html" } = req.query;
    let { dateFrom, dateTo } = req.query;

    // ---- Форма вибору дати ----
    if (!dateFrom && format === "html") {
      const today = todayYYYYMMDD();
      const todayInput = `${today.slice(0,4)}-${today.slice(4,6)}-${today.slice(6,8)}`;
      const formHtml = `<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8">
<title>Деталі бонусів — GRECO</title>
<style>
  body{font-family:sans-serif;background:#111827;color:#eee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1f2937;padding:40px;border-radius:12px;width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.5)}
  h1{color:#f59e0b;margin:0 0 24px;font-size:22px}
  label{display:block;color:#9ca3af;font-size:13px;margin-bottom:4px;margin-top:16px}
  input[type=date]{width:100%;padding:10px;background:#374151;border:1px solid #4b5563;border-radius:6px;color:#fff;font-size:15px;box-sizing:border-box}
  .btns{display:flex;gap:10px;margin-top:24px}
  .btn{flex:1;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:bold;cursor:pointer}
  .btn-html{background:#1d4ed8;color:#fff}.btn-csv{background:#059669;color:#fff}
  .btn:hover{opacity:0.85}
  .presets{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
  .preset{padding:5px 10px;background:#374151;border:1px solid #4b5563;border-radius:4px;color:#9ca3af;font-size:12px;cursor:pointer}
  .preset:hover{background:#4b5563;color:#fff}
</style></head><body>
<div class="card">
  <h1>💰 Деталі бонусів</h1>
  <label>Дата від</label><input type="date" id="from" value="${todayInput}">
  <label>Дата до</label><input type="date" id="to" value="${todayInput}">
  <div class="presets">
    <span class="preset" onclick="setP(0)">Сьогодні</span>
    <span class="preset" onclick="setP(1)">Вчора</span>
    <span class="preset" onclick="setP(7)">Тиждень</span>
    <span class="preset" onclick="setP(30)">Місяць</span>
  </div>
  <div class="btns">
    <button class="btn btn-html" onclick="go('html')">👁 Переглянути</button>
    <button class="btn btn-csv" onclick="go('csv')">⬇ Скачати CSV</button>
  </div>
</div>
<script>
function fD(d){return d.toISOString().slice(0,10)}
function setP(days){
  const to=new Date(),from=new Date();
  if(days===1){to.setDate(to.getDate()-1);from.setDate(from.getDate()-1);}
  else if(days>1){from.setDate(from.getDate()-days);}
  document.getElementById('from').value=fD(from);
  document.getElementById('to').value=fD(to);
}
function go(f){
  const from=document.getElementById('from').value.replace(/-/g,'');
  const to=document.getElementById('to').value.replace(/-/g,'');
  if(!from||!to){alert('Вкажіть дати');return;}
  window.location.href='/api/upsell-detail?dateFrom='+from+'&dateTo='+to+'&format='+f;
}
</script></body></html>`;
      res.setHeader("Content-Type","text/html; charset=utf-8");
      return res.send(formHtml);
    }

    if (!dateFrom) dateFrom = todayYYYYMMDD();
    if (!dateTo) dateTo = dateFrom;

    await ensureProductBasePrices();
    await ensureModPrices();

    const isBarman = (name) => { const n = String(name||"").toLowerCase(); return n.includes("бар") || n.includes("bar"); };

    // 1. Виторг по кожному
    const waitersResp = await poster("dash.getWaitersSales", { dateFrom, dateTo });
    const allWaiters = Array.isArray(waitersResp?.response) ? waitersResp.response : [];
    const revenueMap = new Map();
    for (const w of allWaiters) {
      revenueMap.set(String(w.user_id), {
        name: String(w.name || ""),
        revenue: Number(w.revenue || 0) / 100,
        isBarman: isBarman(w.name),
      });
    }

    // 2. Спільні категорії барменів (чай/кава=28, коктейлі=34, лимонади=48+49+50)
    const catsResp = await poster("dash.getCategoriesSales", { dateFrom, dateTo });
    const catsArr = Array.isArray(catsResp?.response) ? catsResp.response : [];
    const catRevMap = new Map();
    for (const x of catsArr) {
      const cid = Number(x.category_id);
      const raw = Number(x.revenue ?? x.sales_sum ?? x.sum ?? x.payed_sum ?? x.turnover ?? 0);
      catRevMap.set(cid, raw / 100);
    }
    const teaCoffeeRev = catRevMap.get(28) || 0;
    const cocktailsRev = catRevMap.get(34) || 0;
    const lemonadesRev = [48,49,50].reduce((s,id) => s + (catRevMap.get(id)||0), 0);

    // 3. Перебір чеків — збираємо позиції по кожному офіціанту/бармену
    const txResp = await poster("dash.getTransactions", { dateFrom, dateTo });
    const transactions = Array.isArray(txResp?.response) ? txResp.response : [];
    const closedTx = transactions.filter(tx => tx.status === "2" && Number(tx.payed_sum) > 0);

    const DESSERT_CATS_D = new Set([32]);
    const WINE_CATS_D    = new Set([22,23,25,26,30,39]);
    const COCKTAIL_CAT_D = new Set([34]);

    // uid -> { name, isBarman, revenue, checks: [{ tx_id, time, lines:[{product,qty,amount,pct,type}] }] }
    const userDetails = new Map();

    const BATCH = 10;
    for (let i = 0; i < closedTx.length; i += BATCH) {
      const batch = closedTx.slice(i, i + BATCH);
      await Promise.all(batch.map(async (tx) => {
        const uid = String(tx.user_id);
        const txName = String(tx.name || "");
        const txIsBar = isBarman(txName);
        const txId = String(tx.transaction_id);
        const time = String(tx.date_close_date || "");
        try {
          const prodResp = await poster("dash.getTransactionProducts", { transaction_id: txId });
          const products = Array.isArray(prodResp?.response) ? prodResp.response : [];
          const lines = [];
          const upsellPct = txIsBar ? 0.07 : 0.10;

          for (const p of products) {
            const catId  = Number(p.category_id);
            const modId  = String(p.modification_id || "0");
            const num    = Number(p.num || 1);
            const payed  = Number(p.payed_sum || 0);
            const pName  = String(p.product_name || "");

            // Соуси / допи кухня / допи бар
            if (catId === 17) {
              const a = payed/100; if (a>0) lines.push({ product: pName, qty: num, amount: Math.round(a*100)/100, pct: upsellPct, type:"Соус" });
              continue;
            }
            if (catId === 37) {
              const a = payed/100; if (a>0) lines.push({ product: pName, qty: num, amount: Math.round(a*100)/100, pct: upsellPct, type:"Доп кухня" });
              continue;
            }
            if (catId === 41) {
              const a = payed/100; if (a>0) lines.push({ product: pName, qty: num, amount: Math.round(a*100)/100, pct: upsellPct, type:"Доп бар" });
              continue;
            }

            // Категорійні бонуси офіціантів (не барменів)
            if (!txIsBar) {
              if (DESSERT_CATS_D.has(catId)) {
                const a = payed/100; if (a>0) lines.push({ product: pName, qty: num, amount: Math.round(a*100)/100, pct:0.05, type:"Десерт" });
                continue;
              }
              if (WINE_CATS_D.has(catId)) {
                const a = payed/100; if (a>0) lines.push({ product: pName, qty: num, amount: Math.round(a*100)/100, pct:0.05, type:"Вино" });
                continue;
              }
              if (COCKTAIL_CAT_D.has(catId)) {
                const a = payed/100; if (a>0) lines.push({ product: pName, qty: num, amount: Math.round(a*100)/100, pct:0.05, type:"Коктейль" });
                continue;
              }
            }

            // Модифікатори
            if (modId !== "0") {
              if (payed === 0 || payed % 100 !== 0) continue; // безкоштовний або промо — пропускаємо
              const rawMod = String(p.modificator_name || "");
              const { name: rName, qty: rQty } = parseModPart(rawMod);
              const effQty = rQty > 1 ? rQty : num;
              const fullNorm = normalizeName(rName);
              const fullExact = MOD_PRICES.get(fullNorm);
              if (fullExact && fullExact.price > 0) {
                const a = Math.round(fullExact.price * effQty * 100) / 100;
                lines.push({ product: rName, qty: effQty, amount: a, pct: upsellPct, type: fullExact.workshop===1?"Мод бар":"Мод кухня" });
              } else {
                for (const part of rawMod.split(/,\s*\+/).map(s=>s.replace(/^\+/,"").trim()).filter(s=>s.length>3)) {
                  const { name: pN, qty: pQ } = parseModPart(part);
                  const pQty = pQ > 1 ? pQ : num;
                  const mInfo = findModByName(pN, MOD_PRICES);
                  if (mInfo && mInfo.price > 0) {
                    const a = Math.round(mInfo.price * pQty * 100) / 100;
                    lines.push({ product: pN, qty: pQty, amount: a, pct: upsellPct, type: mInfo.workshop===1?"Мод бар":"Мод кухня" });
                  }
                }
              }
            }
          }

          if (lines.length > 0) {
            if (!userDetails.has(uid)) {
              const rv = revenueMap.get(uid) || {};
              userDetails.set(uid, { name: rv.name||txName, isBarman: txIsBar, revenue: rv.revenue||0, checks:[] });
            }
            userDetails.get(uid).checks.push({ tx_id: txId, time, lines });
          }
        } catch { /* skip */ }
      }));
    }

    // Додаємо тих у кого є виторг але немає допів
    for (const [uid, info] of revenueMap) {
      if (!userDetails.has(uid)) {
        userDetails.set(uid, { name: info.name, isBarman: info.isBarman, revenue: info.revenue, checks:[] });
      } else {
        const u = userDetails.get(uid);
        u.revenue = info.revenue; u.name = info.name; u.isBarman = info.isBarman;
      }
    }

    const r2  = v => Math.round((v||0)*100)/100;
    const f0  = v => Number(v).toLocaleString("uk-UA",{minimumFractionDigits:0,maximumFractionDigits:0});
    const f2  = v => Number(v).toLocaleString("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:2});
    const pStr = v => `${+(v*100).toFixed(2)}%`;

    const waiters = [...userDetails.values()].filter(u=>!u.isBarman).sort((a,b)=>b.revenue-a.revenue);
    const barmen  = [...userDetails.values()].filter(u=>u.isBarman).sort((a,b)=>b.revenue-a.revenue);

    // ---- CSV ----
    if (format === "csv") {
      const rows = [["Роль","Ім'я","Чек #","Час","Позиція","Категорія","Ціна (₴)","% бонусу","Бонус (₴)"]];
      const addRows = (u, role) => {
        const revPct   = u.isBarman ? 0.013 : 0.0075;
        const revBonus = r2(u.revenue * revPct);
        let total = revBonus;
        rows.push([role,u.name,"—","","Виторг","Виторг",f2(u.revenue),pStr(revPct),f2(revBonus)]);
        for (const ch of u.checks.sort((a,b)=>a.time.localeCompare(b.time))) {
          for (const l of ch.lines) {
            const b = r2(l.amount*l.pct); total=r2(total+b);
            rows.push([role,u.name,"#"+ch.tx_id,ch.time,l.product,l.type,f2(l.amount),pStr(l.pct),f2(b)]);
          }
        }
        if (u.isBarman) {
          const tc=r2(teaCoffeeRev*0.07), co=r2(cocktailsRev*0.15), le=r2(lemonadesRev*0.10);
          rows.push([role,u.name,"—","","☕ Чай/Кава (зміна)","Спільне",f2(teaCoffeeRev),"7%",f2(tc)]);
          rows.push([role,u.name,"—","","🍸 Алк. коктейлі (зміна)","Спільне",f2(cocktailsRev),"15%",f2(co)]);
          rows.push([role,u.name,"—","","🍋 Лимонади + Мохіто (зміна)","Спільне",f2(lemonadesRev),"10%",f2(le)]);
          total=r2(total+tc+co+le);
        }
        rows.push(["","ПІДСУМОК: "+u.name,"","","","","","",f2(r2(total))]);
        rows.push([]);
      };
      for (const u of waiters) addRows(u,"Офіціант");
      for (const u of barmen)  addRows(u,"Бармен");
      const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(";")).join("\n");
      res.setHeader("Content-Type","text/csv; charset=utf-8");
      res.setHeader("Content-Disposition",`attachment; filename="bonus_${dateFrom}_${dateTo}.csv"`);
      return res.send("﻿feff"+csv);
    }

    // ---- HTML ----
    const TYPE_COLOR = {
      "Соус":"#10b981","Доп кухня":"#10b981","Доп бар":"#10b981",
      "Мод кухня":"#10b981","Мод бар":"#10b981",
      "Десерт":"#f472b6","Вино":"#a78bfa","Коктейль":"#fbbf24",
    };
    // Відповідність типу → колонка дашборду
    const DASH_COL = {
      "Соус":      { label:"Соуси + доп", color:"#10b981" },
      "Доп кухня": { label:"Соуси + доп", color:"#10b981" },
      "Доп бар":   { label:"Соуси + доп", color:"#10b981" },
      "Мод кухня": { label:"Соуси + доп", color:"#10b981" },
      "Мод бар":   { label:"Соуси + доп", color:"#10b981" },
      "Десерт":    { label:"Десерти",     color:"#f472b6" },
      "Вино":      { label:"Вино",        color:"#a78bfa" },
      "Коктейль":        { label:"Алк. коктейлі",      color:"#fbbf24" },
      "Чай / Кава":      { label:"Чай / Кава",          color:"#60a5fa" },
      "Алк. коктейлі":   { label:"Алк. коктейлі",      color:"#fbbf24" },
      "Лимонади + Мохіто":{ label:"Лимонади + Мохіто", color:"#34d399" },
    };

    const buildRows = (u) => {
      let total = 0, rows = "";

      // Групуємо по чеку
      for (const ch of (u.checks||[]).sort((a,b)=>a.time.localeCompare(b.time))) {
        if (!ch.lines.length) continue;
        const timeStr = (ch.time||"").slice(11,16);
        // Заголовок чека
        rows += `<tr class="row-check-header">
          <td colspan="4" class="td-check-header">
            Чек #${ch.tx_id}${timeStr ? ` · ${timeStr}` : ""}
          </td>
        </tr>`;
        // Позиції чека
        for (const l of ch.lines) {
          const b = r2(l.amount*l.pct); total=r2(total+b);
          const dc = DASH_COL[l.type] || { label: l.type, color:"#9ca3af" };
          rows += `<tr class="row-item">
            <td class="td-indent">↳</td>
            <td>
              <span class="dash-col-badge" style="background:${dc.color}22;color:${dc.color};border-color:${dc.color}55">${dc.label}</span>
              <span class="item-name">${l.product}</span>
            </td>
            <td class="td-r">${f0(l.amount)} ₴ <span class="td-pct-inline">${pStr(l.pct)}</span></td>
            <td class="td-bonus">${f2(b)} ₴</td></tr>`;
        }
      }

      if (u.isBarman) {
        const shared = [
          { label:"☕ Чай / Кава",        amt: teaCoffeeRev, pct: 0.07, dashCol:"Чай / Кава" },
          { label:"🍸 Алк. коктейлі",     amt: cocktailsRev, pct: 0.15, dashCol:"Алк. коктейлі" },
          { label:"🍋 Лимонади + Мохіто", amt: lemonadesRev, pct: 0.10, dashCol:"Лимонади + Мохіто" },
        ];
        rows += `<tr class="row-check-header"><td colspan="4" class="td-check-header">Загальне по зміні</td></tr>`;
        for (const s of shared) {
          const b = r2(s.amt*s.pct); total=r2(total+b);
          const dc = DASH_COL[s.dashCol] || { label: s.dashCol, color:"#60a5fa" };
          rows += `<tr class="row-shared">
            <td class="td-indent">↳</td>
            <td>
              <span class="dash-col-badge" style="background:${dc.color}22;color:${dc.color};border-color:${dc.color}55">${dc.label}</span>
              <span class="item-name">${s.label}</span>
            </td>
            <td class="td-r">${f0(s.amt)} ₴ <span class="td-pct-inline">${pStr(s.pct)}</span></td>
            <td class="td-bonus">${f2(b)} ₴</td></tr>`;
        }
      }

      rows += `<tr class="row-total">
        <td colspan="3">ПІДСУМОК БОНУСУ</td>
        <td class="td-bonus" style="font-size:15px">${f2(r2(total))} ₴</td></tr>`;
      return rows;
    };

    const buildSection = (users, title, role) => {
      if (!users.length) return "";
      let s = `<h2 class="sec-title">${title}</h2>`;
      for (const u of users) {
          let total = 0;
        for (const ch of u.checks) for (const l of ch.lines) total=r2(total+l.amount*l.pct);
        if (u.isBarman) total=r2(total+teaCoffeeRev*0.07+cocktailsRev*0.15+lemonadesRev*0.10);
        s += `<div class="ublock">
          <div class="uhead">
            <span class="uname">${u.name}</span>
            <span class="urole">${role}</span>
            <span class="utotal">Бонус: ${f2(r2(total))} ₴</span>
          </div>
          <div style="overflow-x:auto">
          <table>
            <thead><tr>
              <th style="width:24px"></th>
              <th>Позиція</th>
              <th class="td-r" style="width:140px">Ціна / %</th>
              <th class="td-bonus" style="width:100px">Бонус</th>
            </tr></thead>
            <tbody>${buildRows(u)}</tbody>
          </table></div>
        </div>`;
      }
      return s;
    };

    const page = `<!DOCTYPE html>
<html lang="uk"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Бонуси — ${dateFrom}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#111827;color:#e5e7eb;padding:16px;font-size:14px}
.topbar{display:flex;gap:10px;align-items:center;margin-bottom:20px;flex-wrap:wrap}
.topbar h1{font-size:18px;color:#f59e0b;flex:1}
.btn{padding:7px 14px;border-radius:6px;font-size:13px;text-decoration:none;font-weight:600;display:inline-block;border:none;cursor:pointer}
.btn-back{background:#374151;color:#e5e7eb}.btn-csv{background:#059669;color:#fff}
.sec-title{font-size:15px;font-weight:700;color:#93c5fd;border-bottom:1px solid #374151;padding-bottom:6px;margin:24px 0 10px}
.ublock{background:#1f2937;border-radius:10px;border:1px solid #374151;margin-bottom:14px;overflow:hidden}
.uhead{display:flex;align-items:center;gap:10px;padding:9px 14px;background:#111827;flex-wrap:wrap}
.uname{font-size:14px;font-weight:700;color:#fff}
.urole{font-size:11px;background:#374151;color:#9ca3af;padding:2px 7px;border-radius:999px}
.urev{font-size:12px;color:#6b7280;margin-left:auto}
.utotal{font-size:13px;font-weight:700;color:#34d399;background:#064e3b;padding:3px 10px;border-radius:999px}
table{width:100%;border-collapse:collapse;font-size:13px}
thead th{text-align:left;padding:7px 10px;color:#9ca3af;font-weight:600;font-size:11px;background:#1a2332;border-bottom:1px solid #374151}
tbody td{padding:6px 10px;border-bottom:1px solid #1a2332;vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
.td-r{text-align:right;white-space:nowrap;color:#d1d5db}
.td-pct-inline{color:#9ca3af;font-size:11px;margin-left:4px}
.td-bonus{text-align:right;white-space:nowrap;font-weight:600;color:#34d399}
.td-indent{color:#4b5563;font-size:12px;width:24px;text-align:center}
.badge{font-size:10px;border:1px solid;border-radius:3px;padding:1px 4px;margin-left:5px;opacity:.85}
.dash-col-badge{display:inline-block;font-size:11px;font-weight:600;border:1px solid;border-radius:4px;padding:1px 6px;margin-right:6px;white-space:nowrap}
.item-name{font-size:13px;color:#9ca3af}
.row-check-header td{background:#0f172a;padding:8px 10px 4px}
.td-check-header{font-size:12px;font-weight:700;color:#60a5fa;letter-spacing:0.03em}
.row-item td{background:#1f2937}
.row-item:hover td{background:#263447}
.row-shared td{background:#1a1f2e}
.row-total td{background:#064e3b;font-weight:700;color:#34d399;padding:9px 10px}
</style></head><body>
<div class="topbar">
  <h1>💰 Бонуси — ${dateFrom}${dateFrom!==dateTo?" → "+dateTo:""}</h1>
  <a class="btn btn-back" href="/api/upsell-detail">← Назад</a>
  <a class="btn btn-csv" href="/api/upsell-detail?dateFrom=${dateFrom}&dateTo=${dateTo}&format=csv">⬇ CSV</a>
</div>
${buildSection(waiters,"👤 Офіціанти","Офіціант")}
${buildSection(barmen,"🍸 Бармени","Бармен")}
</body></html>`;

    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.send(page);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- WAITERS BONUS DATA --------------------
const DESSERT_CATS  = new Set([32]);
const WINE_CATS     = new Set([22, 23, 25, 26, 30, 39]);
const COCKTAIL_CATS = new Set([34]);

async function calcWaitersBonusData(dateFrom, dateTo) {
  const txResp = await poster("dash.getTransactions", { dateFrom, dateTo });
  const transactions = Array.isArray(txResp?.response) ? txResp.response : [];
  await ensureModPrices();

  const userSums = new Map(); // uid -> { name, sauces, kitchen, bar, desserts, wines, cocktails }

  const BATCH = 10;
  const closedTx = transactions.filter(tx => tx.status === "2" && Number(tx.payed_sum) > 0);

  for (let i = 0; i < closedTx.length; i += BATCH) {
    const batch = closedTx.slice(i, i + BATCH);
    await Promise.all(batch.map(async (tx) => {
      const uid = String(tx.user_id);
      const name = String(tx.name || "");
      const txId = String(tx.transaction_id);
      try {
        const prodResp = await poster("dash.getTransactionProducts", { transaction_id: txId });
        const products = Array.isArray(prodResp?.response) ? prodResp.response : [];

        let txSauces = 0, txKitchen = 0, txBar = 0;
        let txDesserts = 0, txWines = 0, txCocktails = 0;

        for (const p of products) {
          const catId = Number(p.category_id);
          const modId = String(p.modification_id || "0");
          const num = Number(p.num || 1);
          const payedSum = Number(p.payed_sum || 0);

          // Категорійні бонуси
          if (DESSERT_CATS.has(catId))       txDesserts  += payedSum / 100;
          else if (WINE_CATS.has(catId))     txWines     += payedSum / 100;
          else if (COCKTAIL_CATS.has(catId)) txCocktails += payedSum / 100;

          // Upsell (та ж механіка)
          if (catId === 17) {
            txSauces += payedSum / 100;
          } else if (catId === 37) {
            txKitchen += payedSum / 100;
          } else if (catId === 41) {
            txBar += payedSum / 100;
          } else if (modId !== "0") {
            if (payedSum === 0 || payedSum % 100 !== 0) continue;
            const rawMod = String(p.modificator_name || "");
            const { name: rawModName, qty: rawModQty } = parseModPart(rawMod);
            const effectiveQty = rawModQty > 1 ? rawModQty : num;
            const fullNorm = normalizeName(rawModName);
            const fullExact = MOD_PRICES.get(fullNorm);
            if (fullExact && fullExact.price > 0) {
              const amount = fullExact.price * effectiveQty;
              if (fullExact.workshop === 1) txBar += amount; else txKitchen += amount;
            } else {
              const parts = rawMod.split(/,\s*\+/).map(s => s.replace(/^\+/,"").trim()).filter(s => s.length > 3);
              for (const part of parts) {
                const { name: partName, qty: modQty } = parseModPart(part);
                const partQty = modQty > 1 ? modQty : num;
                const modInfo = findModByName(partName, MOD_PRICES);
                if (modInfo && modInfo.price > 0) {
                  const amount = modInfo.price * partQty;
                  if (modInfo.workshop === 1) txBar += amount; else txKitchen += amount;
                }
              }
            }
          }
        }

        if (txSauces + txKitchen + txBar + txDesserts + txWines + txCocktails > 0) {
          if (!userSums.has(uid)) userSums.set(uid, { name, sauces:0, kitchen:0, bar:0, desserts:0, wines:0, cocktails:0 });
          const u = userSums.get(uid);
          u.sauces += txSauces; u.kitchen += txKitchen; u.bar += txBar;
          u.desserts += txDesserts; u.wines += txWines; u.cocktails += txCocktails;
        }
      } catch { /* skip */ }
    }));
  }
  return userSums;
}

// -------------------- WAITERS BONUS ENDPOINT --------------------
app.get("/api/waiters-bonus", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    const [waitersResp, bonusData] = await Promise.all([
      poster("dash.getWaitersSales", { dateFrom, dateTo }),
      calcWaitersBonusData(dateFrom, dateTo),
    ]);

    const allWaiters = Array.isArray(waitersResp?.response) ? waitersResp.response : [];
    const isBarman = (name) => { const n = String(name || "").toLowerCase(); return n.includes("бар") || n.includes("bar"); };
    const waiters = allWaiters.filter(w => !isBarman(w.name));

    const r2 = v => Math.round((v || 0) * 100) / 100;

    const response = waiters.map(w => {
      const uid = String(w.user_id);
      const revenue = r2(Number(w.revenue || 0) / 100);
      const d = bonusData.get(uid);
      const upsellSum    = d ? r2(d.sauces + d.kitchen + d.bar) : 0;
      const dessertsSum  = d ? r2(d.desserts) : 0;
      const winesSum     = d ? r2(d.wines) : 0;
      const cocktailsSum = d ? r2(d.cocktails) : 0;

      return {
        user_id: uid,
        name: String(w.name || ""),
        revenue,
        revenue_bonus:   r2(revenue     * 0.0075),
        upsell_sum:      upsellSum,
        upsell_bonus:    r2(upsellSum   * 0.10),
        desserts_sum:    dessertsSum,
        desserts_bonus:  r2(dessertsSum * 0.05),
        wines_sum:       winesSum,
        wines_bonus:     r2(winesSum    * 0.05),
        cocktails_sum:   cocktailsSum,
        cocktails_bonus: r2(cocktailsSum * 0.05),
      };
    });

    response.sort((a, b) => b.revenue - a.revenue);
    res.json({ dateFrom, dateTo, response });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- BARMEN BONUS --------------------
app.get("/api/barmen-bonus", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom } = req.query;

    const ALL_BONUS_CATS = new Set([28, 34, 48, 49, 50]);

    // 1. Waiters sales за день
    const waitersResp = await poster("dash.getWaitersSales", { dateFrom, dateTo });
    const allWaiters = Array.isArray(waitersResp?.response) ? waitersResp.response : [];
    const isBarman = (name) => { const n = String(name || "").toLowerCase(); return n.includes("бар") || n.includes("bar"); };
    const barmen = allWaiters.filter(w => isBarman(w.name));
    const barmenCount = Math.max(barmen.length, 1);

    // 2. Revenue по категоріях
    const catsResp = await poster("dash.getCategoriesSales", { dateFrom, dateTo });
    const catsArr = Array.isArray(catsResp?.response) ? catsResp.response : [];
    const catRevMap = new Map();
    for (const x of catsArr) {
      const cid = Number(x.category_id);
      if (!ALL_BONUS_CATS.has(cid)) continue;
      const raw = Number(x.revenue ?? x.sales_sum ?? x.sum ?? x.payed_sum ?? x.turnover ?? 0);
      catRevMap.set(cid, raw / 100);
    }

    // 3. Upsell по барменах
    const upsellMap = await calcUpsellForPeriod(dateFrom, dateTo);

    const r2 = v => Math.round((v || 0) * 100) / 100;

    // 4. Загальні суми по групах
    const teaCoffeeRev = r2(catRevMap.get(28) || 0);
    const cocktailsRev = r2(catRevMap.get(34) || 0);
    const lemonadesRev = r2([48, 49, 50].reduce((s, id) => s + (catRevMap.get(id) || 0), 0));

    const teaCoffeePer = r2(teaCoffeeRev * 0.07);
    const cocktailsPer = r2(cocktailsRev * 0.15);
    const lemonadesPer = r2(lemonadesRev * 0.10);

    // 5. Рядок на кожного бармена
    const response = barmen.map(w => {
      const uid = String(w.user_id);
      const revenue = r2(Number(w.revenue || 0) / 100);
      const upsell = upsellMap.get(uid);
      const upsellSum = upsell ? r2(upsell.sauces + upsell.kitchen + upsell.bar) : 0;

      const revBonus    = r2(revenue * 0.013);
      const upsellBonus = r2(upsellSum * 0.07);
      const total       = r2(revBonus + upsellBonus + teaCoffeePer + cocktailsPer + lemonadesPer);

      return {
        user_id: uid,
        name: String(w.name || ""),
        revenue,
        revenue_bonus: revBonus,
        upsell_sum: upsellSum,
        upsell_bonus: upsellBonus,
        tea_coffee_share: teaCoffeePer,
        cocktails_share: cocktailsPer,
        lemonades_share: lemonadesPer,
        total,
      };
    });

    res.json({
      dateFrom, dateTo, barmen_count: barmenCount,
      categories: {
        tea_coffee: teaCoffeeRev,
        cocktails: cocktailsRev,
        lemonades: lemonadesRev,
      },
      response,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
});

// -------------------- DEBUG: продажі по категорії --------------------
app.get("/api/debug-cat", async (req, res) => {
  try {
    if (!TOKEN) return res.status(500).json({ error: "POSTER_TOKEN is not set" });
    const { dateFrom = todayYYYYMMDD(), dateTo = dateFrom, cats = "34" } = req.query;
    const catSet = new Set(String(cats).split(",").map(Number));

    const txResp = await poster("dash.getTransactions", { dateFrom, dateTo });
    const transactions = Array.isArray(txResp?.response) ? txResp.response : [];
    const closedTx = transactions.filter(tx => tx.status === "2" && Number(tx.payed_sum) > 0);

    const rows = [];
    const BATCH = 10;
    for (let i = 0; i < closedTx.length; i += BATCH) {
      const batch = closedTx.slice(i, i + BATCH);
      await Promise.all(batch.map(async (tx) => {
        try {
          const prodResp = await poster("dash.getTransactionProducts", { transaction_id: String(tx.transaction_id) });
          const products = Array.isArray(prodResp?.response) ? prodResp.response : [];
          for (const p of products) {
            if (!catSet.has(Number(p.category_id))) continue;
            rows.push({
              tx_id: tx.transaction_id,
              waiter: tx.name,
              date: tx.date_close_date,
              product: p.product_name,
              category_id: p.category_id,
              qty: p.num,
              payed_sum: Number(p.payed_sum || 0) / 100,
            });
          }
        } catch { /* skip */ }
      }));
    }

    rows.sort((a, b) => String(a.waiter).localeCompare(String(b.waiter)));
    res.json({ dateFrom, dateTo, cats: [...catSet], count: rows.length, rows });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API server listening on ${port}`));
