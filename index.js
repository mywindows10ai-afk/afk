const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');

// ================= ENV SOZLAMALARI =================
const ADMIN_PASS = process.env.ADMIN_PASS || '778899';
const MC_HOST = process.env.MC_HOST || 'frokamc.uz';
const MC_PORT = Number(process.env.MC_PORT || 25565);
const MC_VERSION = process.env.MC_VERSION || '1.21.11';
// Masalan: "uzbekman:123,ozbekafk:123,eshshaksikar:123"
const INITIAL_ACCOUNTS = process.env.INITIAL_ACCOUNTS || '';
// ===================================================

const DATA_FILE = path.join('/tmp', 'accounts.json');
const bots = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomDelay = (min = 200, max = 500) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

function saveAccountsToDisk() {
  try {
    const list = Array.from(bots.values()).map((b) => ({
      username: b.username,
      password: b.password
    }));
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.log('[SAVE ERROR]', err.message);
  }
}

function buildEnvString() {
  return Array.from(bots.values())
    .map((b) => `${b.username}:${b.password}`)
    .join(',');
}

function loadInitialAccounts() {
  const loaded = new Map();

  if (INITIAL_ACCOUNTS.trim()) {
    for (const pair of INITIAL_ACCOUNTS.split(',')) {
      const idx = pair.indexOf(':');
      if (idx > 0) {
        const u = pair.slice(0, idx).trim();
        const p = pair.slice(idx + 1).trim();
        if (u && p) loaded.set(u, p);
      }
    }
  }

  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item && item.username && item.password) {
            const u = String(item.username).trim();
            const p = String(item.password).trim();
            if (!loaded.has(u)) loaded.set(u, p);
          }
        }
      }
    }
  } catch (err) {
    console.log('[LOAD ERROR]', err.message);
  }

  return loaded;
}

function cleanupTimers(state) {
  if (state.antiAfkInterval) {
    clearInterval(state.antiAfkInterval);
    state.antiAfkInterval = null;
  }
  if (state.reconnectTimeout) {
    clearTimeout(state.reconnectTimeout);
    state.reconnectTimeout = null;
  }
}

function scheduleReconnect(state, reason) {
  if (state.stopped || state.isReconnecting) return;
  state.isReconnecting = true;
  state.status = `Qayta ulanmoqda (${reason})`;
  cleanupTimers(state);

  state.reconnectTimeout = setTimeout(() => {
    state.isReconnecting = false;
    if (!state.stopped) connectBot(state);
  }, 35000);
}

function parseReason(reason) {
  if (!reason) return 'Uzildi';
  if (typeof reason === 'string') return reason.slice(0, 70);
  if (reason.text) return String(reason.text).slice(0, 70);
  if (Array.isArray(reason.extra)) {
    const txt = reason.extra.map((x) => (typeof x === 'string' ? x : x.text || '')).join('');
    if (txt) return txt.slice(0, 70);
  }
  return JSON.stringify(reason).slice(0, 70);
}

