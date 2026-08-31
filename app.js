// ---- pure helpers (checked by test.js) ----
function fmtUSD(v){ return '$' + Math.round(v).toLocaleString('en-US'); }
function fmtPct(v){ return v.toFixed(1) + '%'; }
function fmtNum(v){
  return Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(2) + 'B'
       : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M'
       : Math.round(v).toLocaleString('en-US');
}
// ponytail: saved order first, newly added metric ids appended at the end
function mergeOrder(saved, ids){
  return [...saved.filter(id => ids.includes(id)), ...ids.filter(id => !saved.includes(id))];
}
// source resolution order: user's pick first, then declared order (national → harmonized → aggregator)
function srcOrder(list, pick){
  const p = list.find(s => s.label === pick);
  return p ? [p, ...list.filter(s => s !== p)] : list;
}
// polyline points for a 100x24 sparkline viewBox
function sparkPoints(vals){
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  return vals.map((v, i) =>
    `${(i / (vals.length - 1) * 100).toFixed(1)},${(22 - (v - min) / span * 20).toFixed(1)}`).join(' ');
}

var METRICS = [
  {id:'score',  cat:'Overview', name:'Prosperity Score (working class)', file:'derived.json', key:'score', src:'composite of 6 harmonized metrics', fmt:v => Math.round(v) + ' /100'},
  {id:'gdppc',  cat:'Economy', name:'GDP per capita',          ind:'NY.GDP.PCAP.CD',    fmt:fmtUSD},
  {id:'growth', cat:'Economy', name:'GDP growth',              ind:'NY.GDP.MKTP.KD.ZG', fmt:fmtPct},
  {id:'infl',   cat:'Economy', name:'Inflation (CPI)',         ind:'FP.CPI.TOTL.ZG',    fmt:fmtPct, natl:'infl', euro:'prc_hicp_aind?unit=RCH_A_AVG&coicop=CP00'},
  {id:'gini',   cat:'Economy', name:'Gini inequality index',   ind:'SI.POV.GINI',       fmt:fmtNum, euro:'ilc_di12?age=TOTAL&statinfo=GINI_HND'},
  {id:'pov',    cat:'Economy', name:'Poverty rate (<$6.85/day)', ind:'SI.POV.UMIC',     fmt:fmtPct},
  {id:'pli',    cat:'Economy', name:'Cost of living (US=100)', ind:'PA.NUS.PRVT.PLI',   fmt:v => String(Math.round(v))},
  {id:'medinc', cat:'Economy', name:'Median disposable income', file:'oecd.json', key:'medinc', src:'OECD', fmt:(v, d) => fmtNum(v) + ' ' + (d.unit || ''), euro:{q:'ilc_di03?age=TOTAL&sex=T&statinfo=MED_EI&unit=EUR', unit:'EUR'}},
  {id:'house',  cat:'Economy', name:'Home price vs income (avg=100)', file:'oecd.json', key:'house', src:'OECD', fmt:v => String(Math.round(v))},
  {id:'medhome', cat:'Economy', name:'Median home price', fred:'medhome', fmt:fmtUSD},
  {id:'bigmac', cat:'Economy', name:'Big Mac price', file:'bigmac.json', key:'bigmac', src:'The Economist', fmt:v => '$' + v.toFixed(2)},
  {id:'unemp',  cat:'Work',    name:'Unemployment',            ind:'SL.UEM.TOTL.ZS',    fmt:fmtPct, natl:'unemp', fred:'unemp', euro:'une_rt_a?sex=T&age=Y15-74&unit=PC_ACT'},
  {id:'lfpr',   cat:'Work',    name:'Workforce participation', ind:'SL.TLF.CACT.ZS',    fmt:fmtPct, natl:'lfpr', fred:'lfpr'},
  {id:'vuln',   cat:'Work',    name:'Vulnerable employment',   ind:'SL.EMP.VULN.ZS',    fmt:fmtPct},
  {id:'neet',   cat:'Work',    name:'Youth not in work/school', ind:'SL.UEM.NEET.ZS',   fmt:fmtPct},
  {id:'hours',  cat:'Work',    name:'Annual hours worked', file:'owid.json', key:'hours', src:'PWT via OWID', fmt:v => Math.round(v).toLocaleString('en-US') + ' hrs'},
  {id:'days',   cat:'Work',    name:'Days worked per year (derived)', file:'derived.json', key:'daysworked', src:'OWID hours ÷ ILO weekly hours', fmt:v => Math.round(v) + ' days'},
  {id:'cba',    cat:'Work',    name:'Collective bargaining coverage', file:'ilo.json', key:'bargain', src:'ILOSTAT', fmt:fmtPct},
  {id:'life',   cat:'Health',  name:'Life expectancy',         ind:'SP.DYN.LE00.IN',    fmt:v => v.toFixed(1) + ' yrs', euro:'demo_mlexpec?sex=T&age=Y_LT1&unit=YR'},
  {id:'hexp',   cat:'Health',  name:'Health spend per capita', ind:'SH.XPD.CHEX.PC.CD', fmt:fmtUSD},
  {id:'oop',    cat:'Health',  name:'Out-of-pocket health costs', ind:'SH.XPD.OOPC.CH.ZS', fmt:fmtPct},
  {id:'hale',   cat:'Health',  name:'Healthy life expectancy', file:'who.json', key:'hale', src:'WHO', fmt:v => v.toFixed(1) + ' yrs'},
  {id:'suic',   cat:'Health',  name:'Suicide rate', file:'who.json', key:'suicide', src:'WHO', fmt:v => v.toFixed(1) + ' /100k'},
  {id:'homi',   cat:'Society', name:'Homicide rate',           ind:'VC.IHR.PSRC.P5',    fmt:v => v.toFixed(1) + ' /100k'},
  {id:'net',    cat:'Society', name:'Internet users',          ind:'IT.NET.USER.ZS',    fmt:fmtPct},
  {id:'happy',  cat:'Society', name:'Life satisfaction', file:'owid.json', key:'satisfaction', src:'World Happiness Report via OWID', fmt:v => v.toFixed(1) + ' /10'},
  {id:'press',  cat:'Freedom', name:'Press freedom', file:'rsf.json', key:'press', src:'Reporters Without Borders', fmt:v => v.toFixed(1) + ' /100'},
  {id:'cpi',    cat:'Freedom', name:'Corruption perceptions', file:'owid.json', key:'cpi', src:'Transparency Intl via OWID', fmt:v => Math.round(v) + ' /100'},
  {id:'vdem',   cat:'Freedom', name:'Liberal democracy index', file:'owid.json', key:'democracy', src:'V-Dem via OWID', fmt:v => v.toFixed(2) + ' /1'},
  {id:'pop',    cat:'People',  name:'Population',              ind:'SP.POP.TOTL',       fmt:fmtNum},
  {id:'popg',   cat:'People',  name:'Population growth',       ind:'SP.POP.GROW',       fmt:fmtPct},
  {id:'mig',    cat:'People',  name:'Net migration',           ind:'SM.POP.NETM',       fmt:fmtNum},
  {id:'urban',  cat:'People',  name:'Urban population',        ind:'SP.URB.TOTL.IN.ZS', fmt:fmtPct},
  {id:'co2',    cat:'Climate & Energy', name:'CO₂ per capita',           ind:'EN.GHG.CO2.PC.CE.AR5', fmt:v => v.toFixed(1) + ' t', alt:[{src:'Our World in Data', file:'co2.json', key:'co2pc'}]},
  {id:'renew',  cat:'Climate & Energy', name:'Renewable energy share',   ind:'EG.FEC.RNEW.ZS',       fmt:fmtPct},
  {id:'forest', cat:'Climate & Energy', name:'Forest area',              ind:'AG.LND.FRST.ZS',       fmt:fmtPct},
  {id:'pm25',   cat:'Climate & Energy', name:'Air pollution (PM2.5)',    ind:'EN.ATM.PM25.MC.M3',    fmt:v => v.toFixed(1) + ' µg/m³'},
  {id:'co2t',   cat:'Climate & Energy', name:'CO₂ total', file:'co2.json', key:'co2', src:'Our World in Data', fmt:v => v >= 1000 ? (v / 1000).toFixed(2) + ' Gt' : Math.round(v) + ' Mt'},
  {id:'warm',   cat:'Climate & Energy', name:'Temperature anomaly', file:'warming.json', key:'warming', src:'Berkeley Earth via OWID', fmt:v => (v > 0 ? '+' : '') + v.toFixed(2) + ' °C'},
  {id:'mix',    cat:'Climate & Energy', name:'Energy mix', file:'energy.json', key:'mix', src:'Our World in Data', bar:true},
];

