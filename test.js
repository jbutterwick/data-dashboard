// run: node test.js
const assert = require('assert');
eval(require('fs').readFileSync(__dirname + '/app.js', 'utf8')); // ponytail: no bundler, direct eval; DOM code is guarded

assert.strictEqual(fmtPct(5.25), '5.3%');
assert.strictEqual(fmtUSD(81695.19), '$81,695');
assert.strictEqual(fmtNum(334900000), '334.9M');
assert.strictEqual(mergeOrder(['b', 'gone'], ['a', 'b']).join(), 'b,a');
assert.strictEqual(mergeOrder([], ['a', 'b']).join(), 'a,b');
assert(new Set(METRICS.map(m => m.id)).size === METRICS.length, 'duplicate metric id');
const srcs = [{label:'a'}, {label:'b'}, {label:'c'}];
assert.deepStrictEqual(srcOrder(srcs, 'b').map(s => s.label), ['b', 'a', 'c']);
assert.deepStrictEqual(srcOrder(srcs, 'nope').map(s => s.label), ['a', 'b', 'c']);
assert.strictEqual(ord(1), '1st'); assert.strictEqual(ord(2), '2nd');
assert.strictEqual(ord(11), '11th'); assert.strictEqual(ord(23), '23rd'); assert.strictEqual(ord(70), '70th');
assert(chartSVG([[2000, 1], [2010, 2]]).includes('<polyline'));
assert.strictEqual(chartSVG([[2000, 1]]), '');                       // one point = no chart
assert(!chartSVG([[2000, 5], [2010, 5]]).includes('NaN'));           // flat series must not divide by zero
assert(chartSVG([[2000, 1], [2010, 2]], [[2000, 3], [2010, 4]]).match(/<polyline/g).length === 2); // compare line drawn

assert(outlineSVG({w:100, h:50, r:[[0, 0, 100, 0, 100, 50]]}).includes('M0 0L100 0L100 50Z'));
assert(outlineSVG({w:200, h:1000, r:[[0, 0, 1, 1]]}).includes('height="120"')); // tall country scales by height
assert(outlineSVG({w:1000, h:100, r:[[0, 0, 1, 1]]}).includes('width="320"'));  // wide country caps at 320
assert.strictEqual(outlineSVG(null), '');
assert(outlineSVG({w:100, h:100, r:[[0, 0, 1, 1]]}, 78, 'cmpmap').includes('class="cmpmap"'));
assert(rankDelta(5, 3).includes('↑2') && rankDelta(5, 3).includes('up'));
assert(rankDelta(3, 5).includes('↓2') && rankDelta(3, 5).includes('dn'));
assert.strictEqual(rankDelta(4, 4), '');
assert.strictEqual(rankDelta(undefined, 4), ''); // no previous run yet

// cached(): fresh hit skips the fetcher, stale/missing calls it and stores
(async () => {
  const store = { m: {}, getItem(k){ return this.m[k] ?? null; }, setItem(k, v){ this.m[k] = v; } };
  let calls = 0;
  const fetcher = () => Promise.resolve(++calls);
  assert.strictEqual(await cached('k', fetcher, store), 1);       // miss — fetches
  assert.strictEqual(await cached('k', fetcher, store), 1);       // fresh — cached value, no fetch
  assert.strictEqual(calls, 1);
  store.m['c:k'] = JSON.stringify({ t: Date.now() - 9e7, v: 1 }); // >24h old
  assert.strictEqual(await cached('k', fetcher, store), 2);       // stale — refetches
  store.m['c:k'] = 'not json';
  assert.strictEqual(await cached('k', fetcher, store), 3);       // corrupt entry — refetches
  console.log('ok');
})();

const { parseCSV, tiePct } = require(__dirname + '/pipeline/fetch.js');
// ties share the mean percentile of their run; extremes still span 0..100
const tp = tiePct([['a', 5], ['b', 3], ['c', 3], ['d', 3], ['e', 0]]); // worst first
assert.strictEqual(tp.a, 0);
assert.strictEqual(tp.b, tp.c); assert.strictEqual(tp.c, tp.d); assert.strictEqual(tp.b, 50); // mean of positions 1,2,3
assert.strictEqual(tp.e, 100);
assert.strictEqual(tiePct([['x', 1]]).x, 100);
const rows = parseCSV('a,b\n"x,1","he said ""hi""\nnext"\n2,3\n');
assert.strictEqual(rows.length, 2);
assert.strictEqual(rows[0].a, 'x,1');
assert.strictEqual(rows[0].b, 'he said "hi"\nnext');
assert.strictEqual(rows[1].b, '3');
assert.strictEqual(parseCSV('a;b\n1;2\n', ';')[0].b, '2'); // final 'ok' printed by the async cache check
