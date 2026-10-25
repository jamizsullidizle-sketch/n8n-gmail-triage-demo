// Builds n8n-triage-workflow.json so the Code node uses EXACTLY the same classify.js that the tests run.
const fs = require('fs');
const path = require('path');
const classifySrc = fs.readFileSync(path.join(__dirname, 'classify.js'), 'utf8');

const GMAIL_CRED = { gmailOAuth2: { id: 'REPLACE_WITH_GMAIL_CREDENTIAL_ID', name: 'Gmail account (set me)' } };
const SHEETS_CRED = { googleSheetsOAuth2Api: { id: 'REPLACE_WITH_SHEETS_CREDENTIAL_ID', name: 'Google Sheets account (set me)' } };
const SLACK_CRED = { slackOAuth2Api: { id: 'REPLACE_WITH_SLACK_CREDENTIAL_ID', name: 'Slack account (set me)' } };
const RETRY = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 };
const SHEET_ID = 'REPLACE_WITH_GOOGLE_SHEET_ID';
const C = "$('Classify (keyword rules)').item.json";

let n = 0;
const id = () => `a1b2c3d4-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const nodes = [];
const add = (node) => { nodes.push({ id: id(), ...node }); return node.name; };

// ---------- Main flow ----------
add({ name: 'Gmail Trigger – new email', type: 'n8n-nodes-base.gmailTrigger', typeVersion: 1.2, position: [0, 300],
  parameters: { pollTimes: { item: [{ mode: 'everyMinute' }] }, simple: false,
    filters: { q: '-from:me -label:triage-done', labelIds: [] }, options: {} },
  credentials: GMAIL_CRED,
  notes: 'Polls every minute. Set Label IDs to watch only the shared inbox / a specific label. "-from:me" stops the bot re-processing its own mail.' });

add({ name: 'Skip already-processed emails', type: 'n8n-nodes-base.removeDuplicates', typeVersion: 2, position: [220, 300],
  parameters: { operation: 'removeItemsSeenInPreviousExecutions', logic: 'removeItemsWithAlreadySeenKeyValues',
    dedupeValue: '={{ $json.id }}', options: { historySize: 10000 } },
  notes: 'Duplicate protection: the Gmail message ID is remembered across runs, so a re-poll or retry never logs/drafts twice.' });

const wrapper = `
// ---- n8n wrapper: map Gmail Trigger fields -> classifier -> clean output ----
const out = [];
for (const item of $input.all()) {
  const m = item.json;
  const sender = (m.from && m.from.value && m.from.value[0]) || {};
  const body = m.text || m.textAsHtml || m.snippet || '';
  const r = classifyEmail({ fromAddress: sender.address || '', subject: m.subject || '', body });
  out.push({ json: {
    messageId: m.id,
    threadId: m.threadId,
    receivedAt: m.date || new Date().toISOString(),
    fromName: sender.name || '',
    fromEmail: sender.address || '',
    subject: m.subject || '(no subject)',
    snippet: String(body).slice(0, 300),
    category: r.category,
    confidence: r.confidence,
    needsHumanReview: r.needsHumanReview,
    matchedKeywords: r.matchedKeywords.join(', '),
    invoiceNumber: r.details.invoiceNumber || '',
    orderNumber: r.details.orderNumber || '',
    amount: r.details.amount || '',
    classifiedBy: 'keywords'
  }, pairedItem: item.pairedItem });
}
return out;
`;
add({ name: 'Classify (keyword rules)', type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 300],
  parameters: { jsCode: classifySrc + '\n' + wrapper },
  notes: 'Keyword rules + invoice/order/amount extraction. Same code as src/classify.js (tested in tests/).' });

add({ name: '[OPTIONAL] LLM classify (OpenAI)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [660, 300], disabled: true,
  parameters: { method: 'POST', url: 'https://api.openai.com/v1/chat/completions', authentication: 'predefinedCredentialType',
    nodeCredentialType: 'openAiApi', sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' }, messages: [ { role: 'system', content: 'Classify this email for an IT support & consultancy business. Reply as JSON {"category": "Support|Consultancy|Billing|Spam-Other", "invoiceNumber": "", "orderNumber": "", "amount": ""}.' }, { role: 'user', content: 'Subject: ' + $json.subject + '\\n\\n' + $json.snippet } ] }) }}`,
    options: {} },
  credentials: { openAiApi: { id: 'REPLACE_WITH_OPENAI_CREDENTIAL_ID', name: 'OpenAI account (optional)' } },
  ...RETRY, onError: 'continueRegularOutput',
  notes: 'OPTIONAL – disabled by default. Enable this and the next node to let an LLM decide the category. If the API fails, the keyword result is kept.' });

