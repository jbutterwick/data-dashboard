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

// {iso: {year: value}} -> {iso: {value, year, hist}} — latest on top, chartable series (1990+) kept
function pack(m, extra){
  const out = {};
  for (const [iso, ys] of Object.entries(m)){
    const all = Object.keys(ys).map(y => [+y, ys[y]]).sort((a, b) => a[0] - b[0]);
    const last = all[all.length - 1];
    const hist = all.filter(([y]) => y >= 1990).map(([y, v]) => [y, +Number(v).toPrecision(5)]);
    out[iso] = Object.assign({ value: last[1], year: last[0] }, hist.length > 1 ? { hist } : null, extra && extra[iso]);
  }
  return out;
}

// percentiles over [iso, value][] sorted worst-first; tied values share the mean percentile of their
// run — vital for zero-heavy metrics like conflict deaths, where ~120 countries tie at 0
function tiePct(entries){
  const p = {}, n = entries.length;
  for (let i = 0; i < n;){
    let j = i;
    while (j + 1 < n && entries[j + 1][1] === entries[i][1]) j++;
    const v = n === 1 ? 100 : (i + j) / 2 / (n - 1) * 100;
    for (let k = i; k <= j; k++) p[entries[k][0]] = +v.toFixed(3);
    i = j + 1;
  }
  return p;
}

