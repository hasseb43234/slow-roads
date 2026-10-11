// Usage: node bump.cjs 4   -> sets the asset version in index.html and sw.js so browsers fetch fresh files
const fs = require('fs');
const v = process.argv[2];
if (!v || !/^\d+$/.test(v)) { console.log('Give a version number, for example: node bump.cjs 4'); process.exit(1); }
let h = fs.readFileSync('index.html', 'utf8').replace(/\?v=\d+/g, '?v=' + v);
fs.writeFileSync('index.html', h);
let s = fs.readFileSync('sw.js', 'utf8').replace(/const V = '\d+';/, "const V = '" + v + "';");
fs.writeFileSync('sw.js', s);
console.log('Asset version is now ' + v);