add({ name: '[OPTIONAL] Use LLM answer if valid', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 300], disabled: true,
  parameters: { jsCode: `// Merge the LLM answer into the keyword result; fall back to keywords on any problem.
const allowed = ['Support', 'Consultancy', 'Billing', 'Spam-Other'];
return $input.all().map((item, i) => {
  const base = $('Classify (keyword rules)').all()[i].json;
  try {
    const llm = JSON.parse(item.json.choices[0].message.content);
    if (allowed.includes(llm.category)) {
      return { json: { ...base, category: llm.category, classifiedBy: 'llm',
        invoiceNumber: base.invoiceNumber || llm.invoiceNumber || '',
        orderNumber: base.orderNumber || llm.orderNumber || '',
        amount: base.amount || llm.amount || '' } };
    }
  } catch (e) { /* keep keyword result */ }
  return { json: base };
});` } });

const rule = (cat) => ({
  conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: id(), leftValue: '={{ $json.category }}', rightValue: cat, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and' },
  renameOutput: true, outputKey: cat });
add({ name: 'Route by category', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [1100, 300],
  parameters: { rules: { values: ['Support', 'Consultancy', 'Billing', 'Spam-Other'].map(rule) }, options: {} } });

const label = (name, labelId, y) => add({ name, type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [1340, y],
  parameters: { operation: 'addLabels', messageId: `={{ ${C}.messageId }}`, labelIds: [labelId, 'REPLACE_WITH_LABEL_ID_triage-done'] },
  credentials: GMAIL_CRED, ...RETRY });
label('Label: Support', 'REPLACE_WITH_LABEL_ID_triage-support', 0);
label('Label: Consultancy', 'REPLACE_WITH_LABEL_ID_triage-consultancy', 220);
label('Label: Billing', 'REPLACE_WITH_LABEL_ID_triage-billing', 440);
label('Label: Spam-Other', 'REPLACE_WITH_LABEL_ID_triage-spam-other', 660);

add({ name: 'Draft acknowledgement (NOT sent)', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [1580, 0],
  parameters: { resource: 'draft', subject: `=Re: {{ ${C}.subject }}`, emailType: 'text',
    message: `=Hi {{ ${C}.fromName || 'there' }},\n\nThanks for getting in touch. We've received your request and logged it, and a team member will get back to you shortly.\n\nIf it's urgent, just reply to this email with "URGENT" and a phone number.\n\nBest regards,\nThe Support Team`,
    options: { threadId: `={{ ${C}.threadId }}`, sendTo: `={{ ${C}.fromEmail }}` } },
  credentials: GMAIL_CRED, ...RETRY,
  notes: 'Creates a Gmail DRAFT in the same thread. A person reviews and clicks Send – nothing goes out automatically.' });

const cols = (extra) => ({ mappingMode: 'defineBelow', matchingColumns: ['messageId'], schema: [], value: {
  messageId: `={{ ${C}.messageId }}`, receivedAt: `={{ ${C}.receivedAt }}`, fromName: `={{ ${C}.fromName }}`,
  fromEmail: `={{ ${C}.fromEmail }}`, subject: `={{ ${C}.subject }}`, category: `={{ ${C}.category }}`,
  confidence: `={{ ${C}.confidence }}`, ...extra } });

