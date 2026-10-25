const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/classify.js'), 'utf8');
const classifyEmail = new Function(src + '\nreturn classifyEmail;')();
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-emails.json'), 'utf8'));

let pass = 0;
const rows = [];
for (const s of samples) {
  const r = classifyEmail({ fromAddress: s.from, subject: s.subject, body: s.body });
  const ok = r.category === s.expected;
  if (ok) pass++;
  rows.push({ id: s.id, subject: s.subject, expected: s.expected, got: r.category,
    confidence: r.confidence, details: r.details, matchedKeywords: r.matchedKeywords, pass: ok });
}
const out = { ranAt: new Date().toISOString(), total: samples.length, passed: pass, results: rows };
fs.writeFileSync(path.join(__dirname, 'test-results.json'), JSON.stringify(out, null, 2));
let md = '| # | Subject | Expected | Got | Confidence | Extracted | Pass |\n|---|---|---|---|---|---|---|\n';
for (const r of rows) {
  const d = Object.entries(r.details).map(([k, v]) => `${k}: ${v}`).join(', ') || '–';
  md += `| ${r.id} | ${r.subject} | ${r.expected} | ${r.got} | ${r.confidence} | ${d} | ${r.pass ? '✅' : '❌'} |\n`;
}
md += `\n**${pass}/${samples.length} passed**\n`;
fs.writeFileSync(path.join(__dirname, 'test-results.md'), md);
console.log(md);
process.exit(pass === samples.length ? 0 : 1);
