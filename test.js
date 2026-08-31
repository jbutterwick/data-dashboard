// run: node test.js
const assert = require('assert');
eval(require('fs').readFileSync(__dirname + '/app.js', 'utf8')); // ponytail: no bundler, direct eval; DOM code is guarded

assert.strictEqual(fmtPct(5.25), '5.3%');
assert.strictEqual(fmtUSD(81695.19), '$81,695');
assert.strictEqual(fmtNum(334900000), '334.9M');
assert.strictEqual(mergeOrder(['b', 'gone'], ['a', 'b']).join(), 'b,a');
assert.strictEqual(mergeOrder([], ['a', 'b']).join(), 'a,b');
assert(new Set(METRICS.map(m => m.id)).size === METRICS.length, 'duplicate metric id');
assert.strictEqual(sparkPoints([1, 2]), '0.0,22.0 100.0,2.0');
const srcs = [{label:'a'}, {label:'b'}, {label:'c'}];
assert.deepStrictEqual(srcOrder(srcs, 'b').map(s => s.label), ['b', 'a', 'c']);
assert.deepStrictEqual(srcOrder(srcs, 'nope').map(s => s.label), ['a', 'b', 'c']);
assert.strictEqual(sparkPoints([5, 5]), '0.0,22.0 100.0,22.0'); // flat series must not divide by zero

const { parseCSV } = require(__dirname + '/pipeline/fetch.js');
const rows = parseCSV('a,b\n"x,1","he said ""hi""\nnext"\n2,3\n');
assert.strictEqual(rows.length, 2);
assert.strictEqual(rows[0].a, 'x,1');
assert.strictEqual(rows[0].b, 'he said "hi"\nnext');
assert.strictEqual(rows[1].b, '3');
assert.strictEqual(parseCSV('a;b\n1;2\n', ';')[0].b, '2');
console.log('ok');