var MIX_COLORS = { coal:'#57534e', oil:'#a16207', gas:'#ca8a04', nuclear:'#7c3aed',
  hydro:'#0284c7', wind:'#06b6d4', solar:'#eab308', biofuel:'#65a30d', other:'#22c55e' };

var THEMES = ['dark', 'light', 'nord', 'solarized', 'midnight'];

if (typeof document !== 'undefined') (function(){
  const $ = id => document.getElementById(id);
  const S = Object.assign(
    {country:'USA', compare:'', theme:'dark', accent:'', enabled:METRICS.map(m => m.id), order:[], size:{}, folders:{}, srcPick:{}},
    JSON.parse(localStorage.getItem('dash') || '{}'));
  S.order = mergeOrder(S.order, METRICS.map(m => m.id));
  const save = () => localStorage.setItem('dash', JSON.stringify(S));
  const cache = new Map(); // ponytail: per-pageload cache; add a localStorage TTL cache if sources feel slow

  function applyTheme(){
    document.documentElement.dataset.theme = S.theme;
    if (S.accent) document.documentElement.style.setProperty('--accent', S.accent);
    else document.documentElement.style.removeProperty('--accent');
  }
  applyTheme();

  function wb(ind, country){
    const key = country + ind;
    if (!cache.has(key)) cache.set(key,
      fetch(`https://api.worldbank.org/v2/country/${country}/indicator/${ind}?format=json&per_page=100`)
        .then(r => r.json())
        .then(j => {
          const rows = (j[1] || []).filter(d => d.value != null); // newest first
          if (!rows.length) return null;
          return { value: rows[0].value, year: rows[0].date,
                   hist: rows.map(d => [+d.date, d.value]).sort((a, b) => a[0] - b[0]) };
        })
        .catch(() => null));
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
    if (!cache.has(key)) cache.set(key,
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
        .catch(() => null));
    return cache.get(key);
  }

  // per-metric source list, most first-hand first; the ⇄ button and S.srcPick pick within it
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
  }

  async function resolve(m, country){
    for (const s of srcOrder(m.srcs, S.srcPick[m.id])){
      const d = await s.get(country);
      if (d && d.value != null) return { d, s };
    }
    return null;
  }

  function energyBar(shares){
    const bar = document.createElement('div');
    bar.className = 'bar';
    for (const [k, color] of Object.entries(MIX_COLORS)){
      if (!shares[k]) continue;
      const seg = document.createElement('div');
      seg.style.cssText = `width:${shares[k]}%;background:${color}`;
      seg.title = `${k} ${shares[k].toFixed(1)}%`;
      bar.appendChild(seg);
    }
    return bar;
  }

  async function fill(m, card){
    const r = await resolve(m, S.country);
    if (!r){ card.style.display = 'none'; return; } // no data for this country from any source
    card.style.display = '';
    const val = card.querySelector('.value');
    if (m.bar) val.replaceChildren(energyBar(r.d.value));
    else val.textContent = m.fmt(r.d.value, r.d);
    const spark = card.querySelector('.spark');
    spark.style.display = 'none';
    if (r.d.hist && r.d.hist.length > 1){
      spark.querySelector('polyline').setAttribute('points', sparkPoints(r.d.hist.map(p => p[1])));
      spark.style.display = 'block';
    }
    const cmp = card.querySelector('.cmp');
    cmp.textContent = '';
    if (S.compare && !m.bar){
      const c = await resolve(m, S.compare);
      if (c) cmp.textContent = `vs ${S.compare}: ${m.fmt(c.d.value, c.d)}`;
    }
    const yr = card.querySelector('.year');
    yr.textContent = r.d.year + ' · ' + (r.d.src || r.s.label);
    if (m.srcs.length > 1){
      const b = document.createElement('button');
      b.className = 'swap';
      b.textContent = '⇄';
      b.title = 'Switch data source';
      b.onclick = async () => { // pick the next source that has data for this country
        const i = m.srcs.indexOf(r.s);
        for (let k = 1; k < m.srcs.length; k++){
          const s = m.srcs[(i + k) % m.srcs.length];
          const d = await s.get(S.country);
          if (d && d.value != null){ S.srcPick[m.id] = s.label; save(); fill(m, card); return; }
        }
      };
      yr.appendChild(b);
    }
  }

  function makeCard(m){
    const card = document.createElement('div');
    card.className = 'card';
    card.draggable = true;
    card.dataset.span = S.size[m.id] || 1;
    card.innerHTML = `<div class="label"><span>${m.name}</span><button class="resize" title="Resize">⤢</button></div>
      <div class="value">…</div>
      <svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline fill="none"/></svg>
      <div class="cmp"></div><div class="year"></div>`;
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

  function render(){
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
      <label>Accent <input type="color" id="accent" value="${S.accent || '#2dd4bf'}"></label>
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
    const opts = list.map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
    const sel = $('country'), cmp = $('compare');
    sel.innerHTML = opts;
    sel.value = S.country;
    sel.onchange = () => { S.country = sel.value; save(); render(); };
    cmp.innerHTML = '<option value="">compare…</option>' + opts;
    cmp.value = S.compare;
    cmp.onchange = () => { S.compare = cmp.value; save(); render(); };
  }

  renderSettings();
  loadCountries().catch(console.error);
  render();
})();
