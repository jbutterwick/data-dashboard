// ---- pure helpers (checked by test.js) ----
function fmtUSD(v){ return '$' + Math.round(v).toLocaleString('en-US'); }
function fmtPct(v){ return v.toFixed(1) + '%'; }
function fmtNum(v){
  return Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B'
       : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M'
       : Math.round(v).toLocaleString('en-US');
}
function ord(x){ return x + ([, 'st', 'nd', 'rd'][x % 100 >> 3 ^ 1 && x % 10] || 'th'); }
// ponytail: saved order first, newly added metric ids appended at the end
function mergeOrder(saved, ids){
  return [...saved.filter(id => ids.includes(id)), ...ids.filter(id => !saved.includes(id))];
}
// source resolution order: user's pick first, then declared order (national → harmonized → aggregator)
function srcOrder(list, pick){
  const p = list.find(s => s.label === pick);
  return p ? [p, ...list.filter(s => s !== p)] : list;
}
// history chart: primary area line over compare line, shared scales, 1990 on
function chartSVG(hist, cmp){
  const a = (hist || []).filter(p => p[0] >= 1990 && p[1] != null);
  const b = (cmp || []).filter(p => p[0] >= 1990 && p[1] != null);
  if (a.length < 2) return '';
  const all = a.concat(b);
  const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
  let y0 = Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
  const pad = (y1 - y0) * .08 || 1; y0 -= pad; y1 += pad;
  const W = 272, H = 72, T = 4, B = 14;
  const X = y => 2 + (y - x0) / (x1 - x0 || 1) * (W - 4);
  const Y = v => T + (y1 - v) / (y1 - y0) * (H - T - B);
  const pts = s => s.map(p => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ');
  const last = a[a.length - 1];
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`;
  for (const f of [.25, .5, .75]){
    const gy = (T + f * (H - T - B)).toFixed(1);
    svg += `<line x1="2" x2="${W - 2}" y1="${gy}" y2="${gy}" stroke="var(--line)" stroke-width="1" stroke-dasharray="1 3"/>`;
  }
  if (b.length > 1) svg += `<polyline points="${pts(b)}" fill="none" stroke="var(--cmp)" stroke-width="1.2"/>`;
  svg += `<polygon points="${X(a[0][0]).toFixed(1)},${Y(y0)} ${pts(a)} ${X(last[0]).toFixed(1)},${Y(y0)}" fill="var(--unit)" fill-opacity=".1"/>`;
  svg += `<polyline points="${pts(a)}" fill="none" stroke="var(--unit)" stroke-width="1.6"/>`;
  svg += `<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="2.4" fill="var(--unit)"/>`;
  svg += `<text x="2" y="${H - 3}" fill="var(--faint)" font-size="8" font-family="inherit">${a[0][0]}</text>`;
  svg += `<text x="${W - 2}" y="${H - 3}" fill="var(--faint)" font-size="8" text-anchor="end" font-family="inherit">${last[0]}</text>`;
  return svg + '</svg>';
}

// thin-line country outline from data/outlines.json ({w, h, r:[flat x,y ints]})
function outlineSVG(o, size, cls){
  if (!o || !o.r) return '';
  let H = size || 120, W = Math.round(H * o.w / o.h);
  const maxW = (size || 120) * 8 / 3;
  if (W > maxW){ W = Math.round(maxW); H = Math.round(W * o.h / o.w); }
  const d = o.r.map(r => {
    let s = 'M' + r[0] + ' ' + r[1];
    for (let i = 2; i < r.length; i += 2) s += 'L' + r[i] + ' ' + r[i + 1];
    return s + 'Z';
  }).join('');
  return `<svg viewBox="0 0 ${o.w} ${o.h}" width="${W}" height="${H}" role="img"${cls ? ` class="${cls}"` : ''}><path d="${d}"/></svg>`;
}

// 24h TTL cache over localStorage so the homepage paints instantly on repeat loads
// ponytail: TTL only, no background revalidate — the pipeline is weekly anyway
function cached(key, fetcher, store){
  store = store || localStorage;
  let hit = null;
  try { hit = JSON.parse(store.getItem('c:' + key)); } catch {}
  if (hit && Date.now() - hit.t < 864e5) return Promise.resolve(hit.v);
  return fetcher().then(v => {
    try { store.setItem('c:' + key, JSON.stringify({ t: Date.now(), v })); } catch {} // quota — just skip
    return v;
  });
}

// rank movement vs the previous pipeline run: rank number falling = improvement = ↑
function rankDelta(prev, cur){
  if (prev == null || cur == null || prev === cur) return '';
  const d = prev - cur;
  return ` <span class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '↑' : '↓'}${Math.abs(d)}</span>`;
}

// rank: key into derived.json ranks; note: how to read it ("fewest jobless first")
var METRICS = [
  {id:'gdppc',  cat:'Economy', name:'GDP per person, PPP',     ind:'NY.GDP.PCAP.PP.CD', fmt:fmtUSD, rank:'gdppc', note:'richest first'},
  {id:'growth', cat:'Economy', name:'GDP growth',              ind:'NY.GDP.MKTP.KD.ZG', fmt:fmtPct},
  {id:'infl',   cat:'Economy', name:'Inflation (CPI)',         ind:'FP.CPI.TOTL.ZG',    fmt:fmtPct, natl:'infl', euro:'prc_hicp_aind?unit=RCH_A_AVG&coicop=CP00'},
  {id:'gini',   cat:'Economy', name:'Gini inequality index',   ind:'SI.POV.GINI',       fmt:fmtNum, euro:'ilc_di12?age=TOTAL&statinfo=GINI_HND'},
  {id:'pov',    cat:'Economy', name:'Poverty rate (<$6.85/day)', ind:'SI.POV.UMIC',     fmt:fmtPct},
  {id:'pli',    cat:'Economy', name:'Cost of living (US=100)', ind:'PA.NUS.PRVT.PLI',   fmt:v => String(Math.round(v)), rank:'pli', note:'cheapest first'},
  {id:'medinc', cat:'Economy', name:'Median disposable income', file:'oecd.json', key:'medinc', src:'OECD', fmt:(v, d) => fmtNum(v) + ' ' + (d.unit || ''), euro:{q:'ilc_di03?age=TOTAL&sex=T&statinfo=MED_EI&unit=EUR', unit:'EUR'}},
  {id:'house',  cat:'Economy', name:'Home price vs income (avg=100)', file:'oecd.json', key:'house', src:'OECD', fmt:v => String(Math.round(v)), rank:'house', note:'most affordable first'},
  {id:'medhome', cat:'Economy', name:'Median home price', fred:'medhome', fmt:fmtUSD},
  {id:'bigmac', cat:'Economy', name:'Big Mac price', file:'bigmac.json', key:'bigmac', src:'The Economist', fmt:v => '$' + v.toFixed(2)},
  {id:'pubinv', cat:'Economy', name:'Public investment', file:'imf.json', key:'pubinv', src:'IMF', euro:'gov_10a_main?na_item=P51G&sector=S13&unit=PC_GDP', fmt:v => v.toFixed(1) + '% GDP', rank:'pubinv', note:'most invested first'},
  {id:'unemp',  cat:'Work',    name:'Unemployment',            ind:'SL.UEM.TOTL.ZS',    fmt:fmtPct, natl:'unemp', fred:'unemp', euro:'une_rt_a?sex=T&age=Y15-74&unit=PC_ACT', rank:'unemp', note:'fewest jobless first'},
  {id:'lfpr',   cat:'Work',    name:'Workforce participation', ind:'SL.TLF.CACT.ZS',    fmt:fmtPct, natl:'lfpr', fred:'lfpr', rank:'lfpr', note:'highest share first'},
  {id:'vuln',   cat:'Work',    name:'Vulnerable employment',   ind:'SL.EMP.VULN.ZS',    fmt:fmtPct},
  {id:'neet',   cat:'Work',    name:'Youth not in work/school', ind:'SL.UEM.NEET.ZS',   fmt:fmtPct, file:'ilo.json', key:'neet', src:'ILOSTAT', pref:'ILOSTAT', rank:'neet', note:'fewest left out first'},
  {id:'informal', cat:'Work',  name:'Informal employment', file:'ilo.json', key:'informal', src:'ILOSTAT', fmt:fmtPct, rank:'informal', note:'most formal jobs first'},
  {id:'jvr',    cat:'Work',    name:'Job vacancy rate', file:'eurostat.json', key:'jvr', src:'Eurostat', fmt:fmtPct, rank:'jvr', note:'most openings first'},
  {id:'retire', cat:'Work',    name:'Effective retirement age', file:'oecd.json', key:'retire', src:'OECD', fmt:v => v.toFixed(1) + ' yrs'},
  {id:'hours',  cat:'Work',    name:'Annual hours worked', file:'owid.json', key:'hours', src:'PWT via OWID', fmt:v => Math.round(v).toLocaleString('en-US') + ' hrs', rank:'hours', note:'fewest hours first'},
  {id:'days',   cat:'Work',    name:'Days worked per year (derived)', file:'derived.json', key:'daysworked', src:'OWID hours ÷ ILO weekly hours', fmt:v => Math.round(v) + ' days', rank:'days', note:'fewest days first'},
  {id:'cba',    cat:'Work',    name:'Collective bargaining coverage', file:'ilo.json', key:'bargain', src:'ILOSTAT', fmt:fmtPct, rank:'cba', note:'most covered first'},
  {id:'life',   cat:'Health',  name:'Life expectancy',         ind:'SP.DYN.LE00.IN',    fmt:v => v.toFixed(1) + ' yrs', euro:'demo_mlexpec?sex=T&age=Y_LT1&unit=YR'},
  {id:'hexp',   cat:'Health',  name:'Health spend per capita', ind:'SH.XPD.CHEX.PC.CD', fmt:fmtUSD},
  {id:'oop',    cat:'Health',  name:'Out-of-pocket health costs', ind:'SH.XPD.OOPC.CH.ZS', fmt:fmtPct, rank:'oop', note:'lowest share first'},
  {id:'hale',   cat:'Health',  name:'Healthy life expectancy', file:'who.json', key:'hale', src:'WHO', fmt:v => v.toFixed(1) + ' yrs', rank:'hale', note:'longest first'},
  {id:'suic',   cat:'Health',  name:'Suicide rate', file:'who.json', key:'suicide', src:'WHO', fmt:v => v.toFixed(1) + ' /100k', rank:'suicide', note:'fewest first'},
  {id:'school', cat:'Society', name:'Expected years in school', ind:'SE.SCH.LIFE',      fmt:v => v.toFixed(1) + ' yrs', rank:'school', note:'longest first'},
  {id:'homi',   cat:'Society', name:'Homicide rate',           ind:'VC.IHR.PSRC.P5',    fmt:v => v.toFixed(1) + ' /100k'},
  {id:'net',    cat:'Society', name:'Internet users',          ind:'IT.NET.USER.ZS',    fmt:fmtPct},
  {id:'happy',  cat:'Society', name:'Life satisfaction', file:'owid.json', key:'satisfaction', src:'World Happiness Report via OWID', fmt:v => v.toFixed(1) + ' /10', rank:'happy', note:'happiest first'},
  {id:'leisure', cat:'Society', name:'Leisure time per day', file:'oecd.json', key:'leisure', src:'OECD Time Use', fmt:v => Math.floor(v / 60) + 'h ' + Math.round(v % 60) + 'm', rank:'leisure', note:'most free time first'},
  {id:'timeuse', cat:'Society', name:'How the day is spent', file:'oecd.json', key:'timeuse', src:'OECD Time Use', bar:true, colors:'tu'},
  {id:'third',  cat:'Society', name:'Third spaces per 100k', file:'osm.json', key:'third', src:'OpenStreetMap', fmt:v => fmtNum(v)},
  {id:'cereal', cat:'Food',    name:'Cereal import dependency', file:'fao.json', key:'cereal', src:'FAO', fmt:v => (v > 0 ? '+' : '') + v.toFixed(1) + '%', rank:'cereal', note:'most self-sufficient first'},
  {id:'foodimp', cat:'Food',   name:'Food imports vs all exports', file:'fao.json', key:'foodimp', src:'FAO', fmt:fmtPct, rank:'foodimp', note:'lightest food bill first'},
  {id:'trade',  cat:'Trade',   name:'Trade dependence', ind:'NE.TRD.GNFS.ZS', fmt:v => Math.round(v) + '% GDP', rank:'trade', note:'least trade-dependent first'},
  {id:'energyimp', cat:'Trade', name:'Net energy imports', ind:'EG.IMP.CONS.ZS', fmt:v => (v > 0 ? '+' : '') + Math.round(v) + '%', rank:'energyimp', note:'most energy self-sufficient first'},
  {id:'cab',    cat:'Trade',   name:'Current account balance', file:'imf.json', key:'cab', src:'IMF WEO', fmt:v => (v > 0 ? '+' : '') + v.toFixed(1) + '% GDP'},
  {id:'expconc', cat:'Trade',  name:'Export concentration', file:'unctad.json', key:'expconc', src:'UNCTAD', fmt:v => v.toFixed(3), rank:'expconc', note:'most diversified first'},
  {id:'press',  cat:'Freedom', name:'Press freedom', file:'rsf.json', key:'press', src:'Reporters Without Borders', fmt:v => v.toFixed(1) + ' /100', rank:'press', note:'freest first'},
  {id:'cpi',    cat:'Freedom', name:'Corruption perceptions', file:'owid.json', key:'cpi', src:'Transparency Intl via OWID', fmt:v => Math.round(v) + ' /100', rank:'cpi', note:'cleanest first'},
  {id:'vdem',   cat:'Freedom', name:'Liberal democracy index', file:'owid.json', key:'democracy', src:'V-Dem via OWID', fmt:v => v.toFixed(2) + ' /1', rank:'vdem', note:'freest first'},
  {id:'confdeaths', cat:'Peace', name:'Conflict deaths', file:'owid.json', key:'confdeaths', src:'UCDP via OWID', fmt:v => (v < 1 && v > 0 ? v.toFixed(2) : v.toFixed(1)) + ' /100k', rank:'confdeaths', note:'fewest first'},
  {id:'polstab', cat:'Peace', name:'Political stability', ind:'GOV_WGI_PV.SC', fmt:v => Math.round(v) + ' /100', rank:'polstab', note:'most stable first'},
  {id:'milex',  cat:'Peace',   name:'Military spending', ind:'MS.MIL.XPND.GD.ZS', fmt:v => v.toFixed(1) + '% GDP'},
  {id:'pop',    cat:'People',  name:'Population',              ind:'SP.POP.TOTL',       fmt:fmtNum},
  {id:'popg',   cat:'People',  name:'Population growth',       ind:'SP.POP.GROW',       fmt:fmtPct},
  {id:'mig',    cat:'People',  name:'Net migration',           ind:'SM.POP.NETM',       fmt:fmtNum},
  {id:'urban',  cat:'People',  name:'Urban population',        ind:'SP.URB.TOTL.IN.ZS', fmt:fmtPct},
  {id:'co2',    cat:'Climate & Energy', name:'CO₂ per capita',           ind:'EN.GHG.CO2.PC.CE.AR5', fmt:v => v.toFixed(1) + ' t', alt:[{src:'Our World in Data', file:'co2.json', key:'co2pc'}], rank:'co2', note:'cleanest first'},
  {id:'renew',  cat:'Climate & Energy', name:'Renewable energy share',   ind:'EG.FEC.RNEW.ZS',       fmt:fmtPct},
  {id:'forest', cat:'Climate & Energy', name:'Forest area',              ind:'AG.LND.FRST.ZS',       fmt:fmtPct},
  {id:'pm25',   cat:'Climate & Energy', name:'Air pollution (PM2.5)',    ind:'EN.ATM.PM25.MC.M3',    fmt:v => v.toFixed(1) + ' µg/m³'},
  {id:'co2t',   cat:'Climate & Energy', name:'CO₂ total', file:'co2.json', key:'co2', src:'Our World in Data', fmt:v => v >= 1000 ? (v / 1000).toFixed(2) + ' Gt' : Math.round(v) + ' Mt'},
  {id:'ghg',    cat:'Climate & Energy', name:'Greenhouse gas per capita', file:'co2.json', key:'ghgpc', src:'Jones et al. via OWID', fmt:v => v.toFixed(1) + ' t CO₂e', rank:'ghgpc', note:'cleanest first'},
  {id:'cumco2', cat:'Climate & Energy', name:'Cumulative CO₂ since 1750', file:'co2.json', key:'cumco2', src:'Global Carbon Project via OWID', fmt:v => v >= 1000 ? (v / 1000).toFixed(1) + ' Gt' : Math.round(v) + ' Mt', rank:'cumco2', note:'least emitted first'},
  {id:'renewelec', cat:'Climate & Energy', name:'Renewable electricity share', file:'energy.json', key:'renewelec', src:'Ember/EI via OWID', fmt:fmtPct, rank:'renewelec', note:'greenest grid first'},
  {id:'energypc', cat:'Climate & Energy', name:'Energy use per person', file:'energy.json', key:'energypc', src:'Energy Institute via OWID', fmt:v => fmtNum(v) + ' kWh'},
  {id:'warm',   cat:'Climate & Energy', name:'Temperature anomaly', file:'warming.json', key:'warming', src:'Berkeley Earth via OWID', fmt:v => (v > 0 ? '+' : '') + v.toFixed(2) + ' °C', rank:'warm', note:'least warmed first'},
  {id:'mix',    cat:'Climate & Energy', name:'Energy mix', file:'energy.json', key:'mix', src:'Our World in Data', bar:true},
];

var MIX_COLORS = { coal:'var(--surface0)', oil:'var(--surface2)', gas:'var(--cmp)',
  nuclear:'var(--accent)', hydro:'var(--blue)', wind:'var(--sapphire)', solar:'var(--yellow)',
  biofuel:'var(--green)', other:'var(--teal)' };
var TU_COLORS = { 'paid work':'var(--surface2)', 'unpaid work':'var(--cmp)',
  'personal care':'var(--blue)', leisure:'var(--green)', other:'var(--surface0)' };

var THEMES = ['mocha', 'macchiato', 'frappe', 'latte'];

if (typeof document !== 'undefined') (function(){
  const $ = id => document.getElementById(id);
  const S = Object.assign(
    {country:'USA', compare:'', theme:'mocha', accent:'', enabled:METRICS.map(m => m.id), order:[], size:{}, folders:{}, srcPick:{}},
    JSON.parse(localStorage.getItem('dash') || '{}'));
  if (!THEMES.includes(S.theme)) S.theme = 'mocha'; // pre-catppuccin saved themes
  S.order = mergeOrder(S.order, METRICS.map(m => m.id));
  // metrics added since the user's last visit start enabled; S.known remembers what they've seen
  // ponytail: pre-existing saves have no known list — everything unknown enables once, then tracking begins
  for (const id of METRICS.map(m => m.id)) if (!(S.known || []).includes(id) && !S.enabled.includes(id)) S.enabled.push(id);
  S.known = METRICS.map(m => m.id);
  const save = () => localStorage.setItem('dash', JSON.stringify(S));
  const cache = new Map(); // per-pageload promise cache over the localStorage TTL layer
  let countryNames = {}; // ISO3 -> display name, filled by loadCountries

  function applyTheme(){
    document.documentElement.dataset.theme = S.theme;
    if (S.accent) document.documentElement.style.setProperty('--accent', S.accent);
    else document.documentElement.style.removeProperty('--accent');
  }
  applyTheme();

  function wb(ind, country){
    const key = country + ind;
    if (!cache.has(key)) cache.set(key, cached(key, () =>
      fetch(`https://api.worldbank.org/v2/country/${country}/indicator/${ind}?format=json&per_page=100`)
        .then(r => r.json())
        .then(j => {
          const rows = (j[1] || []).filter(d => d.value != null); // newest first
          if (!rows.length) return null;
          return { value: rows[0].value, year: rows[0].date,
                   hist: rows.map(d => [+d.date, d.value]).sort((a, b) => a[0] - b[0]) };
        })
        .catch(() => null)));
    return cache.get(key);
  }

  // data/*.json produced by pipeline/fetch.js; shape {key: {ISO3: {value, year}}}
  function localData(file){
    if (!cache.has(file)) cache.set(file,
      fetch('data/' + file).then(r => r.ok ? r.json() : null).catch(() => null));
    return cache.get(file);
  }
  const fileGet = (file, key, c) => localData(file).then(j => (j && j[key] && j[key][c]) || null);

  // Eurostat statistics API (JSON-stat, CORS-enabled); geo codes differ from ISO3
  const EURO_GEO = {AUT:'AT',BEL:'BE',BGR:'BG',HRV:'HR',CYP:'CY',CZE:'CZ',DNK:'DK',EST:'EE',
    FIN:'FI',FRA:'FR',DEU:'DE',GRC:'EL',HUN:'HU',IRL:'IE',ITA:'IT',LVA:'LV',LTU:'LT',LUX:'LU',
    MLT:'MT',NLD:'NL',POL:'PL',PRT:'PT',ROU:'RO',SVK:'SK',SVN:'SI',ESP:'ES',SWE:'SE',
    ISL:'IS',NOR:'NO',CHE:'CH',TUR:'TR'};
  function euroGet(q, iso3){
    const geo = EURO_GEO[iso3];
    if (!geo) return Promise.resolve(null);
    const key = 'eu:' + q + geo;
    if (!cache.has(key)) cache.set(key, cached(key, () =>
      fetch(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${q}&geo=${geo}&format=JSON&lang=EN&sinceTimePeriod=2015`)
        .then(r => r.json())
        .then(j => {
          const idx = j.dimension.time.category.index;
          for (const y of Object.keys(idx).sort().reverse()){
            const v = j.value[idx[y]];
            if (v != null) return { value: v, year: y };
          }
          return null;
        })
        .catch(() => null)));
    return cache.get(key);
  }

  // per-metric source list, most first-hand first; the chip button and S.srcPick pick within it
  for (const m of METRICS){
    m.srcs = [];
    if (m.natl) m.srcs.push({ label:'National', get: c => fileGet('national.json', m.natl, c) }); // entries carry their own src label
    if (m.fred) m.srcs.push({ label:'FRED', get: c => fileGet('fred.json', m.fred, c) });
    if (m.euro){
      const eu = typeof m.euro === 'string' ? { q: m.euro } : m.euro;
      m.srcs.push({ label:'Eurostat', get: c => euroGet(eu.q, c).then(d => d && eu.unit ? Object.assign({ unit: eu.unit }, d) : d) });
    }
    if (m.ind) m.srcs.push({ label:'World Bank', get: c => wb(m.ind, c) });
    if (m.file) m.srcs.push({ label:m.src, get: c => fileGet(m.file, m.key, c) });
    for (const a of m.alt || []) m.srcs.push({ label:a.src, get: c => fileGet(a.file, a.key, c) });
    if (m.pref) m.srcs = srcOrder(m.srcs, m.pref); // default to the first-hand collector, others stay switchable
  }

  async function resolve(m, country){
    for (const s of srcOrder(m.srcs, S.srcPick[m.id])){
      const d = await s.get(country);
      if (d && d.value != null) return { d, s };
    }
    return null;
  }

  // ten-cell gauge: outlined track, filled cells = this country's percentile, partial on the boundary
  function tenStrip(fill){
    const d = document.createElement('div');
    d.className = 'ten';
    for (let i = 0; i < 10; i++){
      const c = document.createElement('i');
      const f = Math.max(0, Math.min(1, fill - i));
      if (f >= .95) c.className = 'on';
      else if (f > .05) c.style.background = `linear-gradient(90deg, var(--unit) ${(f * 100).toFixed(0)}%, var(--surface1) 0)`;
      d.appendChild(c);
    }
    return d;
  }

  function energyBar(shares, colors){
    colors = colors || MIX_COLORS;
    const wrap = document.createElement('div');
    const bar = document.createElement('div');
    bar.className = 'bar';
    const leg = document.createElement('div');
    leg.className = 'mixlegend';
    for (const [k, color] of Object.entries(colors)){
      if (!shares[k]) continue;
      const seg = document.createElement('div');
      seg.style.cssText = `width:${shares[k]}%;background:${color}`;
      seg.title = `${k} ${shares[k].toFixed(1)}%`;
      bar.appendChild(seg);
      const l = document.createElement('span');
      l.innerHTML = `<i style="background:${color}"></i>${k} ${shares[k].toFixed(1)}%`;
      leg.appendChild(l);
    }
    wrap.append(bar, leg);
    return wrap;
  }

  async function fill(m, card){
    const r = await resolve(m, S.country);
    card._r = r; // the back face shows exactly what resolved
    if (!r){ card.style.display = 'none'; return; } // no data for this country from any source
    card.style.display = '';
    const val = card.querySelector('.value');
    if (m.bar) val.replaceChildren(energyBar(r.d.value, m.colors === 'tu' ? TU_COLORS : MIX_COLORS));
    else val.textContent = m.fmt(r.d.value, r.d);
    let c = null;
    const cmp = card.querySelector('.cmp');
    cmp.textContent = '';
    if (S.compare && !m.bar){
      c = await resolve(m, S.compare);
      if (c) cmp.textContent = `${S.compare} ${m.fmt(c.d.value, c.d)}`;
    }
    card.querySelector('.chart').innerHTML = m.bar ? '' : chartSVG(r.d.hist, c && c.d.hist);
    const chip = card.querySelector('.chip');
    chip.textContent = (r.d.src || r.s.label) + ' · ' + r.d.year + (m.srcs.length > 1 ? ' ⇄' : '');
    chip.disabled = m.srcs.length < 2;
    const yrs = String(r.d.year).match(/\d{4}/g); // "2021-2023" ranges stale by their end year
    chip.classList.toggle('old', !!yrs && Math.max(...yrs) < new Date().getFullYear() - 4); // stale data flag
    chip.onclick = async () => { // pick the next source that has data for this country
      const i = m.srcs.indexOf(r.s);
      for (let k = 1; k < m.srcs.length; k++){
        const s = m.srcs[(i + k) % m.srcs.length];
        const d = await s.get(S.country);
        if (d && d.value != null){ S.srcPick[m.id] = s.label; save(); fill(m, card); return; }
      }
    };
    // rank strip: this country against every nation in our own files
    const crank = card.querySelector('.crank');
    crank.innerHTML = '';
    crank.hidden = true;
    if (m.rank){
      const j = await localData('derived.json');
      const rk = j && j.ranks && j.ranks[m.rank];
      const my = rk && rk.map[S.country] && rk.map[S.country][0];
      if (my){
        crank.hidden = false;
        crank.appendChild(tenStrip((rk.n - my) / rk.n * 10));
        const cmpRank = S.compare && rk.map[S.compare] && rk.map[S.compare][0];
        const pv = j._prev && j._prev.ranks[m.rank] && j._prev.ranks[m.rank][S.country];
        crank.insertAdjacentHTML('beforeend', `<div class="rtext"><b>${ord(my)}</b> of ${rk.n}${rankDelta(pv, my)}` +
          (cmpRank ? ` · ${S.compare} ${ord(cmpRank)}` : '') + `<small>${m.note}</small></div>`);
      }
    }
    buildBack(m, card);
  }

  // card back: the exact data and formula behind the number
  function srcDetail(m, s){
    if (s.label === 'National') return 'data/national.json — national statistics agency adapters (16 countries) + snapshots; entry names its agency';
    if (s.label === 'FRED') return 'data/fred.json — FRED (BLS/Census series)';
    if (s.label === 'Eurostat' && m.euro) return 'ec.europa.eu/eurostat api · ' + (typeof m.euro === 'string' ? m.euro : m.euro.q).split('?')[0];
    if (s.label === 'World Bank') return 'api.worldbank.org · indicator ' + m.ind;
    const alt = (m.alt || []).find(a => a.src === s.label);
    return 'data/' + (alt ? alt.file : m.file) + ' · key ' + (alt ? alt.key : m.key) + ' (weekly pipeline)';
  }
  async function buildBack(m, card){
    const back = card.querySelector('.back');
    const r = card._r;
    if (!r){ back.innerHTML = '<div class="bk">no data for this country</div>'; return; }
    const L = [`<b>${m.name} — how this number is made</b>`];
    if (m.bar) L.push('shares: ' + Object.entries(r.d.value).map(([k, v]) => `${k} ${v}%`).join(' · '));
    else L.push(`exact value <b>${r.d.value}</b> · year ${r.d.year} · displayed as “${m.fmt(r.d.value, r.d)}”`);
    L.push(`source <b>${r.d.src || r.s.label}</b> — ${srcDetail(m, r.s)}`);
    if (m.srcs.length > 1)
      L.push('chain: ' + m.srcs.map(s => s === r.s ? `<b>[${s.label}]</b>` : s.label).join(' → ') + ' · ⇄ cycles those with data');
    if (m.id === 'days'){
      const h = await fileGet('owid.json', 'hours', S.country), w = await fileGet('ilo.json', 'weekhours', S.country);
      if (h && w){ // same-year pair, matching the pipeline's derivation
        const wh = Object.fromEntries(w.hist || [[w.year, w.value]]);
        const pair = (h.hist || [[h.year, h.value]]).filter(([y]) => wh[y] != null).at(-1);
        if (pair) L.push(`formula: ${pair[1]} h/yr (PWT via OWID, ${pair[0]}) ÷ (${wh[pair[0]]} h/wk (ILO, ${pair[0]}) ÷ 5) = <b>${(pair[1] / (wh[pair[0]] / 5)).toFixed(2)}</b>`);
        else L.push(`formula: ${h.value} h/yr (PWT via OWID, ${h.year}) ÷ (${w.value} h/wk (ILO, ${w.year}) ÷ 5) = <b>${(h.value / (w.value / 5)).toFixed(2)}</b> — no common year, latest of each`);
      }
    }
    else if (m.id === 'third') L.push(`formula: ${fmtNum(r.d.n)} cafés + bars + pubs + libraries + community centres tagged in OpenStreetMap ÷ population × 100k — ` +
      'counts what volunteers have mapped, so well-mapped countries look richer in third spaces than they are relative to poorly-mapped ones');
    else if (m.id === 'retire') L.push('formula: mean of OECD’s men’s and women’s average effective labour-market exit ages');
    else if (m.id === 'cereal') L.push('formula: FAO — (cereal imports − exports) ÷ (production + imports − exports), 3-year average; ' +
      '<b>negative = net exporter</b>; chart points sit on each window’s middle year');
    else if (m.id === 'foodimp') L.push('formula: FAO — value of food imports ÷ value of all merchandise exports, 3-year average; ' +
      'how much of a country’s export earnings its food bill would eat; chart points sit on each window’s middle year');
    else if (m.id === 'trade') L.push('formula: (exports + imports) ÷ GDP — measures exposure, not distress: ' +
      'small economies run structurally high, big diversified ones low; read alongside the food and energy cards');
    else if (m.id === 'energyimp') L.push('formula: net energy imports ÷ total energy use (IEA data via WB); ' +
      '<b>negative = net energy exporter</b>');
    else if (m.id === 'expconc') L.push('formula: UNCTAD Herfindahl-Hirschman index over ~260 export product lines, 0–1; ' +
      '1 = a single export product — the higher, the more one commodity shock can hurt every wage in the country');
    else if (m.id === 'cab') L.push('formula: current account ÷ GDP as published in the IMF World Economic Outlook; ' +
      'WEO projections are dropped — the card stops at the last completed year');
    else if (m.id === 'polstab') L.push('formula: WGI “Political Stability &amp; Absence of Violence” — a composite of perception surveys ' +
      'and expert assessments rescaled to 0–100; it measures how stable observers <i>believe</i> the state is, not events — ' +
      'the conflict-deaths card is the hard-count check on it');
    else if (m.id === 'confdeaths') L.push('formula: UCDP battle-related deaths (state, non-state and one-sided violence, best estimate) ' +
      'in the country ÷ population × 100k — an event count, includes wars and border clashes fought on this soil');
    else if (m.id === 'pubinv') L.push('formula: general government gross fixed capital formation ÷ GDP, as published; ' +
      'all public investment (roads, schools, hospitals, networks) — the standard proxy, not infrastructure alone. IMF series ends 2019; ⇄ Eurostat for current European figures');
    else L.push('formula: value as published by the source, no transformation');
    if (m.rank){
      const j = await localData('derived.json');
      const rk = j && j.ranks && j.ranks[m.rank], my = rk && rk.map[S.country];
      if (my) L.push(`rank: all ${rk.n} nations with data sorted ${m.note} → <b>${ord(my[0])}</b>; ` +
        `strip fill = (${rk.n} − ${my[0]}) ÷ ${rk.n} of nations rank worse (pipeline derived step)`);
    }
    back.innerHTML = `<div class="bk">${L.join('<br>')}</div><div class="bkhint">CLICK TO FLIP BACK</div>`;
  }

  function makeCard(m){
    const card = document.createElement('div');
    card.className = 'card';
    card.draggable = true;
    card.dataset.span = S.size[m.id] || 1;
    card.innerHTML = `<div class="cardinner"><div class="face front"><div class="chead"><span class="name">${m.name}</span>
      <span class="tools"><button class="resize" title="Resize">⤢</button><button class="chip" title="Switch data source"></button></span></div>
      <div class="cval"><span class="value">…</span><span class="cmp"></span></div>
      <div class="chart"></div><div class="crank" hidden></div></div>
      <div class="face back"></div></div>`;
    card.onclick = e => { if (!e.target.closest('button')) card.classList.toggle('flipped'); };
    card.querySelector('.resize').onclick = () => {
      S.size[m.id] = (S.size[m.id] || 1) % 3 + 1;
      card.dataset.span = S.size[m.id];
      save();
    };
    card.ondragstart = e => e.dataTransfer.setData('text/plain', m.id);
    card.ondragover = e => e.preventDefault();
    card.ondrop = e => {
      e.preventDefault();
      const from = e.dataTransfer.getData('text/plain');
      if (!from || from === m.id) return;
      S.order.splice(S.order.indexOf(from), 1);
      S.order.splice(S.order.indexOf(m.id), 0, from);
      save(); render();
    };
    fill(m, card);
    return card;
  }

  // masthead: country name + the six-pillar working-class rating with its provenance
  async function renderMast(){
    $('cname').textContent = countryNames[S.country] || S.country;
    localData('outlines.json').then(j => {
      const o = (j && j.outline) || {};
      $('cmap').innerHTML = outlineSVG(o[S.country]) +
        (S.compare ? outlineSVG(o[S.compare], 78, 'cmpmap') : ''); // compare ghost, own scale
    });
    $('vsline').innerHTML = 'working-class prosperity' +
      (S.compare ? ` · compared throughout with <b>${countryNames[S.compare] || S.compare}</b>` : '') +
      ' · ranked against every nation we have data for';
    const j = await localData('derived.json');
    const R = j && j.rating;
    const band = $('rateband'), chipEl = $('scorechip');
    const me = R && R[S.country];
    if (!me){ band.hidden = true; chipEl.textContent = ''; return; }
    band.hidden = false;
    const cp = S.compare && R[S.compare];
    chipEl.textContent = `RATING ${me.value} · RANK ${me.rank}/${R._n}`;
    const have = R._pillars.filter(p => me.p[p.id] != null).sort((a, b) => me.p[b.id] - me.p[a.id]);
    const wins = have.slice(0, 2), losses = have.slice(-2).reverse();
    const names = l => l.map(p => p.name.toUpperCase() + ' (' + Math.round(me.p[p.id]) + ')').join(' · ');
    const pv = j._prev && j._prev.rating[S.country];
    const nRanked = Object.values(j.ranks).filter(rk => rk.map[S.country]).length;
    $('overall').innerHTML =
      `<div class="cap">WORKING-CLASS RATING</div><div class="num">${me.value}</div>` +
      `<div class="rk"><b>${ord(me.rank)}</b> of ${R._n} nations${rankDelta(pv, me.rank)}` +
      (pv != null && pv !== me.rank ? ` since ${j._prev.date}` : '') +
      (cp ? ` · ${S.compare} ${cp.value}, ${ord(cp.rank)}` : '') + `</div>` +
      (cp ? (() => { // pillar-by-pillar tally against the compare country
        const shared = R._pillars.filter(p => me.p[p.id] != null && cp.p[p.id] != null);
        const w = shared.filter(p => Math.round(me.p[p.id]) > Math.round(cp.p[p.id])).length;
        const l = shared.filter(p => Math.round(me.p[p.id]) < Math.round(cp.p[p.id])).length;
        return `<div class="rk vs"><span class="${w > l ? 'up' : l > w ? 'dn' : ''}">` +
          `${w > l ? 'LEADS' : l > w ? 'TRAILS' : 'SPLITS WITH'} ${countryNames[S.compare] || S.compare}` +
          `</span> — WINS ${w}, LOSES ${l}${shared.length - w - l ? `, TIES ${shared.length - w - l}` : ''} OF ${shared.length} PILLARS</div>`;
      })() : '') +
      `<div class="lead">WINS AT ${names(wins)}<br>LOSES AT ${names(losses)}<br><br>` +
      `SCORE = MEAN PERCENTILE ACROSS ${R._pillars.length} PILLARS · EACH PILLAR = MEAN PERCENTILE OF ITS INPUTS · ` +
      R._top.map(t => t[0] + ' ' + t[1]).join(' · ') + ` LEAD · ${R._bottom[0]} LAST AT ${R._bottom[1]}` +
      `<br>RANKED IN ${nRanked} OF ${Object.keys(j.ranks).length} METRICS · DATA AS OF ${j._date || '—'}</div>`;
    const ph = $('pillars');
    ph.innerHTML = '';
    for (const p of R._pillars){
      if (me.p[p.id] == null) continue;
      const row = document.createElement('div');
      row.className = 'pillar';
      const cv = cp && cp.p[p.id] != null ? cp.p[p.id] : null;
      // comparing: tone marks who wins this pillar; alone: tone marks this country's own best/worst
      const d = cv != null ? Math.round(me.p[p.id]) - Math.round(cv) : 0;
      const tone = cv != null ? (d > 0 ? 'good' : d < 0 ? 'bad' : '')
                 : wins.includes(p) ? 'good' : losses.includes(p) ? 'bad' : '';
      row.innerHTML = `<div class="pname">${p.name}<small>${p.note} — ${p.srcs}</small></div>`;
      const strip = tenStrip(me.p[p.id] / 10);
      if (cv != null) strip.insertAdjacentHTML('beforeend',
        `<i class="cmark" style="left:${cv.toFixed(1)}%" title="${S.compare} ${Math.round(cv)}"></i>`);
      row.appendChild(strip);
      row.insertAdjacentHTML('beforeend', `<div class="pval"><span class="${tone}">${Math.round(me.p[p.id])}</span>` +
        (cv != null ? `<small>${S.compare} ${Math.round(cv)} · <span class="${d > 0 ? 'up' : d < 0 ? 'dn' : ''}">${d > 0 ? '+' : ''}${d}</span></small>` : '') + `</div>`);
      ph.appendChild(row);
    }
  }

  // rankings view: every nation sorted by a metric or the rating, filterable
  function setView(v){
    S.view = v; save();
    document.querySelector('.mast').hidden = v === 'rank';
    $('grid').hidden = v === 'rank';
    $('rankview').hidden = v !== 'rank';
    for (const b of document.querySelectorAll('.views button'))
      b.setAttribute('aria-selected', String(b.dataset.v === v));
    if (v === 'rank') renderRank();
  }
  async function renderRank(){
    const j = await localData('derived.json');
    if (!j){ $('rkTable').textContent = 'run pipeline/fetch.js first'; return; }
    const key = S.rkMetric || 'rating', worst = S.rkDir === 'worst';
    const q = $('rkFilter').value.trim().toLowerCase();
    let rows, n, note;
    const prev = (j._prev && (key === 'rating' ? j._prev.rating : j._prev.ranks[key])) || {};
    if (key === 'rating'){
      n = j.rating._n; note = 'best for the working class first';
      rows = Object.entries(j.rating).filter(([k]) => !k.startsWith('_'))
        .map(([iso, r]) => ({ iso, rank: r.rank, str: r.value.toFixed(1) }));
    } else if (key.startsWith('p:')){ // a rating pillar, ranked by its percentile score
      const id = key.slice(2), P = j.rating._pillars.find(p => p.id === id);
      const es = Object.entries(j.rating).filter(([k, r]) => !k.startsWith('_') && r.p[id] != null)
        .sort((a, b) => b[1].p[id] - a[1].p[id]);
      n = es.length; note = P.name.toLowerCase() + ' — ' + P.note;
      rows = es.map(([iso, r], i) => ({ iso, rank: i + 1, str: r.p[id].toFixed(1) }));
    } else {
      const rk = j.ranks[key], m = METRICS.find(x => x.rank === key);
      if (!rk) return;
      n = rk.n; note = m.note;
      rows = Object.entries(rk.map).map(([iso, [rank, v]]) => ({ iso, rank, str: m.fmt(v, {}) }));
    }
    rows.sort((a, b) => worst ? b.rank - a.rank : a.rank - b.rank);
    if (q) rows = rows.filter(r => (countryNames[r.iso] || r.iso).toLowerCase().includes(q));
    $('rkMeta').textContent = `${n} NATIONS RANKED · ${note.toUpperCase()} · CLICK A ROW TO OPEN THAT COUNTRY`;
    const t = $('rkTable');
    t.innerHTML = '';
    for (const r of rows){
      const row = document.createElement('button');
      row.className = 'rkrow' + (r.iso === S.country ? ' me' : r.iso === S.compare ? ' iscmp' : '');
      row.innerHTML = `<span class="rkn">${r.rank}${rankDelta(prev[r.iso], r.rank)}</span>` +
        `<span class="rkc">${countryNames[r.iso] || r.iso}</span><span class="rkv">${r.str}</span>`;
      row.appendChild(tenStrip((n - r.rank) / n * 10));
      row.onclick = () => {
        S.country = r.iso; save();
        $('country').value = r.iso;
        setView('dash'); render();
      };
      t.appendChild(row);
    }
  }
  function initRank(){
    const sel = $('rkMetric');
    sel.innerHTML = '<option value="rating">Working-class rating</option>' +
      METRICS.filter(m => m.rank).map(m => `<option value="${m.rank}">${m.name}</option>`).join('');
    sel.value = S.rkMetric || 'rating';
    localData('derived.json').then(j => { // pillars come from the data, not METRICS
      if (!(j && j.rating)) return;
      sel.options[0].insertAdjacentHTML('afterend',
        j.rating._pillars.map(p => `<option value="p:${p.id}">Pillar: ${p.name}</option>`).join(''));
      if (S.rkMetric) sel.value = S.rkMetric;
    });
    sel.onchange = () => { S.rkMetric = sel.value; save(); renderRank(); };
    const dir = $('rkDir');
    dir.value = S.rkDir || 'best';
    dir.onchange = () => { S.rkDir = dir.value; save(); renderRank(); };
    $('rkFilter').oninput = renderRank;
    for (const b of document.querySelectorAll('.views button')) b.onclick = () => setView(b.dataset.v);
  }

  function render(){
    renderMast();
    const grid = $('grid');
    grid.innerHTML = '';
    for (const cat of [...new Set(METRICS.map(m => m.cat))]){
      const ids = S.order.filter(id => S.enabled.includes(id) && METRICS.find(x => x.id === id).cat === cat);
      if (!ids.length) continue;
      const sec = document.createElement('details');
      sec.className = 'folder';
      sec.open = S.folders[cat] !== false;
      sec.innerHTML = `<summary>${cat}</summary>`;
      sec.ontoggle = () => { S.folders[cat] = sec.open; save(); };
      const g = document.createElement('div');
      g.className = 'cards';
      for (const id of ids) g.appendChild(makeCard(METRICS.find(x => x.id === id)));
      sec.appendChild(g);
      grid.appendChild(sec);
    }
  }

  function renderSettings(){
    const box = $('folders');
    const prefs = document.createElement('div');
    prefs.className = 'prefs';
    prefs.innerHTML = `
      <label>Theme <select id="themeSel">${THEMES.map(t => `<option${t === S.theme ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Accent <input type="color" id="accent" value="${S.accent || '#cba6f7'}"></label>
      <button id="exp">Export</button>
      <label class="btn">Import<input type="file" id="imp" accept=".json" hidden></label>`;
    box.appendChild(prefs);
    prefs.querySelector('#themeSel').onchange = e => { S.theme = e.target.value; applyTheme(); save(); };
    prefs.querySelector('#accent').oninput = e => { S.accent = e.target.value; applyTheme(); save(); };
    prefs.querySelector('#exp').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
      a.download = 'dashboard-settings.json';
      a.click();
      URL.revokeObjectURL(a.href);
    };
    prefs.querySelector('#imp').onchange = e => {
      e.target.files[0].text().then(t => {
        JSON.parse(t); // validate before storing
        localStorage.setItem('dash', t);
        location.reload();
      }).catch(() => alert('Not a valid settings file'));
    };
    for (const cat of [...new Set(METRICS.map(m => m.cat))]){
      const h = document.createElement('h3');
      h.textContent = cat;
      box.appendChild(h);
      for (const m of METRICS.filter(x => x.cat === cat)){
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = S.enabled.includes(m.id);
        cb.onchange = () => {
          S.enabled = cb.checked ? [...S.enabled, m.id] : S.enabled.filter(x => x !== m.id);
          save(); render();
        };
        label.append(cb, ' ' + m.name);
        box.appendChild(label);
      }
    }
  }

  async function loadCountries(){
    let list = JSON.parse(localStorage.getItem('countries') || 'null');
    if (!list){
      const j = await fetch('https://api.worldbank.org/v2/country?format=json&per_page=400').then(r => r.json());
      list = j[1].filter(c => c.region.value !== 'Aggregates').map(c => [c.id, c.name]);
      localStorage.setItem('countries', JSON.stringify(list));
    }
    countryNames = Object.fromEntries(list);
    list.sort((a, b) => a[1].localeCompare(b[1])); // WB returns iso2-code order — UK sat in the G's
    const opts = list.map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
    const sel = $('country'), cmp = $('compare');
    sel.innerHTML = opts;
    sel.value = S.country;
    sel.onchange = () => { S.country = sel.value; save(); render(); };
    cmp.innerHTML = '<option value="">compare…</option>' + opts;
    cmp.value = S.compare;
    cmp.onchange = () => { S.compare = cmp.value; save(); render(); };
    renderMast(); // names arrived — repaint the masthead
  }

  renderSettings();
  initRank();
  loadCountries().then(() => { if (S.view === 'rank') renderRank(); }).catch(console.error); // names for the list
  render();
  setView(S.view === 'rank' ? 'rank' : 'dash');
})();
