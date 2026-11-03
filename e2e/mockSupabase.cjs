// In-memory stand-in for Supabase (auth, REST and the ai-tutor function) for browser tests.
const BASE = 'http://localhost:54321';
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function matches(row, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns'].includes(k)) continue;
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
    if (v === 'is.null' && row[k] != null) return false;
    if (v.startsWith('gte.') && !(String(row[k]) >= v.slice(4))) return false;
  }
  return true;
}

async function installMock(page, db, { user, aiReply }) {
  const log = { inserts: [], functionCalls: [] };
  const session = { access_token: 'test-token', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
  await page.addInitScript((s) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s)), session);
  await page.route(`${BASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.pathname.startsWith('/auth/v1/')) return json(url.pathname.endsWith('/user') ? user : session);
    if (url.pathname === '/functions/v1/ai-tutor') {
      const body = JSON.parse(req.postData() || '{}');
      log.functionCalls.push(body);
      const result = aiReply(body, db);
      if (result.status) return json(result.body, result.status);
      db.ai_interactions.push(result.interaction);
      return json({ response: result.interaction.response, placeholder: false, interaction: result.interaction });
    }
    const table = url.pathname.replace('/rest/v1/', '');
    db[table] = db[table] || [];
    const params = [...url.searchParams.entries()];
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const embed = (r) => (table === 'sessions' && (url.searchParams.get('select') || '').includes('task:tasks') ? { ...r, task: db.tasks.find((t) => t.id === r.task_id) } : r);
    const reply = (rows) => {
      if (!wantsObject) return json(rows.map(embed));
      if (rows.length === 0) return json({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' }, 406);
      return json(embed(rows[0]));
    };
    if (method === 'GET' || method === 'HEAD') {
      let rows = db[table].filter((r) => matches(r, params));
      const limit = Number(url.searchParams.get('limit') || 0);
      if (limit) rows = rows.slice(0, limit);
      return reply(rows);
    }
    if (method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const items = (Array.isArray(body) ? body : [body]).map((b) => ({ id: uid(), created_at: new Date().toISOString(), timestamp: new Date().toISOString(), started_at: new Date().toISOString(), ...b }));
      db[table].push(...items);
      log.inserts.push(...items.map((i) => ({ table, row: i })));
      return reply(items);
    }
    if (method === 'PATCH') {
      const body = JSON.parse(req.postData() || '{}');
      const rows = db[table].filter((r) => matches(r, params));
      for (const r of rows) Object.assign(r, body);
      return reply(rows);
    }
    return json([]);
  });
  return log;
}

module.exports = { installMock, uid };
