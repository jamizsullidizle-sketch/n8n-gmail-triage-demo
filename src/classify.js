// ---- Keyword triage rules (shared by the n8n Code node and the local test) ----
// Edit these lists to tune the triage. Order of CATEGORY_RULES = priority on ties.
const CATEGORY_RULES = {
  'Spam-Other': [
    'unsubscribe', 'newsletter', 'seo services', 'guest post', 'backlinks', 'crypto',
    'bitcoin', 'you have won', 'lottery', 'limited time offer', 'act now', 'viagra',
    'rank #1 on google', 'webinar invitation', 'no-reply', 'noreply'
  ],
  'Billing': [
    'invoice', 'receipt', 'payment', 'refund', 'charged', 'charge', 'billing',
    'subscription', 'order #', 'order number', 'overdue', 'credit note', 'vat',
    'rechnung', 'zahlung'
  ],
  'Consultancy': [
    'quote', 'quotation', 'proposal', 'consulting', 'consultation', 'consultancy',
    'project', 'audit', 'migration', 'rollout', 'pricing for', 'how much would',
    'interested in your services', 'hire you', 'book a call', 'discovery call',
    'angebot', 'beratung'
  ],
  'Support': [
    'not working', "can't", 'cannot', 'error', 'broken', 'help', 'how do i', 'how to',
    'issue', 'problem', 'stopped', 'password', 'login', 'locked out', 'reset',
    'not receiving', 'bounce', 'printer', 'vpn', 'outlook', 'urgent', 'down',
    'funktioniert nicht', 'fehler', 'hilfe'
  ]
};

// Words in the subject count double: subjects are short and usually say what the email is.
const SUBJECT_WEIGHT = 2;

function countHits(haystack, keywords) {
  const hits = [];
  for (const kw of keywords) {
    if (haystack.includes(kw)) hits.push(kw);
  }
  return hits;
}

function extractDetails(text) {
  const details = {};
  const inv = text.match(/\b(?:invoice|inv|rechnung)\s*(?:no\.?|number|nr\.?|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i);
  if (inv) details.invoiceNumber = inv[1];
  const ord = text.match(/\border\s*(?:no\.?|number|nr\.?|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{2,})/i);
  if (ord) details.orderNumber = ord[1];
  const amt = text.match(/(?:€|\$|£|EUR|USD|GBP)\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)|(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s?(?:€|EUR)/i);
  if (amt) details.amount = (amt[0] || '').trim();
  return details;
}

function classifyEmail({ fromAddress = '', subject = '', body = '' }) {
  const s = String(subject).toLowerCase();
  const b = String(body).toLowerCase();
  const f = String(fromAddress).toLowerCase();

  const scores = {};
  const matched = {};
  for (const [cat, kws] of Object.entries(CATEGORY_RULES)) {
    const subjHits = countHits(s, kws);
    const bodyHits = countHits(b + ' ' + f, kws);
    scores[cat] = subjHits.length * SUBJECT_WEIGHT + bodyHits.length;
    matched[cat] = [...new Set([...subjHits, ...bodyHits])];
  }

  // Pick the highest score; ties are broken by the order of CATEGORY_RULES above.
  let category = 'Spam-Other';
  let best = 0;
  for (const cat of Object.keys(CATEGORY_RULES)) {
    if (scores[cat] > best) { best = scores[cat]; category = cat; }
  }
  // Nothing matched at all -> treat as Support so a human still sees it (safer than hiding it as spam).
  const confidence = best === 0 ? 'none' : best >= 3 ? 'high' : 'low';
  if (best === 0) category = 'Support';

  return {
    category,
    confidence,
    needsHumanReview: confidence !== 'high',
    scores,
    matchedKeywords: matched[category] || [],
    details: extractDetails(subject + '\n' + body)
  };
}
