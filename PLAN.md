# Plan: State of the Nation dashboard

Goal: at-a-glance working-class prosperity per country — health, wealth, freedom, enjoyment.

## Architecture (stays lazy)

The app stays a static site. The only addition is `pipeline/fetch.js` — a plain
Node script (no deps) run weekly by cron, which downloads CSVs/spreadsheets/keyed
APIs and writes them as `data/<source>.json` next to the app. The app reads two
kinds of metrics:

- **live**: fetched client-side from CORS-friendly APIs (World Bank, WHO GHO)
- **cached**: fetched from local `data/*.json` produced by the pipeline

Metric schema grows: `sources` (an ordered list — first entry that has data for
the selected country wins, see Phase 6), `coverage` (which countries have it —
cards hide, not error, when a country lacks data), `better` (up/down, needed
for the composite score and for coloring deltas).

No database, no server process. Cron + static files is the whole backend.

**Source pluralism (core principle).** No aggregator is treated as the
authority — not World Bank, not WHO. Every metric can carry multiple sources;
the default order is national agency → international aggregator, and the user
can switch a card's source (click its provenance badge, pick from whatever has
data for that country; choice persisted). Every card always shows whose number
it is, with a link. Worth knowing: much WB data is itself republished national
submissions, so going first-hand often means the same figure at its origin —
what you gain is provenance, freshness, and the ability to compare when
sources disagree. Disagreement between sources is signal, not a bug; the UI
should make it visible, not hide it.

## Phase 2 — more live metrics (no pipeline needed, ~1 session)

All World Bank / WHO, same fetch path as today:

| Metric | Source |
|---|---|
| Poverty rate ($6.85/day) | WB `SI.POV.UMIC` |
| Out-of-pocket health spending % | WB `SH.XPD.OOPC.CH.ZS` |
| Youth not in employment/education (NEET) | WB `SL.UEM.NEET.ZS` |
| Homicide rate | WB `VC.IHR.PSRC.P5` |
| Air pollution (PM2.5 exposure) | WB `EN.ATM.PM25.MC.M3` |
| Internet users % | WB `IT.NET.USER.ZS` |
| Cost-of-living level (price level index, US=100) | WB `PA.NUS.PRVT.PLI` (`PA.NUS.PPPC.RF` is archived) |

WHO metrics (healthy life expectancy `WHOSIS_000002`, suicide rate
`SDGSUICIDE`) verified good but the GHO API sends no CORS headers, so they
move to the Phase 3 pipeline. Sex dimension is `SEX_BTSX`.

Also: verify each code with `curl` before shipping (the fossil-fuel indicator
taught us WB series go stale silently).

## Phase 3 — the pipeline + cached sources (~2–3 sessions)

**Status: shipped** — `pipeline/fetch.js` with 6 sources (who, bigmac, energy,
co2, warming, oecd) → `data/*.json`, 8 new cached metrics in the app.
Notes from the field: OECD SDMX 500s on big/back-to-back queries (narrow
`startPeriod`, filter the key, retry once); FAOSTAT replaced by OWID's
grapher CSV for temperature anomalies (simpler, has CORS).
Deferred: **LISEP** (publishes xlsx only — when we do it, add the `xlsx`
package rather than hand-rolling zip+xml); **IUCN** (you must register a free
API key at api.iucnredlist.org — registration is an account creation, so
that step is yours); **OECD migration** (with the Phase 6 OECD adapter).

`pipeline/fetch.js`: fetch → parse CSV (one ~15-line parser, quoted-field aware)
→ normalize to `{ISO3: {value, year}}` → write JSON. One function per source.

| Brief item | Real source | Notes |
|---|---|---|
| Meal cost | **Big Mac Index** — TheEconomist/big-mac-data on GitHub, free CSV | Also compute "minutes of work at local wages to afford one" — more telling than the price. Numbeo's restaurant-meal data is paid; revisit only if you buy access. |
| Median wages | **OECD median equivalised disposable income** (free SDMX API, ~40 countries); ILOSTAT average earnings as wider-coverage fallback | True median wage data simply doesn't exist for most countries. |
| Median home price | **OECD house price-to-income ratio** | No free global source for absolute prices; the ratio answers the real question (can a worker afford a home) better anyway. |
| LISEP TRU / SEP / true weekly earnings | LISEP spreadsheets from lisep.org | **US-only — LISEP publishes no other country.** First use of per-country `coverage`; cards appear only when country = USA. |
| Energy source shares | **OWID energy-data** (github, free CSV) | Full mix: coal/oil/gas/nuclear/hydro/wind/solar. Rendered as one stacked bar card. |
| CO₂ (richer) | **OWID co2-data** | Total + per-capita + trend; replaces/augments the WB single number. |
| Climate data | **FAOSTAT temperature-change API** (free) | "°C warmer than 1951–80 baseline" per country — the most visceral climate stat. |
| Recently extinct species | **IUCN Red List API v4** (free key required) | Extinct/EW species linked to the country + count of threatened species. Key lives in env var on the machine running cron, never in the client. |
| Immigration (permanent vs temporary) | **OECD International Migration Database** | Permanent-type inflows + temporary worker migration, OECD members only; everyone else keeps WB net migration. |

