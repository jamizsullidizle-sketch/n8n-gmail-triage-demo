// Runs the ACTUAL jsCode from the Code node inside n8n-triage-workflow.json with a mocked $input,
// using Gmail-Trigger-shaped items (simple=false output format).
const fs = require('fs'); const path = require('path');
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '../n8n-triage-workflow.json'), 'utf8'));
const node = wf.nodes.find(n => n.name === 'Classify (keyword rules)');
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-emails.json'), 'utf8'));
const items = samples.map((s, i) => ({ json: { id: 'msg' + s.id, threadId: 'thr' + s.id, date: '2026-10-25T09:0' + i + ':00.000Z',
  subject: s.subject, text: s.body, from: { value: [{ address: s.from, name: s.from.split('@')[0] }], text: s.from } }, pairedItem: { item: i } }));
const $input = { all: () => items };
const run = new Function('$input', node.parameters.jsCode);
const out = run($input);
let ok = out.length === samples.length;
out.forEach((o, i) => { if (o.json.category !== samples[i].expected) ok = false; });
console.log(JSON.stringify(out.slice(0, 2).map(o => o.json), null, 2));
console.log(ok ? `CODE NODE OK: ${out.length} items, all categories match` : 'CODE NODE MISMATCH');
process.exit(ok ? 0 : 1);