add({ name: 'Log request (Requests sheet)', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: [1820, 220],
  parameters: { operation: 'appendOrUpdate',
    documentId: { __rl: true, mode: 'id', value: SHEET_ID }, sheetName: { __rl: true, mode: 'name', value: 'Requests' },
    columns: cols({ invoiceNumber: `={{ ${C}.invoiceNumber }}`, orderNumber: `={{ ${C}.orderNumber }}`,
      amount: `={{ ${C}.amount }}`, needsHumanReview: `={{ ${C}.needsHumanReview }}`, status: 'open' }), options: {} },
  credentials: SHEETS_CRED, ...RETRY,
  notes: 'Append-or-update keyed on messageId = a second guard against duplicate rows.' });

add({ name: 'Add lead (Leads sheet)', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: [1580, 220],
  parameters: { operation: 'appendOrUpdate',
    documentId: { __rl: true, mode: 'id', value: SHEET_ID }, sheetName: { __rl: true, mode: 'name', value: 'Leads' },
    columns: { mappingMode: 'defineBelow', matchingColumns: ['messageId'], schema: [], value: {
      messageId: `={{ ${C}.messageId }}`, name: `={{ ${C}.fromName }}`, email: `={{ ${C}.fromEmail }}`,
      subject: `={{ ${C}.subject }}`, date: `={{ ${C}.receivedAt }}` } }, options: {} },
  credentials: SHEETS_CRED, ...RETRY });

add({ name: 'Notify team on Slack (new lead)', type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: [1820, 0],
  parameters: { authentication: 'oAuth2', select: 'channel', channelId: { __rl: true, mode: 'name', value: '#new-leads' },
    text: `=:briefcase: New consultancy inquiry\n*From:* {{ ${C}.fromName }} <{{ ${C}.fromEmail }}>\n*Subject:* {{ ${C}.subject }}\n> {{ ${C}.snippet }}`,
    otherOptions: {} },
  credentials: SLACK_CRED, ...RETRY,
  notes: 'Swap for a Gmail "Send" node if the team prefers an email alert.' });

// ---------- Follow-up reminders ----------
add({ name: 'Every weekday 09:00', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 1000],
  parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * 1-5' }] } } });
add({ name: 'Find triaged threads older than 2 days', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [220, 1000],
  parameters: { resource: 'thread', operation: 'getAll', limit: 50,
    filters: { q: '{label:triage-support label:triage-consultancy label:triage-billing} older_than:2d newer_than:30d -label:triage-reminded' } },
  credentials: GMAIL_CRED, ...RETRY,
  notes: 'Change "older_than:2d" to set the X days before a reminder.' });
add({ name: 'Get full thread', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [440, 1000],
  parameters: { resource: 'thread', operation: 'get', threadId: '={{ $json.id }}', simple: true, options: {} },
  credentials: GMAIL_CRED, ...RETRY });
add({ name: 'Keep only unanswered', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 1000],
  parameters: { jsCode: `// A thread counts as answered if any message in it carries Gmail's SENT label (i.e. we replied).
const out = [];
for (const item of $input.all()) {
  const t = item.json;
  const msgs = t.messages || [];
  const answered = msgs.some(m => (m.labelIds || []).includes('SENT'));
  if (!answered && msgs.length) {
    const first = msgs[0];
    out.push({ json: { threadId: t.id, subject: first.Subject || first.subject || '(no subject)',
      from: first.From || first.from || '', snippet: first.snippet || '', messages: msgs.length } });
  }
}
return out;` } });
add({ name: 'Remind team on Slack', type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: [880, 1000],
  parameters: { authentication: 'oAuth2', select: 'channel', channelId: { __rl: true, mode: 'name', value: '#support' },
    text: '=:alarm_clock: No reply after 2+ days\n*From:* {{ $json.from }}\n*Subject:* {{ $json.subject }}\nhttps://mail.google.com/mail/u/0/#all/{{ $json.threadId }}',
    otherOptions: {} },
  credentials: SLACK_CRED, ...RETRY });
add({ name: 'Label thread: reminded', type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position: [1100, 1000],
  parameters: { resource: 'thread', operation: 'addLabels', threadId: "={{ $('Keep only unanswered').item.json.threadId }}",
    labelIds: ['REPLACE_WITH_LABEL_ID_triage-reminded'] },
  credentials: GMAIL_CRED, ...RETRY,
  notes: 'Prevents the same thread being reminded every day.' });

