// pipeline/fetch.js — fetches cached data sources into data/*.json
// run: node pipeline/fetch.js [source ...]   (no args = all sources)
// cron (weekly): 0 6 * * 1 cd /path/to/data-dashboard && node pipeline/fetch.js
const fs = require('fs');
const path = require('path');

// ponytail: whole-file CSV parse, no streaming; largest input ~25MB, fine for a weekly cron
function parseCSV(text, delim = ','){
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){
      if (c === '"' && text[i + 1] === '"'){ field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    }
    else if (c === '"') q = true;
    else if (c === delim){ row.push(field); field = ''; }
    else if (c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length){ row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

async function getText(url, retry = 1){
  // Accept-Language must be explicit: ILO's server 500s on node-fetch's default "Accept-Language: *"
  const r = await fetch(url, { headers: { 'Accept-Language': 'en' } }).catch(e => ({ ok: false, status: e.message }));
  if (!r.ok){
    if (retry > 0){ await new Promise(res => setTimeout(res, 5000)); return getText(url, retry - 1); } // ponytail: OECD 500s transiently
    throw new Error(r.status + ' ' + url);
  }
  return r.text();
}

// every source returns {metricKey: {ISO3: {value, year, ...extras}}}
const SOURCES = {
  async who(){
    const out = { hale: {}, suicide: {} };
    for (const [key, code] of [['hale', 'WHOSIS_000002'], ['suicide', 'SDGSUICIDE']]){
      const j = JSON.parse(await getText(`https://ghoapi.azureedge.net/api/${code}?$filter=Dim1 eq 'SEX_BTSX'`));
      for (const r of j.value){
        if (r.SpatialDimType !== 'COUNTRY' || r.NumericValue == null) continue;
        const cur = out[key][r.SpatialDim];
        if (!cur || r.TimeDim > cur.year) out[key][r.SpatialDim] = { value: r.NumericValue, year: r.TimeDim };
      }
    }
    return out;
  },

  async bigmac(){
    const rows = parseCSV(await getText('https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-full-index.csv'));
    const out = {};
    for (const r of rows){
      const year = +r.date.slice(0, 4);
      if (!out[r.iso_a3] || year >= out[r.iso_a3].year) out[r.iso_a3] = { value: +r.dollar_price, year };
    }
    return { bigmac: out };
  },

  async energy(){
    const rows = parseCSV(await getText('https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv'));
    const parts = { coal:'coal_share_energy', oil:'oil_share_energy', gas:'gas_share_energy',
      nuclear:'nuclear_share_energy', hydro:'hydro_share_energy', wind:'wind_share_energy',
      solar:'solar_share_energy', biofuel:'biofuel_share_energy', other:'other_renewables_share_energy' };
    const out = {};
    for (const r of rows){
      if (r.iso_code.length !== 3) continue;
      const shares = {};
      for (const [k, col] of Object.entries(parts)) if (r[col] !== '') shares[k] = +r[col];
      if (!Object.keys(shares).length) continue;
      const year = +r.year;
      if (!out[r.iso_code] || year > out[r.iso_code].year) out[r.iso_code] = { value: shares, year };
    }
    return { mix: out };
  },

  async co2(){
    const rows = parseCSV(await getText('https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv'));
    const out = { co2: {}, co2pc: {} };
    for (const r of rows){
      if (r.iso_code.length !== 3) continue;
      const year = +r.year;
      if (r.co2 !== '' && (!out.co2[r.iso_code] || year > out.co2[r.iso_code].year))
        out.co2[r.iso_code] = { value: +r.co2, year };
      if (r.co2_per_capita !== '' && (!out.co2pc[r.iso_code] || year > out.co2pc[r.iso_code].year))
        out.co2pc[r.iso_code] = { value: +r.co2_per_capita, year };
    }
    return out;
  },

  async warming(){
    const rows = parseCSV(await getText('https://ourworldindata.org/grapher/annual-temperature-anomalies.csv'));
    const out = {};
    for (const r of rows){
      if ((r.Code || '').length !== 3 || r['Temperature anomaly'] === '') continue;
      const year = +r.Year;
      if (!out[r.Code] || year > out[r.Code].year) out[r.Code] = { value: +r['Temperature anomaly'], year };
    }
    return { warming: out };
  },

  async oecd(){
    const out = { medinc: {}, house: {} };
    let rows = parseCSV(await getText('https://sdmx.oecd.org/public/rest/data/OECD.WISE.INE,DSD_WISE_IDD@DF_IDD,1.0/.A.INC_DISP.MEDIAN.....?format=csvfilewithlabels&startPeriod=2018'));
    for (const r of rows){
      if (r.AGE !== '_T' || r.REF_AREA.length !== 3 || r.OBS_VALUE === '') continue;
      const year = +r.TIME_PERIOD;
      if (!out.medinc[r.REF_AREA] || year > out.medinc[r.REF_AREA].year)
        out.medinc[r.REF_AREA] = { value: +r.OBS_VALUE, year, unit: r.CURRENCY };
    }
    rows = parseCSV(await getText('https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0/.A.HPI_YDH_AVG.?format=csvfilewithlabels&startPeriod=2020'));
    for (const r of rows){
      if (r.MEASURE !== 'HPI_YDH_AVG' || r.REF_AREA.length !== 3 || r.OBS_VALUE === '') continue;
      const year = +r.TIME_PERIOD.slice(0, 4);
      if (!out.house[r.REF_AREA] || year > out.house[r.REF_AREA].year)
        out.house[r.REF_AREA] = { value: +r.OBS_VALUE, year };
    }
    return out;
  },

  async owid(){
    const slugs = { hours:'annual-working-hours-per-worker', satisfaction:'happiness-cantril-ladder',
      democracy:'liberal-democracy-index', cpi:'ti-corruption-perception-index' };
    const out = {};
    for (const [key, slug] of Object.entries(slugs)){
      const rows = parseCSV(await getText(`https://ourworldindata.org/grapher/${slug}.csv`));
      const col = Object.keys(rows[0])[3]; // grapher CSVs: Entity,Code,Year,<value>
      const m = out[key] = {};
      for (const r of rows){
        if ((r.Code || '').length !== 3 || r[col] === '') continue;
        const year = +r.Year;
        if (!m[r.Code] || year > m[r.Code].year) m[r.Code] = { value: +r[col], year };
      }
    }
    return out;
  },

  async rsf(){
    for (let y = new Date().getFullYear(); y >= 2024; y--){
      const r = await fetch(`https://rsf.org/sites/default/files/import_classement/${y}.csv`);
      if (!r.ok) continue;
      const rows = parseCSV(await r.text(), ';');
      const col = Object.keys(rows[0]).find(h => /^Score \d{4}$/.test(h));
      const out = {};
      for (const row of rows){
        if ((row.ISO || '').length !== 3 || !row[col]) continue;
        out[row.ISO] = { value: +row[col].replace(',', '.'), year: y }; // RSF uses decimal commas
      }
      return { press: out };
    }
    throw new Error('no RSF csv found');
  },

  async ilo(){
    const out = { bargain: {}, weekhours: {} };
    for (const [key, url] of [
      ['bargain', 'https://sdmx.ilo.org/rest/data/ILO,DF_ILR_CBCT_NOC_RT/all?format=csv&startPeriod=2015'],
      ['weekhours', 'https://sdmx.ilo.org/rest/data/ILO,DF_HOW_TEMP_SEX_ECO_NB/.A..SEX_T.ECO_AGGREGATE_TOTAL?format=csv&startPeriod=2018'],
    ]){
      for (const r of parseCSV(await getText(url))){
        if (r.REF_AREA.length !== 3 || r.OBS_VALUE === '') continue;
        const year = +r.TIME_PERIOD;
        if (!out[key][r.REF_AREA] || year > out[key][r.REF_AREA].year)
          out[key][r.REF_AREA] = { value: +r.OBS_VALUE, year };
      }
    }
    return out;
  },

  // first-hand national statistics agencies; every entry carries its own src label
  async national(){
    const out = { unemp: {}, lfpr: {}, infl: {} };
    const put = (key, iso, src, value, year) => {
      if (value != null && !Number.isNaN(+value)) out[key][iso] = { value: +value, year, src };
    };

    const tasks = {
      async statcan(){ // Canada — Labour Force Survey, seasonally adjusted
        const r = await fetch('https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' },
          body: JSON.stringify([{ vectorId: 2062815, latestN: 1 }, { vectorId: 2062816, latestN: 1 }]) });
        const j = await r.json();
        for (const [key, vec] of [['unemp', 2062815], ['lfpr', 2062816]]){
          const p = j.find(x => x.object.vectorId === vec).object.vectorDataPoint[0];
          put(key, 'CAN', 'StatCan', p.value, p.refPer.slice(0, 7));
        }
      },
      async ons(){ // UK — the ONS site serves series JSON at <series page>/data (the old API was retired 2024)
        for (const [key, p] of [
          ['unemp', 'employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms'],
          ['lfpr', 'employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/lf22/lms'],
          ['infl', 'economy/inflationandpriceindices/timeseries/d7g7/mm23']]){
          const j = JSON.parse(await getText(`https://www.ons.gov.uk/${p}/data`));
          const m = (j.months || j.quarters).at(-1);
          put(key, 'GBR', 'ONS', m.value, m.date);
        }
      },
      async abs(){ // Australia — Labour Force, persons 15+, seasonally adjusted
        for (const [key, measure] of [['unemp', 'M13'], ['lfpr', 'M12']]){
          const j = JSON.parse(await getText(`https://data.api.abs.gov.au/rest/data/LF/${measure}.3.1599.20.AUS.M?lastNObservations=1&format=jsondata`));
          const obs = Object.values(j.data.dataSets[0].series)[0].observations;
          const time = j.data.structures[0].dimensions.observation[0].values;
          put(key, 'AUS', 'ABS', Object.values(obs).at(-1)[0], time.at(-1).id);
        }
      },
      async ibge(){ // Brazil — PNAD Contínua unemployment + IPCA 12-month inflation
        const q = async (agg, vari) => {
          const j = JSON.parse(await getText(`https://servicodados.ibge.gov.br/api/v3/agregados/${agg}/periodos/-1/variaveis/${vari}?localidades=N1%5Ball%5D`));
          const [period, value] = Object.entries(j[0].resultados[0].series[0].serie)[0];
          return [value, period.length === 6 ? period.slice(0, 4) + '-' + period.slice(4) : period];
        };
        let [v, p] = await q(6381, 4099); put('unemp', 'BRA', 'IBGE', v, p);
        [v, p] = await q(1737, 2265); put('infl', 'BRA', 'IBGE', v, p);
      },
    };
    for (const [name, fn] of Object.entries(tasks)){
      try { await fn(); } catch (e){ console.error('  national/' + name + ':', e.message); }
    }

    // hand-maintained snapshots (NBS China, Rosstat, …) fill in only where no live adapter answered
    let snap = {};
    try { snap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'snapshots.json'))); } catch {}
    for (const [key, m] of Object.entries(snap)){
      if (key.startsWith('_') || !out[key]) continue;
      for (const [iso, e] of Object.entries(m)) if (!out[key][iso]) out[key][iso] = e;
    }
    return out;
  },

  async fred(){
    // US first-hand data (BLS/Census series republished by the St. Louis Fed)
    const KEY = process.env.FRED_API_KEY;
    if (!KEY) throw new Error('set FRED_API_KEY (free key: fred.stlouisfed.org/docs/api/api_key.html)');
    const out = {};
    for (const [key, series] of [['unemp', 'UNRATE'], ['lfpr', 'CIVPART'], ['medhome', 'MSPUS']]){
      const j = JSON.parse(await getText(`https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${KEY}&file_type=json&sort_order=desc&limit=4`));
      const o = j.observations.find(o => o.value !== '.');
      if (o) out[key] = { USA: { value: +o.value, year: o.date.slice(0, 7) } };
    }
    return out;
  },

  // reads other sources' output from data/ — keep last in SOURCES so a full run feeds it fresh files
  async derived(){
    const read = f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f))); } catch { return null; } };
    const owid = read('owid.json'), ilo = read('ilo.json'), who = read('who.json'),
      oecd = read('oecd.json'), co2 = read('co2.json'), warming = read('warming.json'), rsf = read('rsf.json');

    // ponytail: days worked = annual hours ÷ (usual weekly hours ÷ 5); labeled as derived in the UI
    const daysworked = {};
    if (owid && ilo) for (const [iso, h] of Object.entries(owid.hours)){
      const w = ilo.weekhours[iso];
      if (w) daysworked[iso] = { value: h.value / (w.value / 5), year: Math.min(h.year, w.year) };
    }

    const countries = new Set(JSON.parse(await getText('https://api.worldbank.org/v2/country?format=json&per_page=400'))[1]
      .filter(c => c.region.value !== 'Aggregates').map(c => c.id));
    const wbBulk = async ind => {
      const j = JSON.parse(await getText(`https://api.worldbank.org/v2/country/all/indicator/${ind}?format=json&mrnev=1&per_page=500`));
      return Object.fromEntries(j[1].filter(d => d.value != null && countries.has(d.countryiso3code)).map(d => [d.countryiso3code, d.value]));
    };
    const flat = m => m && Object.fromEntries(Object.entries(m).filter(([k]) => countries.has(k)).map(([k, v]) => [k, v.value]));

    // iso -> value maps for everything rankable (WB bulks + files already on disk)
    const vals = {
      unemp: await wbBulk('SL.UEM.TOTL.ZS'), lfpr: await wbBulk('SL.TLF.CACT.ZS'),
      gdppc: await wbBulk('NY.GDP.PCAP.PP.CD'), pli: await wbBulk('PA.NUS.PRVT.PLI'),
      school: await wbBulk('SE.SCH.LIFE'), oop: await wbBulk('SH.XPD.OOPC.CH.ZS'),
      house: flat(oecd && oecd.house), hale: flat(who && who.hale), suicide: flat(who && who.suicide),
      hours: flat(owid && owid.hours), happy: flat(owid && owid.satisfaction),
      vdem: flat(owid && owid.democracy), cpi: flat(owid && owid.cpi), press: flat(rsf && rsf.press),
      co2: flat(co2 && co2.co2pc), warm: flat(warming && warming.warming),
      days: Object.fromEntries(Object.entries(daysworked).filter(([k]) => countries.has(k)).map(([k, v]) => [k, v.value])),
      cba: flat(ilo && ilo.bargain),
    };
    const pct = (key, dir) => { // iso -> percentile 0..100, 100 = best for the working class
      const e = Object.entries(vals[key] || {}).filter(([, v]) => v != null && isFinite(v))
        .sort((a, b) => dir === 'lo' ? b[1] - a[1] : a[1] - b[1]); // worst first
      const p = {}; e.forEach(([iso], i) => p[iso] = i / (e.length - 1) * 100); return p;
    };

    // per-metric ranks for the cards' rank strips: {n, dir, map:{ISO: rank}}
    const RANKED = { unemp:'lo', lfpr:'hi', gdppc:'hi', pli:'lo', oop:'lo', house:'lo',
      hale:'hi', suicide:'lo', hours:'lo', happy:'hi', vdem:'hi', cpi:'hi', press:'hi',
      co2:'lo', warm:'lo', days:'lo', cba:'hi', school:'hi' };
    const ranks = {};
    for (const [key, dir] of Object.entries(RANKED)){
      const e = Object.entries(vals[key] || {}).filter(([, v]) => v != null && isFinite(v))
        .sort((a, b) => dir === 'lo' ? a[1] - b[1] : b[1] - a[1]); // best first
      if (e.length < 2) continue;
      ranks[key] = { n: e.length, dir, // map: ISO3 -> [rank, value] so list views can show both
        map: Object.fromEntries(e.map(([iso, v], i) => [iso, [i + 1, +Number(v).toPrecision(5)]])) };
    }

    // working-class rating: mean percentile across six pillars, each the mean percentile of its inputs
    const PILLARS = [
      ['col', 'Cost of living', 'price level · home price vs income', 'WB · OECD', [['pli','lo'], ['house','lo']]],
      ['earn', 'Earning opportunity', 'jobs · participation · output per person', 'WB', [['unemp','lo'], ['lfpr','hi'], ['gdppc','hi']]],
      ['edu', 'Education', 'expected years in school', 'WB', [['school','hi']]],
      ['svc', 'Service costs', 'out-of-pocket share of health spending', 'WHO via WB', [['oop','lo']]],
      ['health', 'Health outcomes', 'healthy life expectancy · suicide', 'WHO', [['hale','hi'], ['suicide','lo']]],
      ['time', 'Time kept', 'hours and days worked per year', 'OWID · derived', [['hours','lo'], ['days','lo']]],
    ];
    const pillarPct = {};
    for (const [id, , , , inputs] of PILLARS){
      const pcts = inputs.map(([k, dir]) => pct(k, dir));
      pillarPct[id] = {};
      for (const iso of new Set(pcts.flatMap(p => Object.keys(p)))){
        const have = pcts.map(p => p[iso]).filter(v => v != null);
        if (have.length) pillarPct[id][iso] = have.reduce((a, b) => a + b) / have.length;
      }
    }
    const scored = [];
    for (const iso of countries){
      const ps = PILLARS.map(([id]) => pillarPct[id][iso]).filter(v => v != null);
      if (ps.length >= 4) scored.push([iso, ps.reduce((a, b) => a + b) / ps.length]); // ponytail: <4 pillars = unrated
    }
    scored.sort((a, b) => b[1] - a[1]);
    const rating = {
      _pillars: PILLARS.map(([id, name, note, srcs]) => ({ id, name, note, srcs })),
      _top: scored.slice(0, 3).map(([i, s]) => [i, +s.toFixed(1)]),
      _bottom: [scored.at(-1)[0], +scored.at(-1)[1].toFixed(1)], _n: scored.length,
    };
    const year = new Date().getFullYear();
    scored.forEach(([iso, s], i) => {
      const p = {};
      for (const [id] of PILLARS) if (pillarPct[id][iso] != null) p[id] = +pillarPct[id][iso].toFixed(1);
      rating[iso] = { value: +s.toFixed(1), year, rank: i + 1, p };
    });
    return { daysworked, ranks, rating };
  },
};

async function main(){
  const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SOURCES);
  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  let failed = 0;
  for (const name of names){
    if (name === 'fred' && !process.env.FRED_API_KEY){
      console.log('skip fred (set FRED_API_KEY, free at fred.stlouisfed.org)');
      continue;
    }
    try {
      const data = await SOURCES[name]();
      fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(data));
      console.log('ok  ', name, Object.entries(data).map(([k, v]) => `${k}:${Object.keys(v).length}`).join(' '));
    } catch (e){
      failed++;
      console.error('FAIL', name, e.message);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { parseCSV };
