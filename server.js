// -------------------- DEBUG: модификаторы из меню --------------------
app.get("/api/debug-mods", async (req, res) => {
  try {
    await ensureProducts();

    // Показуємо перші 20 модифікаторів з кешу
    const cacheSample = [...MOD_INFO.entries()].slice(0, 20).map(([id, m]) => ({ id, ...m }));

    // Також дивимось сирий відповідь для першого продукту з модифікаторами
    const j = await poster("menu.getProducts");
    const arr = Array.isArray(j?.response) ? j.response : [];
    const withMods = arr.filter(p => Array.isArray(p.group_modifications) && p.group_modifications.length > 0).slice(0, 3);
    const rawSample = withMods.map(p => ({
      pid: p.product_id,
      name: p.product_name,
      group_modifications: p.group_modifications
    }));

    // Також дивимось реальні modId з сьогоднішніх чеків
    const { dateFrom = todayYYYYMMDD() } = req.query;
    const tr = await poster("dash.getTransactions", { dateFrom, dateTo: dateFrom, status: 2, include_products: true });
    const transactions = Array.isArray(tr?.response) ? tr.response : [];
    const modIdsInChecks = new Set();
    for (const t of transactions) {
      for (const p of Array.isArray(t.products) ? t.products : []) {
        const modId = Number(p.modification_id || 0);
        if (modId !== 0) modIdsInChecks.add(modId);
      }
    }

    const modIdsArr = [...modIdsInChecks];
    const resolved = modIdsArr.map(id => ({ id, inCache: MOD_INFO.has(id), info: MOD_INFO.get(id) || null }));

    res.json({ cacheSample, rawSample, modIdsInChecks: resolved });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
