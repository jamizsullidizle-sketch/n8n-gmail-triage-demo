// Builds a throwaway workflow: Manual Trigger -> sample Gmail items -> the real Classify node code.
const fs = require('fs'); const path = require('path');
const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '../n8n-triage-workflow.json'), 'utf8'));
const cls = wf.nodes.find(n => n.name === 'Classify (keyword rules)');
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-emails.json'), 'utf8'));
const items = samples.map(s => ({ id: 'msg' + s.id, threadId: 'thr' + s.id, subject: s.subject, text: s.body, from: { value: [{ address: s.from, name: s.from.split('@')[0] }] } }));
const t = { id: 'gmTriageTest0001', name: 'Triage classifier test', active: false, settings: { executionOrder: 'v1' }, pinData: {},
  nodes: [
    { id: 't1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 't2', name: 'Sample Gmail items', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0], parameters: { jsCode: 'return ' + JSON.stringify(items) + '.map(j => ({ json: j }));' } },
    { ...cls, id: 't3', position: [400, 0] } ],
  connections: { Start: { main: [[{ node: 'Sample Gmail items', type: 'main', index: 0 }]] }, 'Sample Gmail items': { main: [[{ node: 'Classify (keyword rules)', type: 'main', index: 0 }]] } } };
fs.writeFileSync('/tmp/n8n-exec-test.json', JSON.stringify(t));