## Phase 4 — my suggested metrics (fit the "rewarding to live in" thesis)

**Status: shipped** — 8 new metrics (annual hours, derived days worked,
collective bargaining, life satisfaction, press freedom, corruption
perceptions, liberal democracy, prosperity score) via 4 new pipeline sources
(owid graphers, rsf, ilo, derived). Annual hours came from OWID/PWT (through
2023, 130 countries) instead of OECD — wider coverage, same adapter pattern.
Field note: ILO's SDMX server 500s on node-fetch's default
`Accept-Language: *` header; `getText` now sends `Accept-Language: en`.
Deferred: **statutory days off** (OECD Family Database is PDF/xlsx tables),
**Big Mac minutes** (needs comparable hourly wages — revisit with ILO
earnings data in the Phase 6 adapter work).

Work & time:
- **Annual hours worked per worker** (OECD) — the leisure-time metric
- **Average days worked per year** (computed) — nobody publishes this directly;
  derive it as annual hours ÷ (usual weekly hours ÷ 5), both from OECD/ILOSTAT.
  Labeled as derived. Pair it with **statutory days off** (minimum paid leave +
  public holidays, OECD Family Database / WageIndicator), which IS first-hand
  law rather than an estimate.
- **Collective bargaining coverage %** (OECD/ILOSTAT) — worker power
- **Big Mac minutes** (computed: Big Mac price ÷ hourly wage) — meal affordability in one number