function connectBot(state) {
  if (state.stopped) return;
  cleanupTimers(state);
  state.status = 'Ulanmoqda...';

  let bot;
  try {
    bot = mineflayer.createBot({
      host: MC_HOST,
      port: MC_PORT,
      username: state.username,
      version: MC_VERSION
    });
  } catch (err) {
    console.log(`[CREATE ERROR:${state.username}]`, err.message);
    scheduleReconnect(state, err.message);
    return;
  }

  state.bot = bot;
  let authSent = false;

  function runAuthAndServer(isRegister = false) {
    if (authSent || state.stopped || !bot || !bot.entity) return;
    authSent = true;

    if (isRegister) {
      state.status = 'Register yuborilmoqda...';
      bot.chat(`/register ${state.password} ${state.password}`);
    } else {
      state.status = 'Login yuborilmoqda...';
      bot.chat(`/login ${state.password}`);
    }

    setTimeout(() => {
      if (!state.stopped && state.bot === bot && bot.entity) {
        try {
          bot.chat('/server anarxiya2');
          state.status = 'Online (anarxiya2)';
        } catch (err) {
          console.log(`[SERVER CMD ERROR:${state.username}]`, err.message);
        }
      }
    }, 6000);
  }

  bot.once('spawn', () => {
    console.log(`[BOT:${state.username}] Spawn bo'ldi.`);
    state.status = 'Lobbyda (kutilmoqda)';

    setTimeout(() => {
      runAuthAndServer(false);
    }, 6000);

    state.antiAfkInterval = setInterval(() => {
      if (!bot.entity || state.stopped) return;
      try {
        const yaw = bot.entity.yaw + (Math.random() * 0.4 - 0.2);
        const pitch = Math.max(
          -0.5,
          Math.min(0.5, bot.entity.pitch + (Math.random() * 0.2 - 0.1))
        );
        bot.look(yaw, pitch, false).catch(() => {});
        bot.setControlState('jump', true);
        setTimeout(() => {
          if (bot && bot.entity) {
            bot.setControlState('jump', false);
          }
        }, randomDelay(200, 500));
      } catch (_) {}
    }, 45000);
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim();
    if (!text) return;
    console.log(`[CHAT:${state.username}]`, text);

    const lower = text.toLowerCase();
    if (!authSent) {
      if (lower.includes('/register') || lower.includes('/ʀᴇɢɪsᴛᴇʀ')) {
        setTimeout(() => runAuthAndServer(true), 2000);
      } else if (lower.includes('/login') || lower.includes('/ʟᴏɢɪɴ')) {
        setTimeout(() => runAuthAndServer(false), 2000);
      }
    }
  });

  bot.on('kicked', (reason) => {
    const msg = parseReason(reason);
    console.log(`[KICKED:${state.username}]`, msg);
    state.bot = null;
    scheduleReconnect(state, `Kick: ${msg}`);
  });

  bot.on('end', (reason) => {
    console.log(`[END:${state.username}]`, reason || 'Uzildi');
    state.bot = null;
    scheduleReconnect(state, reason || 'Uzildi');
  });

  bot.on('error', (err) => {
    console.log(`[ERROR:${state.username}]`, err.message);
    scheduleReconnect(state, `Xato: ${err.message}`);
  });
}

function addAccount(username, password) {
  const cleanUser = String(username || '').trim();
  const cleanPass = String(password || '').trim();
  if (!cleanUser || !cleanPass) return false;

  if (bots.has(cleanUser)) {
    removeAccount(cleanUser, false);
  }

  const state = {
    username: cleanUser,
    password: cleanPass,
    bot: null,
    status: 'Boshlanmoqda...',
    stopped: false,
    isReconnecting: false,
    antiAfkInterval: null,
    reconnectTimeout: null
  };

  bots.set(cleanUser, state);
  saveAccountsToDisk();
  connectBot(state);
  return true;
}

function removeAccount(username, save = true) {
  const state = bots.get(username);
  if (!state) return false;
  state.stopped = true;
  cleanupTimers(state);
  if (state.bot) {
    try {
      state.bot.quit();
    } catch (_) {}
  }
  bots.delete(username);
  if (save) saveAccountsToDisk();
  return true;
}

async function reconnectAllSequential() {
  for (const state of bots.values()) {
    if (state.stopped) continue;
    if (state.bot) {
      try { state.bot.quit(); } catch (_) {}
      state.bot = null;
    }
    state.isReconnecting = false;
    connectBot(state);
    await sleep(7000);
  }
}

(async () => {
  const initial = loadInitialAccounts();
  for (const [u, p] of initial.entries()) {
    addAccount(u, p);
    await sleep(7000);
  }
})();