// M49/ISO-numeric -> ISO3, generated from Natural Earth ISO_N3/ISO_A3 properties (stable assignments);
// used by fao (zero-padded keys) and unctad (unpadded — callers padStart(3, '0'))
const M49_ISO3 = Object.fromEntries('004:AFG,008:ALB,012:DZA,024:AGO,028:ATG,031:AZE,032:ARG,036:AUS,040:AUT,044:BHS,048:BHR,050:BGD,051:ARM,052:BRB,056:BEL,064:BTN,068:BOL,070:BIH,072:BWA,076:BRA,084:BLZ,090:SLB,096:BRN,100:BGR,104:MMR,108:BDI,112:BLR,116:KHM,120:CMR,124:CAN,132:CPV,140:CAF,144:LKA,148:TCD,152:CHL,156:CHN,158:TWN,170:COL,174:COM,178:COG,180:COD,188:CRI,191:HRV,192:CUB,196:CYP,203:CZE,204:BEN,208:DNK,212:DMA,214:DOM,218:ECU,222:SLV,226:GNQ,231:ETH,232:ERI,233:EST,242:FJI,246:FIN,250:FRA,262:DJI,266:GAB,268:GEO,270:GMB,275:PSE,276:DEU,288:GHA,296:KIR,300:GRC,308:GRD,320:GTM,324:GIN,328:GUY,332:HTI,340:HND,344:HKG,348:HUN,352:ISL,356:IND,360:IDN,364:IRN,368:IRQ,372:IRL,376:ISR,380:ITA,384:CIV,388:JAM,392:JPN,398:KAZ,400:JOR,404:KEN,408:PRK,410:KOR,414:KWT,417:KGZ,418:LAO,422:LBN,426:LSO,428:LVA,430:LBR,434:LBY,440:LTU,442:LUX,446:MAC,450:MDG,454:MWI,458:MYS,462:MDV,466:MLI,470:MLT,478:MRT,480:MUS,484:MEX,496:MNG,498:MDA,499:MNE,504:MAR,508:MOZ,512:OMN,516:NAM,520:NRU,524:NPL,528:NLD,533:ABW,540:NCL,548:VUT,554:NZL,558:NIC,562:NER,566:NGA,578:NOR,583:FSM,584:MHL,585:PLW,586:PAK,591:PAN,598:PNG,600:PRY,604:PER,608:PHL,616:POL,620:PRT,624:GNB,626:TLS,630:PRI,634:QAT,642:ROU,643:RUS,646:RWA,659:KNA,662:LCA,670:VCT,674:SMR,678:STP,682:SAU,686:SEN,688:SRB,690:SYC,694:SLE,702:SGP,703:SVK,704:VNM,705:SVN,706:SOM,710:ZAF,716:ZWE,724:ESP,728:SSD,729:SDN,740:SUR,748:SWZ,752:SWE,756:CHE,760:SYR,762:TJK,764:THA,768:TGO,776:TON,780:TTO,784:ARE,788:TUN,792:TUR,795:TKM,798:TUV,800:UGA,804:UKR,807:MKD,818:EGY,826:GBR,834:TZA,840:USA,854:BFA,858:URY,860:UZB,862:VEN,882:WSM,887:YEM,894:ZMB'
  .split(',').map(p => p.split(':')));

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
    const out = {};
    for (const [key, code] of [['hale', 'WHOSIS_000002'], ['suicide', 'SDGSUICIDE']]){
      const j = JSON.parse(await getText(`https://ghoapi.azureedge.net/api/${code}?$filter=Dim1 eq 'SEX_BTSX'`));
      const acc = {};
      for (const r of j.value){
        if (r.SpatialDimType !== 'COUNTRY' || r.NumericValue == null) continue;
        (acc[r.SpatialDim] ??= {})[r.TimeDim] = r.NumericValue;
      }
      out[key] = pack(acc);
    }
    return out;
  },

  async bigmac(){
    const rows = parseCSV(await getText('https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-full-index.csv'));
    const acc = {};
    for (const r of rows) (acc[r.iso_a3] ??= {})[+r.date.slice(0, 4)] = +r.dollar_price; // rows chronological — last date in a year wins
    return { bigmac: pack(acc) };
  },

  async energy(){
    const rows = parseCSV(await getText('https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv'));
    const parts = { coal:'coal_share_energy', oil:'oil_share_energy', gas:'gas_share_energy',
      nuclear:'nuclear_share_energy', hydro:'hydro_share_energy', wind:'wind_share_energy',
      solar:'solar_share_energy', biofuel:'biofuel_share_energy', other:'other_renewables_share_energy' };
    const out = { mix: {} };
    const acc = { renewelec: {}, energypc: {} };
    for (const r of rows){
      if (r.iso_code.length !== 3) continue;
      const year = +r.year;
      const shares = {};
      for (const [k, col] of Object.entries(parts)) if (r[col] !== '') shares[k] = +r[col];
      if (Object.keys(shares).length && (!out.mix[r.iso_code] || year > out.mix[r.iso_code].year))
        out.mix[r.iso_code] = { value: shares, year };
      for (const [k, col] of [['renewelec', 'renewables_share_elec'], ['energypc', 'energy_per_capita']])
        if (r[col] !== '') (acc[k][r.iso_code] ??= {})[year] = +r[col];
    }
    for (const k of Object.keys(acc)) out[k] = pack(acc[k]);
    return out;
  },

  async co2(){
    const rows = parseCSV(await getText('https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv'));
    const cols = { co2:'co2', co2pc:'co2_per_capita', ghgpc:'ghg_per_capita', cumco2:'cumulative_co2', pop:'population' };
    const acc = Object.fromEntries(Object.keys(cols).map(k => [k, {}]));
    for (const r of rows){
      if (r.iso_code.length !== 3) continue;
      for (const [k, col] of Object.entries(cols))
        if (r[col] !== '') (acc[k][r.iso_code] ??= {})[+r.year] = +r[col];
    }
    return Object.fromEntries(Object.keys(cols).map(k => [k, pack(acc[k])]));
  },

  async warming(){
    const rows = parseCSV(await getText('https://ourworldindata.org/grapher/annual-temperature-anomalies.csv'));
    const acc = {};
    for (const r of rows){
      if ((r.Code || '').length !== 3 || r['Temperature anomaly'] === '') continue;
      (acc[r.Code] ??= {})[+r.Year] = +r['Temperature anomaly'];
    }
    return { warming: pack(acc) };
  },

  async oecd(){
    const macc = {}, munit = {}, hacc = {};
    let rows = parseCSV(await getText('https://sdmx.oecd.org/public/rest/data/OECD.WISE.INE,DSD_WISE_IDD@DF_IDD,1.0/.A.INC_DISP.MEDIAN.....?format=csvfilewithlabels&startPeriod=1990'));
    for (const r of rows){
      if (r.AGE !== '_T' || r.REF_AREA.length !== 3 || r.OBS_VALUE === '') continue;
      (macc[r.REF_AREA] ??= {})[+r.TIME_PERIOD] = +r.OBS_VALUE;
      munit[r.REF_AREA] = { unit: r.CURRENCY };
    }
    rows = parseCSV(await getText('https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0/.A.HPI_YDH_AVG.?format=csvfilewithlabels&startPeriod=1990'));
    for (const r of rows){
      if (r.MEASURE !== 'HPI_YDH_AVG' || r.REF_AREA.length !== 3 || r.OBS_VALUE === '') continue;
      (hacc[r.REF_AREA] ??= {})[+r.TIME_PERIOD.slice(0, 4)] = +r.OBS_VALUE;
    }
    // effective labour-market exit age — published men/women only, we store the mean of the two
    const racc = {};
    rows = parseCSV(await getText('https://sdmx.oecd.org/public/rest/data/OECD.ELS.SPD,DSD_PAG@DF_PAG,1.0/.A.ELMEA....?format=csvfilewithlabels&startPeriod=1990'));
    for (const r of rows){
      if (r.MEASURE !== 'ELMEA' || r.REF_AREA.length !== 3 || r.OBS_VALUE === '') continue;
      const y = ((racc[r.REF_AREA] ??= {})[+r.TIME_PERIOD] ??= []);
      y.push(+r.OBS_VALUE);
    }
    const retire = {};
    for (const [iso, ys] of Object.entries(racc))
      retire[iso] = Object.fromEntries(Object.entries(ys).map(([y, v]) => [y, +(v.reduce((a, b) => a + b) / v.length).toFixed(1)]));
    // time use survey — no time dimension in this flow, survey years differ per country
    const TU = { PAW:'paid work', UPW:'unpaid work', PCA:'personal care', LEI:'leisure', OTH:'other' };
    const timeuse = {}, leisure = {};
    rows = parseCSV(await getText('https://sdmx.oecd.org/public/rest/data/OECD.WISE.INE,DSD_TIME_USE@DF_TIME_USE,1.0/all?format=csvfilewithlabels'));
    for (const r of rows){
      if (r.SEX !== '_T' || r.REF_AREA.length !== 3 || r.OBS_VALUE === '' || !TU[r.MEASURE]) continue;
      ((timeuse[r.REF_AREA] ??= { value: {}, year: 'latest surveys' }).value)[TU[r.MEASURE]] = +(+r.OBS_VALUE / 14.4).toFixed(1); // min/day -> % of day
      if (r.MEASURE === 'LEI') leisure[r.REF_AREA] = { value: +(+r.OBS_VALUE).toFixed(0), year: 'latest surveys' };
    }
    return { medinc: pack(macc, munit), house: pack(hacc), retire: pack(retire), timeuse, leisure };
  },

  async eurostat(){
    // annual job vacancy rate, industry+construction+services (B-S), all firm sizes
    const GEO = { AT:'AUT', BE:'BEL', BG:'BGR', CH:'CHE', CY:'CYP', CZ:'CZE', DE:'DEU', DK:'DNK', EE:'EST',
      EL:'GRC', ES:'ESP', FI:'FIN', FR:'FRA', HR:'HRV', HU:'HUN', IE:'IRL', IS:'ISL', IT:'ITA', LT:'LTU',
      LU:'LUX', LV:'LVA', MK:'MKD', MT:'MLT', NL:'NLD', NO:'NOR', PL:'POL', PT:'PRT', RO:'ROU', SE:'SWE',
      SI:'SVN', SK:'SVK', TR:'TUR', UK:'GBR' };
    const rows = parseCSV(await getText('https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/jvs_a_rate_r2?format=SDMX-CSV&startPeriod=2008'));
    const acc = {};
    for (const r of rows){
      if (r.nace_r2 !== 'B-S' || r.sizeclas !== 'TOTAL' || r.unit !== 'AVG_A' || !GEO[r.geo] || r.OBS_VALUE === '') continue;
      (acc[GEO[r.geo]] ??= {})[+r.TIME_PERIOD] = +r.OBS_VALUE;
    }
    return { jvr: pack(acc) };
  },

  async owid(){
    const slugs = { hours:'annual-working-hours-per-worker', satisfaction:'happiness-cantril-ladder',
      democracy:'liberal-democracy-index', cpi:'ti-corruption-perception-index',
      confdeaths:'death-rate-in-armed-conflicts' }; // UCDP best estimate, all conflict types, per 100k
    const out = {};
    for (const [key, slug] of Object.entries(slugs)){
      const rows = parseCSV(await getText(`https://ourworldindata.org/grapher/${slug}.csv`));
      const col = Object.keys(rows[0])[3]; // grapher CSVs: Entity,Code,Year,<value>
      const acc = {};
      for (const r of rows){
        if ((r.Code || '').length !== 3 || r[col] === '') continue;
        (acc[r.Code] ??= {})[+r.Year] = +r[col];
      }
      out[key] = pack(acc);
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
    const out = {};
    for (const [key, url] of [
      ['bargain', 'https://sdmx.ilo.org/rest/data/ILO,DF_ILR_CBCT_NOC_RT/all?format=csv&startPeriod=1990'],
      ['weekhours', 'https://sdmx.ilo.org/rest/data/ILO,DF_HOW_TEMP_SEX_ECO_NB/.A..SEX_T.ECO_AGGREGATE_TOTAL?format=csv&startPeriod=1990'],
      ['informal', 'https://sdmx.ilo.org/rest/data/ILO,DF_EMP_NIFL_SEX_RT/.A..SEX_T?format=csv&startPeriod=1990'],
      ['neet', 'https://sdmx.ilo.org/rest/data/ILO,DF_EIP_NEET_SEX_RT/.A..SEX_T?format=csv&startPeriod=1990'],
    ]){
      const acc = {};
      for (const r of parseCSV(await getText(url))){
        if (r.REF_AREA.length !== 3 || r.OBS_VALUE === '') continue;
        (acc[r.REF_AREA] ??= {})[+r.TIME_PERIOD] = +r.OBS_VALUE;
      }
      out[key] = pack(acc);
    }
    return out;
  },

  // first-hand national statistics agencies; every entry carries its own src label
  async national(){
    const out = { unemp: {}, lfpr: {}, infl: {} };
    const put = (key, iso, src, value, year) => {
      if (value != null && !Number.isNaN(+value)) out[key][iso] = { value: +value, year, src };
    };

    // PxWeb POST (SCB / StatFin / PSA family); some servers prepend a BOM, some only speak the classic 'json' format
    const px = (url, query, fmt) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.map(([code, filter, values]) => ({ code, selection: { filter, values } })),
        response: { format: fmt || 'json-stat2' } }) }).then(r => r.text()).then(t => JSON.parse(t.replace(/^﻿/, '')));
    // latest non-null observation in a json-stat2 cube at a fixed selection, scanning timeDim backwards
    const latestObs = (j, timeDim, sel) => {
      const dims = j.id, stride = {};
      let s = 1;
      for (let i = dims.length - 1; i >= 0; i--){ stride[dims[i]] = s; s *= j.size[i]; }
      let base = 0;
      for (const [d, cat] of Object.entries(sel)) base += j.dimension[d].category.index[cat] * stride[d];
      const idx = j.dimension[timeDim].category.index;
      const time = Object.keys(idx).sort((a, b) => idx[a] - idx[b]);
      for (let t = time.length - 1; t >= 0; t--){
        const v = j.value[base + idx[time[t]] * stride[timeDim]];
        if (v != null) return [time[t], v];
      }
      return null;
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
      async insee(){ // France — ILO unemployment rate, SA, France excl. Mayotte (BDM série 001688527)
        const r = await fetch('https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/001688527?lastNObservations=1',
          { headers: { Accept: 'application/xml', 'Accept-Language': 'en' } });
        const m = (await r.text()).match(/TIME_PERIOD="([^"]+)" OBS_VALUE="([^"]+)"/);
        if (m) put('unemp', 'FRA', 'INSEE', m[2], m[1].replace('-Q', ' Q'));
      },
      async ssb(){ // Norway — LFS monthly, seasonally adjusted (table 13760)
        const r = await fetch('https://data.ssb.no/api/v0/en/table/13760/', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: [
            { code: 'Kjonn', selection: { filter: 'item', values: ['0'] } },
            { code: 'Alder', selection: { filter: 'item', values: ['15-74'] } },
            { code: 'Justering', selection: { filter: 'item', values: ['S'] } },
            { code: 'ContentsCode', selection: { filter: 'item', values: ['ArbledProsArbstyrk', 'ArbStyrkProsBefolkn'] } },
            { code: 'Tid', selection: { filter: 'top', values: ['6'] } }], response: { format: 'json-stat2' } }) });
        const j = await r.json();
        const tid = Object.keys(j.dimension.Tid.category.index);
        for (const [cc, key] of [['ArbledProsArbstyrk', 'unemp'], ['ArbStyrkProsBefolkn', 'lfpr']]){
          const ci = j.dimension.ContentsCode.category.index[cc];
          for (let t = tid.length - 1; t >= 0; t--){ // newest months can be unpublished (null)
            const v = j.value[ci * tid.length + t];
            if (v != null){ put(key, 'NOR', 'SSB', v, tid[t].replace('M', '-')); break; }
          }
        }
      },
      async istat(){ // Italy — monthly LFS, SA; data comes in editions, the latest reference month wins
        const grab = async flow => {
          const xml = await getText(`https://esploradati.istat.it/SDMXWS/rest/data/${flow}?lastNObservations=1`);
          let best = null;
          for (const m of xml.matchAll(/TIME_PERIOD" value="([^"]+)"\s*\/><generic:ObsValue value="([^"]+)"/g))
            if (!best || m[1] > best[1]) best = m;
          return best;
        };
        let b = await grab('151_874/M.IT.UNEM_R.Y.9.Y15-74.');
        if (b) put('unemp', 'ITA', 'Istat', b[2], b[1]);
        b = await grab('150_876/M.IT.ACT_R.Y.9.Y15-64.'); // ponytail: 15-64 basis (Istat's headline), WB's is 15+
        if (b) put('lfpr', 'ITA', 'Istat', b[2], b[1]);
      },
      async bbk(){ // Germany — registered unemployment rate, SA (Bundesagentur für Arbeit via Bundesbank)
        const r = await fetch('https://api.statistiken.bundesbank.de/rest/data/BBDL1/M.DE.Y.UNE.UBA000.A0000.A01.D00.0.R00.A?lastNObservations=1',
          { headers: { Accept: 'text/csv', 'Accept-Language': 'en' } });
        const t = await r.text(); // delimiter varies with content negotiation
        const o = parseCSV(t, t.slice(0, 200).includes('DATAFLOW;') ? ';' : ',').filter(x => x.OBS_VALUE !== '').at(-1);
        if (o) put('unemp', 'DEU', 'BA via Bundesbank', o.OBS_VALUE, o.TIME_PERIOD);
      },
      async scb(){ // Sweden — LFS monthly 15-74, seasonally adjusted
        const j = await px('https://api.scb.se/OV0104/v1/doris/en/ssd/START/AM/AM0401/AM0401A/AKURLBefM', [
          ['Arbetskraftstillh', 'item', ['ALÖSP', 'IAKRP']], ['TypData', 'item', ['SR_DATA']],
          ['Kon', 'item', ['1+2']], ['Alder', 'item', ['tot15-74']],
          ['ContentsCode', 'item', ['000007L9']], ['Tid', 'top', ['6']]]);
        for (const [code, key] of [['ALÖSP', 'unemp'], ['IAKRP', 'lfpr']]){
          const o = latestObs(j, 'Tid', { Arbetskraftstillh: code });
          if (o) put(key, 'SWE', 'SCB', o[1], o[0].replace('M', '-'));
        }
      },
      async statfin(){ // Finland — LFS monthly 15-74 unemployment rate, seasonally adjusted
        const j = await px('https://statfin.stat.fi/PXWeb/api/v1/en/StatFin/tyti/135z.px', [
          ['contentscode', 'item', ['Tyottaste_kausi']], ['timeperiod_m', 'top', ['6']]]);
        const o = latestObs(j, 'timeperiod_m', { contentscode: 'Tyottaste_kausi' });
        if (o) put('unemp', 'FIN', 'Statistics Finland', o[1], o[0].replace('M', '-'));
      },
      async dst(){ // Denmark — registered unemployed in % of labour force, SA (AUS08; DK's headline figure, not LFS)
        const r = await fetch('https://api.statbank.dk/v1/data', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table: 'AUS08', format: 'CSV', lang: 'en', variables: [
            { code: 'OMRÅDE', values: ['000'] }, { code: 'SAESONFAK', values: ['9'] }, { code: 'Tid', values: ['*'] }] }) });
        const o = parseCSV(await r.text(), ';').filter(x => x.INDHOLD && x.INDHOLD !== '..').at(-1);
        if (o) put('unemp', 'DNK', 'DST', o.INDHOLD.replace(',', '.'), o.TID.replace('M', '-'));
      },
      async cbsnl(){ // Netherlands — labour key figures 15-75, seasonally adjusted, quarterly (85224NED)
        // the endpoint ignores $orderby, so take everything SA and sort ourselves (~90 quarters, cheap)
        const j = await (await fetch(encodeURI("https://opendata.cbs.nl/ODataApi/odata/85224NED/TypedDataSet?$format=json&$filter=SeizoenEnWerkdagcorrectie eq 'A050903'"))).json();
        const row = j.value.filter(x => x.Werkloosheidspercentage_25 != null && x.Perioden.includes('KW'))
          .sort((a, b) => a.Perioden.localeCompare(b.Perioden)).at(-1);
        if (row){
          const yr = row.Perioden.replace(/KW0?/, ' Q');
          put('unemp', 'NLD', 'CBS', row.Werkloosheidspercentage_25, yr);
          put('lfpr', 'NLD', 'CBS', row.BrutoArbeidsparticipatie_30, yr); // bruto = labour force / population
        }
      },
      async ine(){ // Spain — EPA quarterly rates 16-74, national total, both sexes
        for (const [tbl, key, label] of [[65219, 'unemp', 'Unemployment rate'], [65081, 'lfpr', 'Activity rate']]){
          const series = JSON.parse(await getText(`https://servicios.ine.es/wstempus/js/EN/DATOS_TABLA/${tbl}?nult=1&tip=AM`));
          const s = series.find(x => x.Nombre.includes(label) && x.Nombre.includes('Both genders. Total'));
          const d = s && s.Data[0];
          if (d) put(key, 'ESP', 'INE', d.Valor, d.Anyo + ' ' + d.T3_Periodo);
        }
      },
      async cso(){ // Ireland — monthly SA unemployment rate 15-74 (MUM01)
        const j = JSON.parse(await getText('https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/MUM01/JSON-stat/2.0/en'));
        const o = latestObs(j, 'TLIST(M1)', { STATISTIC: 'MUM01C02', C02076V02508: '316', 'C02199V02655': '-' });
        if (o) put('unemp', 'IRL', 'CSO', o[1], o[0].slice(0, 4) + '-' + o[0].slice(4));
      },
      async singstat(){ // Singapore — overall unemployment rate, quarterly SA (Ministry of Manpower)
        const r = await fetch('https://tablebuilder.singstat.gov.sg/api/table/tabledata/M182342?limit=6&sortBy=key%20desc',
          { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
        const row = (await r.json()).Data.row.find(x => /Total Unemployment/.test(x.rowText));
        const c = row && row.columns.find(c => c.value != null && c.value !== '');
        if (c){ const p = c.key.split(' '); put('unemp', 'SGP', 'MOM via SingStat', c.value, p[0] + ' Q' + p[1][0]); }
      },
      async indec(){ // Argentina — EPH quarterly unemployment, 31 urban agglomerations; API serves a fraction
        const j = JSON.parse(await getText('https://apis.datos.gob.ar/series/api/series/?ids=45.2_ECTDT_0_T_33&limit=1&sort=desc'));
        const [date, v] = j.data[0];
        if (v != null) put('unemp', 'ARG', 'INDEC', v * 100, date.slice(0, 4) + ' Q' + (Math.floor(+date.slice(5, 7) / 3) + 1));
      },
      async psa(){ // Philippines — LFS key rates; Year ids are opaque, so read the table meta first
        const url = 'https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB/1B/LFS/0021B3FKEI2.px';
        const meta = JSON.parse(await getText(url));
        const yearVar = meta.variables.find(v => v.code === 'Year'), monthVar = meta.variables.find(v => v.code === 'Month');
        // ponytail: PSA's json-stat2 endpoint returns a broken 1-cell cube — classic 'json' rows work
        const j = await px(url, [['Year', 'item', yearVar.values.slice(-2)], ['Month', 'item', monthVar.values],
          ['Rates', 'item', ['2', '0']], ['Sex', 'item', ['0']]], 'json');
        const label = (v, code) => v.valueTexts[v.values.indexOf(code)];
        for (const [rate, key] of [['2', 'unemp'], ['0', 'lfpr']]){
          const o = j.data.filter(d => d.key[2] === rate && !isNaN(+d.values[0]))
            .sort((a, b) => (+a.key[0] - +b.key[0]) || (+a.key[1] - +b.key[1])).at(-1); // key = [Year, Month, Rates, Sex]
          if (o) put(key, 'PHL', 'PSA', o.values[0], label(yearVar, o.key[0]) + ' ' + label(monthVar, o.key[1]));
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

  // country outlines from Natural Earth 50m, quantized per country to {w, h, r:[flat x,y ints]}
  async outlines(){
    const j = JSON.parse(await getText('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'));
    const out = {};
    for (const f of j.features){
      const p = f.properties;
      const iso = p.ISO_A3 !== '-99' ? p.ISO_A3 : p.ADM0_A3; // France/Norway carry -99 in ISO_A3
      const g = f.geometry;
      let rings = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(poly => poly[0]); // outer rings only
      // antimeridian: shift west halves east so Russia/Fiji/NZ don't span the whole map
      const lons = rings.flat().map(pt => pt[0]);
      if (Math.max(...lons) - Math.min(...lons) > 180)
        rings = rings.map(r => r.map(([x, y]) => [x < 0 ? x + 360 : x, y]));
      const box = r => {
        let x0 = 1/0, x1 = -1/0, y0 = 1/0, y1 = -1/0;
        for (const [x, y] of r){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        return [x0, y0, x1, y1];
      };
      // ponytail: keep the largest landmass + neighbors within 1.5 diagonals — drops France's Réunion,
      // keeps Alaska/Hawaii; a proper "map units" dataset if someone misses a far territory
      const main = rings.reduce((a, b) => { const A = box(a), B = box(b);
        return (B[2] - B[0]) * (B[3] - B[1]) > (A[2] - A[0]) * (A[3] - A[1]) ? b : a; });
      const mb = box(main), mc = [(mb[0] + mb[2]) / 2, (mb[1] + mb[3]) / 2];
      const R = Math.max(15, Math.hypot(mb[2] - mb[0], mb[3] - mb[1]) * 1.5);
      rings = rings.filter(r => { const b = box(r); return Math.hypot((b[0] + b[2]) / 2 - mc[0], (b[1] + b[3]) / 2 - mc[1]) <= R; });
      // equirectangular with cos(midlat) x-scale, long side = 1000, y flipped for SVG
      const all = box(rings.flat());
      const cos = Math.cos((all[1] + all[3]) / 2 * Math.PI / 180);
      const s = 1000 / Math.max((all[2] - all[0]) * cos, all[3] - all[1], 1e-9);
      const q = rings.map(r => {
        const flat = []; let px, py;
        for (const [x, y] of r){
          const qx = Math.round((x - all[0]) * cos * s), qy = Math.round((all[3] - y) * s);
          if (qx !== px || qy !== py){ flat.push(qx, qy); px = qx; py = qy; }
        }
        return flat;
      }).filter(r => r.length >= 8); // <4 distinct points draws nothing worth keeping
      if (q.length) out[iso] = { w: Math.round((all[2] - all[0]) * cos * s) || 1, h: Math.round((all[3] - all[1]) * s) || 1, r: q };
    }
    return { outline: out };
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

  // public investment: general government gross fixed capital formation, % of GDP (IMF ICSD; ends 2019,
  // the Eurostat source on the card is fresher for Europe)
  async imf(){
    const acc = {};
    const r = await fetch('https://api.imf.org/external/sdmx/2.1/data/IMF.FAD,ICSD/.P51G_S13_Q_POGDP_PT.A',
      { headers: { Accept: 'text/csv' } });
    if (!r.ok) throw new Error('http ' + r.status);
    for (const row of parseCSV(await r.text())){
      if (row.COUNTRY.length !== 3 || row.OBS_VALUE === '') continue;
      (acc[row.COUNTRY] ??= {})[+row.TIME_PERIOD] = +(+row.OBS_VALUE).toFixed(2);
    }
    // current account % GDP from the WEO datamapper; WEO carries projections to ~2031 — keep completed years only
    const cab = {};
    const cutoff = new Date().getFullYear() - 1;
    const j = JSON.parse(await getText('https://www.imf.org/external/datamapper/api/v1/BCA_NGDPD'));
    for (const [iso, ys] of Object.entries(j.values.BCA_NGDPD)){
      if (iso.length !== 3) continue; // aggregates; 3-letter ones (AFQ …) never match WB isos downstream
      for (const [y, v] of Object.entries(ys)) if (+y <= cutoff && v != null) (cab[iso] ??= {})[+y] = v;
    }
    return { pubinv: pack(acc), cab: pack(cab) };
  },

  // export concentration (HHI over export products, 0..1): dependence on a few exports.
  // UNCTAD only serves 7z — needs a 7z binary (brew install sevenzip / apt p7zip-full)
  async unctad(){
    const r = await fetch('https://unctadstat-api.unctad.org/bulkdownload/US.ConcentDiversIndices/US_ConcentDiversIndices');
    if (!r.ok) throw new Error('http ' + r.status);
    const os = require('os'), cp = require('child_process');
    const tmp = path.join(os.tmpdir(), 'unctad-conc.7z');
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    const bin = ['7zz', '7za', '7z'].find(b => { try { cp.execSync(`command -v ${b}`); return true; } catch { return false; } });
    if (!bin) throw new Error('no 7z binary — brew install sevenzip');
    cp.execSync(`${bin} x -y "${tmp}" -o"${os.tmpdir()}"`, { stdio: 'ignore' });
    const acc = {};
    for (const row of parseCSV(fs.readFileSync(path.join(os.tmpdir(), 'US_ConcentDiversIndices.csv'), 'latin1'))){
      const iso = M49_ISO3[row.Economy.padStart(3, '0')];
      if (row.Flow !== '02' || !iso || row['Concentration Index'] === '') continue; // 02 = exports
      (acc[iso] ??= {})[+row.Year] = +row['Concentration Index'];
    }
    return { expconc: pack(acc) };
  },

  // food sovereignty from FAO's Suite of Food Security Indicators (bulk file; the API needs a key now).
  // FAO publishes 3-year averages — value keeps the honest "2021-2023" label, chart points sit on the middle year
  async fao(){
    const M49 = M49_ISO3;
    const r = await fetch('https://bulks-faostat.fao.org/production/Food_Security_Data_E_All_Data_(Normalized).zip');
    if (!r.ok) throw new Error('http ' + r.status);
    const tmp = path.join(require('os').tmpdir(), 'fao-fs.zip');
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    // ponytail: shells out to unzip (present on macOS/Linux); a js zip reader isn't worth a dependency
    const csv = require('child_process').execSync(`unzip -p "${tmp}" "Food_Security_Data_E_All_Data_(Normalized).csv"`,
      { maxBuffer: 1 << 28 }).toString('latin1');
    const ITEMS = { 21035: 'cereal', 21033: 'foodimp' };
    const acc = { cereal: {}, foodimp: {} }, label = { cereal: {}, foodimp: {} };
    for (const row of parseCSV(csv)){
      const key = ITEMS[row['Item Code']];
      const iso = M49[row['Area Code (M49)'].replace("'", '')];
      if (!key || !iso || row.Value === '') continue;
      const mid = Math.round((+row.Year.slice(0, 4) + +row.Year.slice(5)) / 2);
      acc[key][iso] = acc[key][iso] || {};
      acc[key][iso][mid] = +row.Value;
      label[key][iso] = label[key][iso] || {};
      label[key][iso][mid] = row.Year;
    }
    const out = {};
    for (const key of Object.values(ITEMS)){
      out[key] = pack(acc[key]);
      for (const [iso, d] of Object.entries(out[key])) d.year = label[key][iso][d.year]; // "2021-2023", not the midpoint
    }
    return out;
  },

  // third spaces (cafés, bars, pubs, libraries, community centres) counted live from OpenStreetMap.
  // ponytail: sequential + slow (big countries take minutes); refreshes each country monthly, keeps
  // last month's count on failure. OSM completeness varies by country — the card back says so.
  async osm(){
    const AMENITIES = ['cafe', 'bar', 'pub', 'library', 'community_centre'];
    const read = f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f))); } catch { return null; } };
    const old = (read('osm.json') || {}).third || {};
    const pop = (read('co2.json') || {}).pop || {};
    const wbc = JSON.parse(await getText('https://api.worldbank.org/v2/country?format=json&per_page=400'))[1]
      .filter(c => c.region.value !== 'Aggregates' && c.iso2Code.length === 2);
    const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
    const count = async (iso2, amenity, tries = 2) => { // out count; only ~200 bytes come back
      const q = `[out:json][timeout:300];area["ISO3166-1"="${iso2}"][admin_level=2]->.a;nwr(area.a)[amenity~"^(${amenity})$"];out count;`;
      let last = null;
      for (const url of ENDPOINTS){
        const r = await fetch(url, { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'state-of-the-nation-dashboard (weekly pipeline)' },
          body: 'data=' + encodeURIComponent(q),
          signal: AbortSignal.timeout(330000) }).catch(e => ({ ok: false, status: e.name || e.message })); // server query cap is 300s — don't hang past it
        last = r.status;
        if (!r.ok) continue; // busy or penalized — try the other instance
        const j = await r.json().catch(() => null);
        const el = j && j.elements && j.elements[0];
        if (el && el.tags) return +el.tags.total;
        if (j && /timed out/i.test(j.remark || '')) throw new Error(j.remark); // real timeout — caller splits per amenity
        last = (j && j.remark) || 'no count';
      }
      if (tries > 0){ await new Promise(res => setTimeout(res, 60000)); return count(iso2, amenity, tries - 1); }
      throw new Error(String(last).slice(0, 80));
    };
    const third = {}, cutoff = Date.now() - 30 * 864e5;
    let fresh = 0;
    for (const c of wbc){
      const prev = old[c.id];
      if (prev && prev.t > cutoff){ third[c.id] = prev; continue; } // counted within the month
      if (!pop[c.id]) continue; // no population -> no per-capita number
      let n = null;
      try { n = await count(c.iso2Code, AMENITIES.join('|')); }
      catch (e){
        if (/timed out/i.test(e.message)){ // big countries time out on the combined query — split per amenity and sum
          try {
            n = 0;
            for (const a of AMENITIES) n += await count(c.iso2Code, a);
          } catch (e2){ n = null; console.log(`  osm skip ${c.id} (${e2.message.slice(0, 60)})`); }
        }
        else console.log(`  osm skip ${c.id} (${e.message.slice(0, 60)})`);
      }
      if (n != null && n > 0){
        third[c.id] = { value: +(n / pop[c.id].value * 1e5).toFixed(1), year: new Date().getFullYear(), n, t: Date.now() };
        fresh++;
        fs.writeFileSync(path.join(__dirname, '..', 'data', 'osm.json'), // incremental save — a multi-hour run keeps partial progress
          JSON.stringify({ third: Object.assign({}, old, third) }));
      }
      else if (prev) third[c.id] = prev; // keep the stale count rather than dropping the country
      await new Promise(res => setTimeout(res, 2000)); // ponytail: politeness gap, overpass fair-use
    }
    console.log(`  osm refreshed ${fresh} countries`);
    return { third };
  },

  // reads other sources' output from data/ — keep last in SOURCES so a full run feeds it fresh files
  async derived(){
    const read = f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f))); } catch { return null; } };
    const owid = read('owid.json'), ilo = read('ilo.json'), who = read('who.json'),
      oecd = read('oecd.json'), co2 = read('co2.json'), warming = read('warming.json'),
      rsf = read('rsf.json'), energy = read('energy.json'), euro = read('eurostat.json'),
      imf = read('imf.json'), fao = read('fao.json'), unctad = read('unctad.json');

    // ponytail: days worked = annual hours ÷ (usual weekly hours ÷ 5); labeled as derived in the UI
    const daysworked = {};
    if (owid && ilo) for (const [iso, h] of Object.entries(owid.hours)){
      const w = ilo.weekhours[iso];
      if (!w) continue;
      const wh = Object.fromEntries(w.hist || [[w.year, w.value]]);
      const hist = (h.hist || [[h.year, h.value]]).filter(([y]) => wh[y] != null)
        .map(([y, v]) => [y, +(v / (wh[y] / 5)).toFixed(1)]);
      if (hist.length) daysworked[iso] = Object.assign(
        { value: hist.at(-1)[1], year: hist.at(-1)[0] }, hist.length > 1 ? { hist } : null);
      else daysworked[iso] = { value: h.value / (w.value / 5), year: Math.min(h.year, w.year) }; // no common year — latest of each
    }

    const countries = new Set(JSON.parse(await getText('https://api.worldbank.org/v2/country?format=json&per_page=400'))[1]
      .filter(c => c.region.value !== 'Aggregates').map(c => c.id));
    const wbBulk = async (ind, extra = '') => { // extra: e.g. '&source=3' — WGI indicators live in their own WB database
      const j = JSON.parse(await getText(`https://api.worldbank.org/v2/country/all/indicator/${ind}?format=json&mrnev=1&per_page=500${extra}`));
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
      co2: flat(co2 && co2.co2pc), ghgpc: flat(co2 && co2.ghgpc), cumco2: flat(co2 && co2.cumco2),
      renewelec: flat(energy && energy.renewelec), warm: flat(warming && warming.warming),
      days: Object.fromEntries(Object.entries(daysworked).filter(([k]) => countries.has(k)).map(([k, v]) => [k, v.value])),
      cba: flat(ilo && ilo.bargain), informal: flat(ilo && ilo.informal), neet: flat(ilo && ilo.neet),
      jvr: flat(euro && euro.jvr), leisure: flat(oecd && oecd.leisure),
      pubinv: flat(imf && imf.pubinv), cereal: flat(fao && fao.cereal), foodimp: flat(fao && fao.foodimp),
      confdeaths: flat(owid && owid.confdeaths), polstab: await wbBulk('GOV_WGI_PV.SC', '&source=3'),
      trade: await wbBulk('NE.TRD.GNFS.ZS'), energyimp: await wbBulk('EG.IMP.CONS.ZS'),
      expconc: flat(unctad && unctad.expconc),
    };
    const pct = (key, dir) => { // iso -> percentile 0..100, 100 = best for the working class; ties share
      const e = Object.entries(vals[key] || {}).filter(([, v]) => v != null && isFinite(v))
        .sort((a, b) => dir === 'lo' ? b[1] - a[1] : a[1] - b[1]); // worst first
      return tiePct(e);
    };

    // per-metric ranks for the cards' rank strips: {n, dir, map:{ISO: rank}}
    const RANKED = { unemp:'lo', lfpr:'hi', gdppc:'hi', pli:'lo', oop:'lo', house:'lo',
      hale:'hi', suicide:'lo', hours:'lo', happy:'hi', vdem:'hi', cpi:'hi', press:'hi',
      co2:'lo', ghgpc:'lo', cumco2:'lo', renewelec:'hi', warm:'lo', days:'lo', cba:'hi', school:'hi',
      informal:'lo', jvr:'hi', leisure:'hi', neet:'lo', pubinv:'hi', cereal:'lo', foodimp:'lo',
      confdeaths:'lo', polstab:'hi', trade:'lo', energyimp:'lo', expconc:'lo' };
    const ranks = {};
    for (const [key, dir] of Object.entries(RANKED)){
      const e = Object.entries(vals[key] || {}).filter(([, v]) => v != null && isFinite(v))
        .sort((a, b) => dir === 'lo' ? a[1] - b[1] : b[1] - a[1]); // best first
      if (e.length < 2) continue;
      const map = {}; // ISO3 -> [rank, value]; equal values share a rank (competition style) — most countries tie at 0 conflict deaths
      e.forEach(([iso, v], i) => map[iso] = [i > 0 && v === e[i - 1][1] ? map[e[i - 1][0]][0] : i + 1, +Number(v).toPrecision(5)]);
      ranks[key] = { n: e.length, dir, map };
    }

    // working-class rating: mean percentile across six pillars, each the mean percentile of its inputs
    const PILLARS = [
      ['col', 'Cost of living', 'price level · home price vs income', 'WB · OECD', [['pli','lo'], ['house','lo']]],
      ['earn', 'Earning opportunity', 'jobs · participation · output per person', 'WB', [['unemp','lo'], ['lfpr','hi'], ['gdppc','hi']]],
      ['edu', 'Education', 'expected years in school', 'WB', [['school','hi']]],
      ['svc', 'Service costs', 'out-of-pocket share of health spending', 'WHO via WB', [['oop','lo']]],
      ['health', 'Health outcomes', 'healthy life expectancy · suicide', 'WHO', [['hale','hi'], ['suicide','lo']]],
      ['time', 'Time kept', 'hours and days worked per year', 'OWID · derived', [['hours','lo'], ['days','lo']]],
      // one hard event count (UCDP battle deaths) + one perception composite (WGI) — neither stands alone
      ['peace', 'Peace & stability', 'conflict deaths · political stability', 'UCDP · WGI', [['confdeaths','lo'], ['polstab','hi']]],
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
      if (ps.length >= Math.ceil(PILLARS.length * 2 / 3)) // two-thirds of pillars or unrated — a 4-of-7 country would skip the hard ones and float up
        scored.push([iso, ps.reduce((a, b) => a + b) / ps.length]);
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

    // last run's ranks, kept so the UI can show week-over-week movement; same-day reruns keep the same _prev
    const old = read('derived.json');
    const today = new Date().toISOString().slice(0, 10);
    let _prev = old && old._prev;
    if (old && old._date && old._date !== today) _prev = {
      date: old._date,
      rating: Object.fromEntries(Object.entries(old.rating).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, v.rank])),
      ranks: Object.fromEntries(Object.entries(old.ranks).map(([k, v]) =>
        [k, Object.fromEntries(Object.entries(v.map).map(([iso, r]) => [iso, r[0]]))])),
    };
    return Object.assign({ _date: today }, _prev ? { _prev } : null, { daysworked, ranks, rating });
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
      console.log('ok  ', name, Object.entries(data).filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => `${k}:${Object.keys(v).length}`).join(' '));
    } catch (e){
      failed++;
      console.error('FAIL', name, e.message);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { parseCSV, tiePct };
