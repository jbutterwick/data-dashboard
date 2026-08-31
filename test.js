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

const { parseCSV } = require(__dirname + '/pipeline/fetch.js');
const rows = parseCSV('a,b\n"x,1","he said ""hi""\nnext"\n2,3\n');
assert.strictEqual(rows.length, 2);
assert.strictEqual(rows[0].a, 'x,1');
assert.strictEqual(rows[0].b, 'he said "hi"\nnext');
assert.strictEqual(rows[1].b, '3');
assert.strictEqual(parseCSV('a;b\n1;2\n', ';')[0].b, '2');
console.log('ok');