// ================= WEB BOSHQARUV PANELI =================
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AFK Bot Boshqaruv Paneli</title>
<style>
  * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
  body { background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; display: flex; justify-content: center; }
  .container { width: 100%; max-width: 760px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  h1, h2 { margin-top: 0; font-size: 1.25rem; }
  input, select, button { padding: 10px 14px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #fff; font-size: 14px; }
  input:focus, select:focus { outline: none; border-color: #38bdf8; }
  button { background: #0284c7; border: none; font-weight: 600; cursor: pointer; transition: 0.15s; }
  button:hover { background: #0369a1; }
  button.danger { background: #dc2626; }
  button.danger:hover { background: #b91c1c; }
  button.secondary { background: #334155; }
  button.secondary:hover { background: #475569; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  .row input { flex: 1; min-width: 140px; }
  .bot-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #0f172a; border-radius: 8px; margin-bottom: 8px; gap: 10px; flex-wrap: wrap; }
  .badge { padding: 4px 8px; border-radius: 6px; font-size: 12px; background: #334155; margin-left: 8px; }
  .online { background: #166534; color: #bbf7d0; }
  .hidden { display: none; }
  .env-box { width: 100%; margin-top: 10px; font-family: monospace; font-size: 12px; color: #cbd5e1; }
  #toast { position: fixed; bottom: 20px; right: 20px; background: #0284c7; color: #fff; padding: 12px 18px; border-radius: 8px; display: none; z-index: 999; }
</style>
</head>
<body>
<div class="container">
  <div id="loginBox" class="card">
    <h1>🔐 AFK Panelga kirish</h1>
    <div class="row">
      <input type="password" id="passInput" placeholder="Admin parolni kiriting..." onkeydown="if(event.key==='Enter') login()">
      <button onclick="login()">Kirish</button>
    </div>
  </div>

  <div id="panelBox" class="hidden">
    <div class="card">
      <h2>➕ Yangi AFK Akkaunt Qo‘shish</h2>
      <p style="color:#94a3b8;font-size:13px;margin-top:-8px;">frokamc.uz → /register yoki /login → /server anarxiya2</p>
      <div class="row">
        <input type="text" id="newUser" placeholder="Minecraft nik">
        <input type="text" id="newPass" placeholder="Parol">
        <button onclick="addAcc()">Qo‘shish</button>
      </div>
    </div>

    <div class="card">
      <h2>💬 Buyruq / Chat Yuborish</h2>
      <div class="row">
        <select id="targetSelect">
          <option value="ALL">📢 Barcha akkauntlarga</option>
        </select>
        <input type="text" id="cmdInput" placeholder="/spawn yoki /bal" onkeydown="if(event.key==='Enter') sendCmd()">
        <button onclick="sendCmd()">Yuborish</button>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap;">
        <h2 style="margin:0;">🤖 Barcha Akkauntlar (<span id="botCount">0</span>)</h2>
        <div class="row">
          <button class="secondary" onclick="reconnectAll()">🔁 Hammasini navbat bilan ulash</button>
          <button class="secondary" onclick="loadBots()">Yangilash</button>
        </div>
      </div>
      <div id="botsList">Yuklanmoqda...</div>

      <div style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#94a3b8;">INITIAL_ACCOUNTS (Render env uchun):</span>
          <button class="secondary" style="padding:5px 10px;font-size:12px;" onclick="copyEnv()">Nusxalash</button>
        </div>
        <input type="text" id="envPreview" class="env-box" readonly>
      </div>
    </div>
  </div>
</div>
<div id="toast"></div>

<script>
let adminPass = localStorage.getItem('afk_admin_pass') || '';

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

async function api(endpoint, body = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pass': adminPass },
    body: JSON.stringify(body)
  });
  if (res.status === 401) {
    localStorage.removeItem('afk_admin_pass');
    document.getElementById('loginBox').classList.remove('hidden');
    document.getElementById('panelBox').classList.add('hidden');
    throw new Error('Parol noto‘g‘ri');
  }
  return res.json();
}

async function login() {
  adminPass = document.getElementById('passInput').value;
  try {
    await loadBots();
    localStorage.setItem('afk_admin_pass', adminPass);
    document.getElementById('loginBox').classList.add('hidden');
    document.getElementById('panelBox').classList.remove('hidden');
  } catch (e) {
    toast(e.message);
  }
}

async function loadBots() {
  const data = await api('/api/list');
  const listEl = document.getElementById('botsList');
  const selEl = document.getElementById('targetSelect');
  const prevVal = selEl.value;

  document.getElementById('botCount').textContent = data.bots.length;
  document.getElementById('envPreview').value = data.envString || '';
  selEl.innerHTML = '<option value="ALL">📢 Barcha akkauntlarga</option>';

  if (data.bots.length === 0) {
    listEl.innerHTML = '<p style="color:#94a3b8;">Hozircha akkaunt yo‘q. Yuqoridan qo‘shing.</p>';
    return;
  }

  listEl.innerHTML = '';
  data.bots.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.username;
    opt.textContent = '👤 ' + b.username;
    selEl.appendChild(opt);

    const div = document.createElement('div');
    div.className = 'bot-item';
    div.innerHTML = \`
      <div>
        <strong>\${b.username}</strong>
        <span class="badge \${b.online ? 'online' : ''}">\${b.status}</span>
      </div>
      <div class="row">
        <button class="secondary" onclick="reconnectAcc('\${b.username}')">🔄 Qayta ulash</button>
        <button class="danger" onclick="delAcc('\${b.username}')">🗑 O‘chirish</button>
      </div>
    \`;
    listEl.appendChild(div);
  });

  if ([...selEl.options].some(o => o.value === prevVal)) selEl.value = prevVal;
}

async function addAcc() {
  const username = document.getElementById('newUser').value;
  const password = document.getElementById('newPass').value;
  if (!username || !password) return toast('Nik va parolni kiriting!');
  const res = await api('/api/add', { username, password });
  toast(res.message);
  document.getElementById('newUser').value = '';
  document.getElementById('newPass').value = '';
  loadBots();
}

async function delAcc(username) {
  const res = await api('/api/remove', { username });
  toast(res.message);
  loadBots();
}

async function reconnectAcc(username) {
  const res = await api('/api/reconnect', { username });
  toast(res.message);
  loadBots();
}

async function reconnectAll() {
  const res = await api('/api/reconnect-all');
  toast(res.message);
  loadBots();
}

async function sendCmd() {
  const target = document.getElementById('targetSelect').value;
  const command = document.getElementById('cmdInput').value;
  if (!command) return;
  const res = await api('/api/cmd', { target, command });
  toast(res.message);
  document.getElementById('cmdInput').value = '';
}

function copyEnv() {
  const el = document.getElementById('envPreview');
  el.select();
  navigator.clipboard?.writeText(el.value);
  toast('INITIAL_ACCOUNTS nusxalandi');
}

if (adminPass) login();
setInterval(() => {
  if (!document.getElementById('panelBox').classList.contains('hidden')) loadBots();
}, 5000);
</script>
</body>
</html>`;

const port = Number(process.env.PORT || 8000);
const host = '0.0.0.0';

http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/ping' || parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(`OK (${bots.size} bots)\n`);
  }

  if (req.method === 'GET' && parsed.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML_PAGE);
  }

  if (req.method === 'POST' && parsed.pathname.startsWith('/api/')) {
    if (req.headers['x-admin-pass'] !== ADMIN_PASS) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, message: 'Noto‘g‘ri parol' }));
    }

    const body = await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });

    if (parsed.pathname === '/api/list') {
      const list = Array.from(bots.values()).map((b) => ({
        username: b.username,
        status: b.status,
        online: Boolean(b.bot && b.bot.entity)
      }));
      return res.end(JSON.stringify({ ok: true, bots: list, envString: buildEnvString() }));
    }

    if (parsed.pathname === '/api/add') {
      if (addAccount(body.username, body.password)) {
        return res.end(JSON.stringify({ ok: true, message: `${body.username} qo‘shildi va ulanmoqda!` }));
      }
      return res.end(JSON.stringify({ ok: false, message: 'Ma’lumotlar to‘liq emas' }));
    }

    if (parsed.pathname === '/api/remove') {
      removeAccount(body.username);
      return res.end(JSON.stringify({ ok: true, message: `${body.username} o‘chirildi` }));
    }

    if (parsed.pathname === '/api/reconnect') {
      const state = bots.get(body.username);
      if (state) {
        if (state.bot) {
          try { state.bot.quit(); } catch (_) {}
        }
        state.isReconnecting = false;
        connectBot(state);
      }
      return res.end(JSON.stringify({ ok: true, message: `${body.username} qayta ulanmoqda` }));
    }

    if (parsed.pathname === '/api/reconnect-all') {
      reconnectAllSequential();
      return res.end(JSON.stringify({ ok: true, message: `Barcha ${bots.size} ta akkaunt navbat bilan ulanmoqda` }));
    }

    if (parsed.pathname === '/api/cmd') {
      const cmd = (body.command || '').trim();
      let sentCount = 0;

      for (const state of bots.values()) {
        if (body.target === 'ALL' || body.target === state.username) {
          if (state.bot && state.bot.entity) {
            state.bot.chat(cmd);
            sentCount++;
          }
        }
      }
      return res.end(JSON.stringify({ ok: true, message: `${sentCount} ta botga yuborildi: ${cmd}` }));
    }
  }

  res.writeHead(404);
  res.end('Not found');
}).listen(port, host, () => {
  console.log(`AFK Web Panel listening on http://${host}:${port}`);
});