// ---------- Sticky notes ----------
const sticky = (name, content, pos, w, h, color) => add({ name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: pos,
  parameters: { content, width: w, height: h, color } });
sticky('Note: overview', '## Inbound request triage\nGmail → dedupe → classify → label → draft / log / notify.\nNothing is ever sent to a customer automatically: replies are **drafts** for review.', [-40, -220], 520, 180, 4);
sticky('Note: optional LLM', '### OPTIONAL – LLM classifier\nDisabled by default (keyword rules work without any AI cost). Enable both nodes to let OpenAI pick the category; on failure it falls back to the keyword result.', [620, 120], 440, 340, 3);
sticky('Note: reminders', '## Follow-up reminders\nWeekdays 09:00: find triaged threads with no reply after 2 days → Slack reminder → label so it only fires once.', [-40, 820], 520, 160, 5);
sticky('Note: errors', '### Error handling\n• Retries (3× / 5 s) on every Gmail/Sheets/Slack node\n• Message-ID dedupe + append-or-update in Sheets\n• Failed runs → import n8n-triage-error-handler.json and set it as this workflow\'s Error Workflow', [1340, 820], 520, 200, 2);

// ---------- Connections ----------
const conn = {};
const link = (from, ...outs) => { conn[from] = { main: outs.map(o => (o ? [].concat(o).map(t => ({ node: t, type: 'main', index: 0 })) : [])) }; };
link('Gmail Trigger – new email', 'Skip already-processed emails');
link('Skip already-processed emails', 'Classify (keyword rules)');
link('Classify (keyword rules)', '[OPTIONAL] LLM classify (OpenAI)');
link('[OPTIONAL] LLM classify (OpenAI)', '[OPTIONAL] Use LLM answer if valid');
link('[OPTIONAL] Use LLM answer if valid', 'Route by category');
link('Route by category', 'Label: Support', 'Label: Consultancy', 'Label: Billing', 'Label: Spam-Other');
link('Label: Support', 'Draft acknowledgement (NOT sent)');
link('Draft acknowledgement (NOT sent)', 'Log request (Requests sheet)');
link('Label: Consultancy', 'Add lead (Leads sheet)');
link('Add lead (Leads sheet)', ['Notify team on Slack (new lead)', 'Log request (Requests sheet)']);
link('Label: Billing', 'Log request (Requests sheet)');
link('Every weekday 09:00', 'Find triaged threads older than 2 days');
link('Find triaged threads older than 2 days', 'Get full thread');
link('Get full thread', 'Keep only unanswered');
link('Keep only unanswered', 'Remind team on Slack');
link('Remind team on Slack', 'Label thread: reminded');

const wf = { id: 'gmTriageDemo0001', name: 'Gmail inbound request triage (demo)', nodes, connections: conn, active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true, errorWorkflow: 'gmTriageErrHdl01' }, pinData: {}, meta: { templateCredsSetupCompleted: false },
  tags: [] };
fs.writeFileSync(path.join(__dirname, '../n8n-triage-workflow.json'), JSON.stringify(wf, null, 2));

const err = { id: 'gmTriageErrHdl01', name: 'Triage – error handler', active: false, settings: { executionOrder: 'v1' }, pinData: {},
  nodes: [
    { id: 'e0000000-0000-4000-8000-000000000001', name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { id: 'e0000000-0000-4000-8000-000000000002', name: 'Alert on Slack', type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: [240, 0],
      parameters: { authentication: 'oAuth2', select: 'channel', channelId: { __rl: true, mode: 'name', value: '#automation-alerts' },
        text: '=:warning: Workflow *{{ $json.workflow.name }}* failed\nNode: {{ $json.execution.lastNodeExecuted }}\nError: {{ $json.execution.error.message }}\n{{ $json.execution.url }}', otherOptions: {} },
      credentials: SLACK_CRED, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 } ],
  connections: { 'Error Trigger': { main: [[{ node: 'Alert on Slack', type: 'main', index: 0 }]] } } };
fs.writeFileSync(path.join(__dirname, '../n8n-triage-error-handler.json'), JSON.stringify(err, null, 2));
console.log('nodes:', nodes.length, 'written');
