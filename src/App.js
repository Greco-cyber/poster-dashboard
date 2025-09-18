import React, { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

// ====== КОНФІГ ======
const SAUCE_CAT_IDS = [17];         // Соуси
const ADDON_CAT_IDS = [41, 37];     // Допи

// % бонусу
const BONUS = {
  waiter: { sauce: 0.35, addon: 0.35 },
  bartender: { sauce: 0.35, addon: 0.35 },
};

// Ролі (підстав свої ID)
const ROLE_BY_USER = { 18: "bartender", 24: "waiter", 25: "bartender", 35: "waiter" };

// ====== utils ======
function yyyymmdd(d = new Date()) { const p=(n)=>String(n).padStart(2,"0"); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`; }
function dateInputValue(s){return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;}
function firstDayOfMonthStr(s){return `${s.slice(0,4)}${s.slice(4,6)}01`;}
function lastDayOfMonthStr(s){const y=+s.slice(0,4),m=+s.slice(4,6);const d=new Date(y,m,0);const p=(n)=>String(n).padStart(2,"0");return`${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;}
function daysInMonthOfDateStr(s){const y=+s.slice(0,4),m=+s.slice(4,6);return new Date(y,m,0).getDate();}
const money=(n)=>Number(n).toLocaleString("uk-UA",{minimumFractionDigits:2,maximumFractionDigits:2});
const intf=(n)=>Number(n).toLocaleString("uk-UA",{maximumFractionDigits:0});

// сума категорій (включаючи спец-ключ "kw" з бекенда)
function pickCatsSum(map, userId, catIds) {
  const u = map[userId];
  if (!u || !u.categories) return { qty: 0, sum: 0 };
  let qty = 0, sum = 0;
  for (const cid of catIds) {
    const slot = u.categories[String(cid)];
    if (slot) { qty += Number(slot.qty||0); sum += Number(slot.sum_uah||0); }
  }
  const kw = u.categories["kw"];
  if (kw) { qty += Number(kw.qty||0); sum += Number(kw.sum_uah||0); }
  return { qty, sum };
}

// сума з "overall" (звіти по категоріях без розрізу співробітників)
function sumOverall(overall = []) {
  let qty = 0, sum = 0;
  for (const r of overall) { qty += Number(r.count || 0); sum += Number(r.sum_uah || 0); }
  return { qty, sum };
}

export default function App(){
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  const [daySales,setDaySales]=useState([]);            // по офіціантах (день)
  const [avgPerMonthMap,setAvgPerMonthMap]=useState({});

  // по співробітниках (як було; може бути 0, якщо Poster не віддає позиції)
  const [saucesDay,setSaucesDay]=useState({});
  const [addonsDay,setAddonsDay]=useState({});
  const [saucesMonthByUser,setSaucesMonthByUser]=useState({}); // тримаємо для сумісності

  // НОВЕ: агрегати з dash.getCategoriesSales (overall)
  const [overallSaucesDay,setOverallSaucesDay]=useState({qty:0,sum:0});
  const [overallAddonsDay,setOverallAddonsDay]=useState({qty:0,sum:0});
  const [overallSaucesMonth,setOverallSaucesMonth]=useState({qty:0,sum:0});

  const today=useMemo(()=>yyyymmdd(),[]);
  const [date,setDate]=useState(today);

  async function load(){
    setLoading(true); setError("");
    try{
      const base=API_BASE||"";
      const mFrom=firstDayOfMonthStr(date);
      const mTo=lastDayOfMonthStr(date);

      // базові звіти по офіціантах
      const dayUrl   = `${base}/api/waiters-sales?dateFrom=${date}&dateTo=${date}`;
      const monthUrl = `${base}/api/waiters-sales?dateFrom=${mFrom}&dateTo=${mTo}`;

      // категорії (ендпоінт із бекенда; повертає per-user + overall)
      const enc = encodeURIComponent;
      const sauceDayUrl   = `${base}/api/waiters-categories?cats=${SAUCE_CAT_IDS.join(",")}&dateFrom=${date}&dateTo=${date}`;
      const addonDayUrl   = `${base}/api/waiters-categories?cats=${ADDON_CAT_IDS.join(",")}&dateFrom=${date}&dateTo=${date}`;
      const sauceMonthUrl = `${base}/api/waiters-categories?cats=${SAUCE_CAT_IDS.join(",")}&dateFrom=${mFrom}&dateTo=${mTo}`;

      const [rDay,rMonth,rSauD,rAddD,rSauM]=await Promise.all([
        fetch(dayUrl), fetch(monthUrl), fetch(sauceDayUrl), fetch(addonDayUrl), fetch(sauceMonthUrl)
      ]);

      const [tDay,tMonth,tSauD,tAddD,tSauM]=await Promise.all([
        rDay.text(), rMonth.text(), rSauD.text(), rAddD.text(), rSauM.text()
      ]);

      if(!rDay.ok)   throw new Error(`HTTP ${rDay.status}: ${tDay.slice(0,150)}`);
      if(!rMonth.ok) throw new Error(`HTTP ${rMonth.status}: ${tMonth.slice(0,150)}`);
      if(!rSauD.ok)  throw new Error(`HTTP ${rSauD.status}: ${tSauD.slice(0,150)}`);
      if(!rAddD.ok)  throw new Error(`HTTP ${rAddD.status}: ${tAddD.slice(0,150)}`);
      if(!rSauM.ok)  throw new Error(`HTTP ${rSauM.status}: ${tSauM.slice(0,150)}`);

      const dDay  = JSON.parse(tDay||"{}");
      const dMon  = JSON.parse(tMonth||"{}");
      const dSauD = JSON.parse(tSauD||"{}");
      const dAddD = JSON.parse(tAddD||"{}");
      const dSauM = JSON.parse(tSauM||"{}");

      const dayList   = Array.isArray(dDay?.response)? dDay.response : [];
      const monthList = Array.isArray(dMon?.response)? dMon.response : [];

      // карти середнього чека по місяцю
      const avgMap={};
      for(const w of monthList){
        const revenueUAH=Number(w.revenue||0)/100;
        const checks=Number(w.clients||0);
        avgMap[w.user_id]=checks>0?revenueUAH/checks:0;
      }

      // перетворювач response->map для per-user
      const toMap=(obj)=>{const m={}; for(const row of obj?.response||[]) m[row.user_id]=row; return m;};

      setDaySales(dayList);
      setAvgPerMonthMap(avgMap);
      setSaucesDay(toMap(dSauD));
      setAddonsDay(toMap(dAddD));
      setSaucesMonthByUser(toMap(dSauM));

      // **НОВЕ**: читаємо поле overall (агрегати з dash.getCategoriesSales)
      setOverallSaucesDay(sumOverall(dSauD?.overall));
      setOverallAddonsDay(sumOverall(dAddD?.overall));
      setOverallSaucesMonth(sumOverall(dSauM?.overall));
    }catch(e){
      console.error(e);
      setError("Не вдалося завантажити дані. Перевір адресу API, токен або дату.");
    }finally{ setLoading(false); }
  }

  useEffect(()=>{ load(); },[date]);
  useEffect(()=>{ const id=setInterval(load,5*60*1000); return ()=>clearInterval(id); },[date]);

  function TrendArrow({dayAvg,monthAvg}){
    if(monthAvg==null) return null;
    const d=dayAvg-monthAvg, eps=0.5;
    if(d>eps)  return <span className="ml-2 text-green-400 align-middle">▲</span>;
    if(d<-eps) return <span className="ml-2 text-red-400 align-middle">▼</span>;
    return null;
  }

  const daysInMonth = daysInMonthOfDateStr(date);

  // активні співробітники в місяці (є чеки)
  const activeWaitersInMonth = useMemo(()=>{
    let n=0; for(const k in avgPerMonthMap){ if(Number.isFinite(avgPerMonthMap[k])) n++; }
    return Math.max(n, 1);
  },[avgPerMonthMap]);

  // стандарт соусів/день на співробітника = (усі соуси місяця / днів / активних)
  const sauceStdPerDayPerEmployee = useMemo(()=>{
    if (daysInMonth<=0) return 0;
    return (overallSaucesMonth.qty || 0) / daysInMonth / activeWaitersInMonth;
  },[overallSaucesMonth, daysInMonth, activeWaitersInMonth]);

  // лідерборди (залишаємо як було)
  const leaderboards = useMemo(()=>{
    const arr = daySales.map((w)=>{
      const uid=w.user_id;
      const checks=Number(w.clients||0);
      const revenueUAH=Number(w.revenue||0)/100;
      const avgDay=checks>0?revenueUAH/checks:0;
      const avgMonth=avgPerMonthMap[uid]??0;

      const sauce=pickCatsSum({[uid]:saucesDay[uid]},uid,SAUCE_CAT_IDS);
      const addon=pickCatsSum({[uid]:addonsDay[uid]},uid,ADDON_CAT_IDS);

      const per20=(qty)=>checks>0?(qty/checks)*20:0;

      return{
        uid,
        name:w.name||"—",
        role:ROLE_BY_USER[uid]||"waiter",
        saucesPer20:per20(sauce.qty),
        addonsPer20:per20(addon.qty),
        avgDelta:avgDay-(avgMonth||0),
      };
    });
    const topSauces=[...arr].sort((a,b)=>b.saucesPer20-a.saucesPer20).slice(0,3);
    const topAddons=[...arr].sort((a,b)=>b.addonsPer20-a.addonsPer20).slice(0,3);
    const topAvgDelta=[...arr].sort((a,b)=>b.avgDelta-a.avgDelta).slice(0,3);
    return { topSauces, topAddons, topAvgDelta };
  },[daySales,saucesDay,addonsDay,avgPerMonthMap]);

  return (
    <div className="min-h-screen bg-black text-white relative">
      <div className="max-w-6xl mx-auto p-4 pb-20">
        {/* ====== Хедер ====== */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <h1 className="text-2xl font-semibold">Зміна: продажі офіціантів (за день)</h1>
          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-400">Дата:</label>
            <input type="date" className="bg-neutral-900 border border-neutral-700 rounded px-3 py-2"
                   value={dateInputValue(date)} onChange={(e)=>setDate(e.target.value.replaceAll("-",""))}/>
            <button onClick={load} className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-sm"
                    title="Оновити (автооновлення кожні 5 хв)">Оновити</button>
          </div>
        </header>

        {/* ====== Підсумок по категоріях (ДЕНЬ) з dash.getCategoriesSales ====== */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-3 mb-4 text-sm">
          <div className="flex flex-wrap gap-4">
            <div><span className="text-neutral-400">Соуси (разом за день):</span> {intf(overallSaucesDay.qty)} шт / {money(overallSaucesDay.sum)} ₴</div>
            <div><span className="text-neutral-400">Допи (разом за день):</span> {intf(overallAddonsDay.qty)} шт / {money(overallAddonsDay.sum)} ₴</div>
            <div className="text-neutral-400">Активних співробітників у місяці: {intf(activeWaitersInMonth)}</div>
          </div>
        </div>

        {/* ====== Лідерборди ====== */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Лідерборди (онлайн)</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Соуси на 20 чеків */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="text-sm text-neutral-400 mb-2">Соуси на 20 чеків</div>
              <ol className="space-y-2">
                {leaderboards.topSauces.map((p,idx)=>(
                  <li key={p.uid} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-500 w-5">{idx+1}.</span>
                      <span className="font-medium">{p.name}</span>
                      <span className="px-2 py-0.5 text-xs rounded-full bg-neutral-800 border border-neutral-700">
                        {(ROLE_BY_USER[p.uid]||"waiter")==="bartender"?"бармен":"офіціант"}
                      </span>
                    </div>
                    <div className="font-semibold">{Number(p.saucesPer20).toFixed(2)}</div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Допи на 20 чеків */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="text-sm text-neutral-400 mb-2">Допи на 20 чеків</div>
              <ol className="space-y-2">
                {leaderboards.topAddons.map((p,idx)=>(
                  <li key={p.uid} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-500 w-5">{idx+1}.</span>
                      <span className="font-medium">{p.name}</span>
                      <span className="px-2 py-0.5 text-xs rounded-full bg-neutral-800 border border-neutral-700">
                        {(ROLE_BY_USER[p.uid]||"waiter")==="bartender"?"бармен":"офіціант"}
                      </span>
                    </div>
                    <div className="font-semibold">{Number(p.addonsPer20).toFixed(2)}</div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Δ Середній чек (день – міс) */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="text-sm text-neutral-400 mb-2">Δ Середній чек (день – міс)</div>
              <ol className="space-y-2">
                {leaderboards.topAvgDelta.map((p,idx)=>{
                  const val=Number(p.avgDelta)||0;
                  const cls=val>=0?"text-green-400":"text-red-400";
                  const sign=val>=0?"+":"–";
                  return(
                    <li key={p.uid} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-neutral-500 w-5">{idx+1}.</span>
                        <span className="font-medium">{p.name}</span>
                        <span className="px-2 py-0.5 text-xs rounded-full bg-neutral-800 border border-neutral-700">
                          {(ROLE_BY_USER[p.uid]||"waiter")==="bartender"?"бармен":"офіціант"}
                        </span>
                      </div>
                      <div className={`font-semibold ${cls}`}>{sign}{money(Math.abs(val))} ₴</div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>

        {/* ====== Картки ====== */}
        {loading && <div className="animate-pulse text-neutral-300">Завантаження…</div>}
        {error && <div className="text-red-400">{error}</div>}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {daySales.map((w)=>{
              const uid=w.user_id;
              const role=ROLE_BY_USER[uid]||"waiter";
              const revenueUAH=Number(w.revenue||0)/100;
              const checks=Number(w.clients||0);
              const avgDay=checks>0?revenueUAH/checks:0;
              const avgMonth=avgPerMonthMap[uid];

              const sDay=saucesDay[uid]||{};
              const aDay=addonsDay[uid]||{};
              const sauce=pickCatsSum({[uid]:sDay},uid,SAUCE_CAT_IDS);
              const addon=pickCatsSum({[uid]:aDay},uid,ADDON_CAT_IDS);

              const kSau=BONUS[role]?.sauce??0;
              const kAdd=BONUS[role]?.addon??0;
              const bonusSau=sauce.sum*kSau, bonusAdd=addon.sum*kAdd, bonusTotal=bonusSau+bonusAdd;

              return(
                <div key={uid} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-lg font-medium">{w.name||"—"}</div>
                    <div className="text-xs text-neutral-500">ID {uid} · {role==="bartender"?"бармен":"офіціант"}</div>
                  </div>

                  <div className="space-y-1 text-sm">
                    <div>Виручка за день: {money(revenueUAH)} ₴</div>
                    <div>Кількість чеків за день: {intf(checks)}</div>
                    <div className="flex items-center">
                      <span>Середній чек за день: {money(avgDay)} ₴</span>
                      <TrendArrow dayAvg={avgDay} monthAvg={avgMonth}/>
                    </div>
                    <div>Середній чек/міс: {avgMonth!=null?`${money(avgMonth)} ₴`:"—"}</div>

                    <div className="pt-2">
                      <div><span className="font-medium">Соуси</span> — {intf(sauce.qty)} шт / {money(sauce.sum)} ₴</div>
                      <div className="text-neutral-400 text-xs">
                        Стандарт соусів/день (міс): {sauceStdPerDayPerEmployee.toFixed(2)} шт
                      </div>
                      <div><span className="font-medium">Допи</span> — {intf(addon.qty)} шт / {money(addon.sum)} ₴</div>
                    </div>

                    <div className="pt-2 border-t border-neutral-800 mt-2">
                      <div className="font-medium">Бонуси (день): {money(bonusTotal)} ₴</div>
                      <div className="text-neutral-400 text-xs">з них: соуси {money(bonusSau)} ₴ · допи {money(bonusAdd)} ₴</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {daySales.length===0 && (<div className="text-neutral-400">Немає даних за обрану дату.</div>)}
          </div>
        )}
      </div>

      {/* Лого (не перекладаємо) */}
      <div className="fixed right-3 bottom-3 text-xs text-neutral-500/80 select-none">GRECO Tech ™</div>
    </div>
  );
}