Freedom & society:
- **Press Freedom Index** (RSF, free CSV)
- **Corruption Perceptions Index** (Transparency International, free download)
- **Liberal Democracy Index** (V-Dem, free dataset — EIU's Democracy Index is not freely licensed)

Enjoyment:
- **Life satisfaction** (World Happiness Report, free data) — the closest thing to directly measuring "enjoy your life"

Composite:
- **Working-Class Prosperity Score** — mean of percentile ranks across the
  pillars (wages, affordability, health, hours, freedom, satisfaction).
  Computed in the pipeline for all countries at once so a country's score is
  comparable. Clearly labeled as this dashboard's own opinionated index.

## Phase 5 — UI/customization from the brief (~1–2 sessions)

**Status: shipped** — folders on the dashboard (collapsible, state persisted),
card resize (hover ⤢ cycles 1–3 column spans), sparklines from full WB history
(one request, no extra call), 5 theme presets + custom accent color, compare
country (neutral "vs XYZ" line per card), settings export/import, no-data
cards hidden per country. Verified in headless Chrome: 39 cards render for
USA; Germany-vs-France compare + solarized theme screenshot checked.
Sparklines are WB-metrics-only until the pipeline stores history.

- **Window placement**: card sizes S/M/L via grid `span` (drag already reorders).
  Free-form x/y placement stays skipped — grid reflow beats absolute positioning
  on every screen size; revisit only if grid genuinely can't express a layout you want.
- **Themes**: 4–5 preset palettes (CSS variable sets) + custom accent color via
  `<input type="color">`.
- **Folders on the dashboard**: collapsible category sections mirroring the
  settings folders; per-country availability hides empty cards.
- **Sparklines**: tiny inline SVG from the last ~15 years (WB API already
  returns history if we drop `mrnev=1`); no chart library.
- **Compare mode**: second country as a small delta under each value.
- Settings export/import as a JSON file (it's just `localStorage.dash`).

## Phase 6 — first-hand national sources (~1 session per adapter batch)

**Status: architecture + first two adapters shipped.** Every metric now
carries an ordered source list (national-first); cards resolve down the list,
show provenance, and a ⇄ button switches among sources with data (choice
persisted per metric). Live so far:
- **Eurostat** (live client-side — their API sends CORS): unemployment,
  inflation (HICP), Gini, median income (EUR), life expectancy, for EU27 +
  EFTA + TR. Notably fresher than aggregators (2025 vs WB's 2024/2023).
- **FRED** (pipeline, needs `FRED_API_KEY` env var — free registration at
  fred.stlouisfed.org is a you-step): US unemployment, participation, and
  **median home price** (`MSPUS` — the brief's metric, US-only for now).
  Pipeline skips it gracefully without the key.
- **OWID CO₂ per capita** added as an alternate to the WB figure — first
  place to see two sources disagree on the same card.
**Keyless national adapters shipped** (pipeline `national` source →
`data/national.json`; each entry carries its own agency label):
- **StatCan** (Canada): unemployment + participation, LFS vectors 2062815/6
- **ONS** (UK): unemployment, activity rate, CPI — via the website's
  `<series page>/data` JSON (the api.ons.gov.uk API was retired Nov 2024)
- **ABS** (Australia): unemployment + participation, `LF/M13|M12.3.1599.20.AUS.M`
- **IBGE** (Brazil): PNAD unemployment + IPCA 12-month inflation
All monthly and ~2 years fresher than WB annual figures. Sub-adapters fail
independently; one agency down doesn't drop the others.
**NBS China / Rosstat**: `data/snapshots.json` — hand-maintained, merged only
where no live adapter answers; entries carry their own src + date. Empty until
someone transcribes figures from stats.gov.cn / rosstat.gov.ru — never
fabricate them.
**Still needing keys you must register** (each is account creation — a
you-step; wiring after that is minutes per agency): INEGI (Mexico),
KOSIS (Korea), BPS (Indonesia), e-Stat (Japan), plus FRED above and IUCN
from Phase 3.
Field notes: Eurostat geo codes aren't ISO (EL=Greece); dimension names vary
per dataset (`statinfo` vs `indic_il`) — always probe with curl first.

Prefer each country's own statistical agency over aggregators wherever an
adapter exists. Mechanics: each metric's `sources` list is ordered
national → harmonized (OECD/Eurostat) → World Bank; the pipeline (or live
fetch) takes the first that answers. Cards show the source name and a
**national / harmonized** badge so it's always clear whose number you're seeing.

Adapter roster, in order of leverage:

| Adapter | Covers | Why |
|---|---|---|
| **Eurostat API** | 27+ EU/EFTA countries | One free API, data submitted by each national statistics institute — the closest thing to 30 first-hand sources for the price of one adapter. |
| **FRED API** (free key) | USA | One clean API fronting BLS, BEA, and Census series — unemployment, participation, wages, home prices (Case-Shiller), CPI. Fresher than WB by ~a year. |
| **Statistics Canada API** | Canada | Free, JSON, good coverage. |
| **ONS API** | UK | Free, JSON. |
| **ABS API** | Australia | Free SDMX. |
| **e-Stat API** (free key) | Japan | Free key; Japanese field names, worth it once the pattern exists. |
| **IBGE SIDRA API** | Brazil | Free, good JSON API. |
| **INEGI API** (free key) | Mexico | Free key. |
| **KOSIS API** (free key) | South Korea | Free key. |
| **BPS API** (free key) | Indonesia | Free key. |
| **data.gov.in** (free key) | India | Coverage varies by dataset. |
| **NBS China / Rosstat** | China, Russia | No stable public APIs — periodic CSV snapshots via the pipeline, clearly dated. |

Non-aggregator international sources worth adding to the switcher too:
ILOSTAT (ILO), FAOSTAT (FAO), UN DESA — UN-system rather than
Bretton-Woods, and often the origin of what WB republishes.

Caveat that keeps us honest: national figures use national definitions
(unemployment especially), so they're for **display**. The composite
prosperity score keeps using harmonized data only, otherwise cross-country
ranks are apples-to-oranges.

Everyone outside the roster keeps World Bank/OECD data; add adapters
country-by-country as demand appears rather than up front.

## Explicitly not doing

- Numbeo scraping (ToS + fragile), EIU Democracy Index (licensing),
  absolute median home prices (no source), any framework/bundler/database
  (nothing above needs one).

## Phase 7 — visual redesign + working-class rating (shipped)

**Status: shipped.** Design iterated as a standalone mockup (Console × Isotype
hybrid, Catppuccin), then ported into the app:

- **Look**: Catppuccin role tokens in `style.css` (mocha default, latte light);
  themes are one redefined token block each. Jost for display, IBM Plex Mono
  for data. Console topbar, Isotype masthead, category sections with accent
  bars. Custom accent picker recolors charts and unit squares via `--accent`.
- **Cards are chart-first**: full source history since 1990 (area line +
  compare overlay, from the WB hist the app already fetched), source+year chip
  is the ⇄ swap button (disabled when only one source), and a rank strip —
  ten Isotype squares = the whole field, filled = share of nations ranking
  worse, direction spelled out ("fewest jobless first").
- **Working-Class Rating** replaced the old 6-input prosperity score
  (`pipeline/fetch.js` derived step): mean percentile across six pillars from
  the user's criteria — cost of living (PLI + OECD house), earning opportunity
  (unemp, LFPR, GDP pc PPP), education (school life expectancy), service costs
  (OOP health share), health outcomes (HALE, suicide), time kept (hours, days
  worked). ≥4 pillars required; 192 nations rated (DEU 1st 79.6, USA 35th
  62.7, HTI last 16.9). Masthead band shows the score, rank, wins/losses,
  per-pillar strips with inputs + sources, and the methodology line.
- **Ranks**: derived.json now carries `ranks` (18 metrics, {n, dir, map}) and
  `rating` ({value, year, rank, p} per ISO3 + `_pillars/_top/_bottom/_n` meta).

Known metric caveats (flagged for review): service-costs pillar uses
out-of-pocket share, which flatters insurance-heavy systems (USA 84); education
is quantity (expected years) not quality; cost-of-living's house input covers
only ~24 OECD countries.

**Rankings view (shipped)**: topbar Dashboard/Rankings toggle. Sort every
nation by the working-class rating or any of the 18 ranked metrics, best or
worst first, with a name filter; rows show rank, value, and percentile strip;
clicking a row opens that country's dashboard. derived.json ranks now store
[rank, value] pairs to feed it.
