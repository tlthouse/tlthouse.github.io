'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'docs');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 8 * 1024 * 1024;

for (const dir of [PUBLIC_DIR, DATA_DIR, path.join(PUBLIC_DIR, 'uploads')]) {
  fs.mkdirSync(dir, { recursive: true });
}

function centsFrom(value) {
  const n = Number(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

const initialDB = {
  settings: {
    brand: 'TLT HOUSE',
    tagline: 'Вкус, который запоминается',
    heroTitle: 'TLT HOUSE',
    heroSubtitle: 'Подборка жиж и одноразок с нашего канала. Актуальные вкусы и наличие — прямо здесь.',
    telegramMain: '@tlthouse1',
    telegramReviews: '@tlthouse2',
    telegramLink: 'https://t.me/tlthouse1',
    reviewsLink: 'https://t.me/tlthouse2',
    announcement: 'Новые вкусы и поступления — первыми в канале.',
    disclaimer: 'Продукт содержит никотин. Никотин — химическое вещество, вызывающее привыкание. Информация носит ознакомительный характер и не является рекламой. Для лиц старше 18 лет.',
    currency: '₽',
    accent: '#b026ff',
    ageGate: true
  },
  products: [
    {
      id: 'koma-81',
      order: 1,
      name: 'KOMA 81 mg',
      category: 'Жижа',
      badge: 'ХИТ',
      price: 0,
      oldPrice: 0,
      puffs: '',
      strength: '81 mg',
      stock: true,
      image: '',
      description: 'Жижа для заправки. Насыщенный вкус и плотная затяжка.',
      flavors: [
        { name: 'Ягодный редбулл', available: true },
        { name: 'Морозные лесные ягоды', available: true }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: 'toro-3500',
      order: 2,
      name: 'ТОРО 3500',
      category: 'Одноразки',
      badge: '3500 ТЯГ',
      price: 0,
      oldPrice: 0,
      puffs: '3500',
      strength: '',
      stock: true,
      image: '',
      description: 'Одноразовое устройство на 3500 тяг. Удобно брать с собой.',
      flavors: [
        { name: 'Жевательная резинка', available: true },
        { name: 'Кокосовая мечта', available: true },
        { name: 'Сочный персик', available: true }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: 'topol-gemini-s',
      order: 3,
      name: 'TOPOL Gemini S',
      category: 'Одноразки',
      badge: '2 БАКА',
      price: 0,
      oldPrice: 0,
      puffs: '3000',
      strength: '',
      stock: true,
      image: '',
      description: 'Два бака с разными вкусами — меняйте вкус когда захотите.',
      flavors: [
        { name: 'Свежая мята', available: true },
        { name: 'Апельсиновый фреш', available: true }
      ],
      createdAt: new Date().toISOString()
    },
    {
      id: 'micool-1200',
      order: 4,
      name: 'micool 1200',
      category: 'Одноразки',
      badge: '1200 ТЯГ',
      price: 0,
      oldPrice: 0,
      puffs: '1200',
      strength: '',
      stock: true,
      image: '',
      description: 'Компактная одноразка на каждый день.',
      flavors: [
        { name: 'Личи айс', available: true }
      ],
      createdAt: new Date().toISOString()
    }
  ]
};

function ensureFiles() {
  if (!fs.existsSync(DB_FILE)) writeJSON(DB_FILE, initialDB);
  if (!fs.existsSync(ADMIN_FILE)) {
    const salt = crypto.randomBytes(16).toString('hex');
    const password = crypto.randomBytes(6).toString('base64url');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    writeJSON(ADMIN_FILE, { salt, hash, createdAt: new Date().toISOString() });
    const hint = path.join(DATA_DIR, 'ADMIN_PASSWORD.txt');
    fs.writeFileSync(hint, `Логин: admin\nПароль: ${password}\n\nСмените пароль в админке после первого входа.\n`, 'utf8');
    console.log('\n=== ПЕРВЫЙ ЗАПУСК ===');
    console.log(`Пароль админки: ${password}`);
    console.log(`Он же записан в ${hint}`);
    console.log('=====================\n');
  }
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function getDB() {
  try { return readJSON(DB_FILE); } catch (e) {
    console.error('DB read error, restoring initial data:', e.message);
    writeJSON(DB_FILE, initialDB);
    return JSON.parse(JSON.stringify(initialDB));
  }
}
function saveDB(db) { writeJSON(DB_FILE, db); }

const sessions = new Map();
const failedLogins = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isAuth(req) {
  const token = parseCookies(req.headers.cookie).tlt_session;
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function checkPassword(password) {
  const admin = readJSON(ADMIN_FILE);
  const hash = crypto.scryptSync(String(password || ''), admin.salt, 64).toString('hex');
  return safeEqual(hash, admin.hash);
}
function clientIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function send(res, status, data, headers = {}) {
  const body = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}
function ok(res, data, headers = {}) { send(res, 200, data, headers); }
function fail(res, status, message) { send(res, status, { error: message }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error('Слишком большой запрос')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(new Error('Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '/index') rel = '/index.html';
  if (rel === '/admin') rel = '/admin.html';
  const file = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, 'Forbidden');
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return fail(res, 404, 'Не найдено');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=86400' : 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
}

function cleanStr(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}
function normalizeProduct(input, existing = {}) {
  const flavors = Array.isArray(input.flavors) ? input.flavors
    .map((f) => ({ name: cleanStr(f && f.name, 120), available: !!(f && f.available) }))
    .filter((f) => f.name) : [];
  return {
    id: existing.id || cleanStr(input.id, 80) || crypto.randomUUID(),
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : (existing.order || 999),
    name: cleanStr(input.name, 120),
    category: cleanStr(input.category, 60) || 'Другое',
    badge: cleanStr(input.badge, 40),
    price: Number.isFinite(Number(input.price)) ? Math.max(0, Number(input.price)) : 0,
    oldPrice: Number.isFinite(Number(input.oldPrice)) ? Math.max(0, Number(input.oldPrice)) : 0,
    puffs: cleanStr(input.puffs, 40),
    strength: cleanStr(input.strength, 40),
    stock: input.stock === undefined ? true : !!input.stock,
    image: cleanStr(input.image, 500),
    description: cleanStr(input.description, 1000),
    flavors,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
function normalizeSettings(input, current = {}) {
  const out = { ...current };
  const keys = ['brand', 'tagline', 'heroTitle', 'heroSubtitle', 'telegramMain', 'telegramReviews', 'telegramLink', 'reviewsLink', 'announcement', 'disclaimer', 'currency', 'accent'];
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = cleanStr(input[key], key === 'disclaimer' ? 1000 : 300);
  if (Object.prototype.hasOwnProperty.call(input, 'ageGate')) out.ageGate = !!input.ageGate;
  return out;
}
function saveUpload(name, dataUrl) {
  const match = String(dataUrl).match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error('Нужен JPG, PNG или WebP');
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new Error('Файл больше 6 МБ');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const base = cleanStr(name || 'photo', 60).replace(/[^\w\u0400-\u04FF-]+/g, '-').replace(/^-|-$/g, '') || 'photo';
  const file = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${base}.${ext}`;
  fs.writeFileSync(path.join(PUBLIC_DIR, 'uploads', file), buf);
  return `/uploads/${file}`;
}

async function handleAPI(req, res, pathname) {
  const method = req.method || 'GET';

  if (pathname === '/api/state' && method === 'GET') {
    const db = getDB();
    return ok(res, {
      settings: db.settings,
      products: [...db.products].sort((a, b) => (a.order || 0) - (b.order || 0))
    });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const ip = clientIP(req);
    const attempt = failedLogins.get(ip);
    if (attempt && attempt.until > Date.now()) return fail(res, 429, 'Слишком много попыток. Подождите 15 минут.');
    const body = await readBody(req);
    if (!checkPassword(body.password)) {
      const next = { count: (attempt?.count || 0) + 1, until: Date.now() + 15 * 60 * 1000 };
      failedLogins.set(ip, next);
      return fail(res, 401, 'Неверный пароль');
    }
    failedLogins.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    return ok(res, { ok: true }, {
      'Set-Cookie': `tlt_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`
    });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const token = parseCookies(req.headers.cookie).tlt_session;
    if (token) sessions.delete(token);
    return ok(res, { ok: true }, { 'Set-Cookie': 'tlt_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }

  if (pathname === '/api/admin/session' && method === 'GET') return ok(res, { auth: isAuth(req) });

  if (!pathname.startsWith('/api/admin/')) return fail(res, 404, 'Не найдено');
  if (!isAuth(req)) return fail(res, 401, 'Нужен вход');

  if (pathname === '/api/admin/data' && method === 'GET') {
    const db = getDB();
    return ok(res, { settings: db.settings, products: [...db.products].sort((a, b) => (a.order || 0) - (b.order || 0)) });
  }

  if (pathname === '/api/admin/db' && method === 'GET') {
    return ok(res, getDB());
  }

  if (pathname === '/api/admin/db' && method === 'PUT') {
    const body = await readBody(req);
    if (!body.db || !Array.isArray(body.db.products) || !body.db.settings) return fail(res, 400, 'Некорректные данные');
    saveDB(body.db);
    return ok(res, { ok: true });
  }

  if (pathname === '/api/admin/products' && method === 'POST') {
    const body = await readBody(req);
    if (!cleanStr(body.name)) return fail(res, 400, 'Укажите название');
    const db = getDB();
    const product = normalizeProduct(body);
    db.products.push(product);
    saveDB(db);
    return ok(res, { product });
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (productMatch) {
    const id = decodeURIComponent(productMatch[1]);
    const db = getDB();
    const index = db.products.findIndex((p) => p.id === id);
    if (index === -1) return fail(res, 404, 'Товар не найден');
    if (method === 'PUT') {
      const body = await readBody(req);
      db.products[index] = normalizeProduct(body, db.products[index]);
      saveDB(db);
      return ok(res, { product: db.products[index] });
    }
    if (method === 'DELETE') {
      db.products.splice(index, 1);
      saveDB(db);
      return ok(res, { ok: true });
    }
  }

  if (pathname === '/api/admin/reorder' && method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.ids)) return fail(res, 400, 'Нужен список id');
    const db = getDB();
    body.ids.forEach((id, i) => {
      const p = db.products.find((x) => x.id === id);
      if (p) p.order = i + 1;
    });
    saveDB(db);
    return ok(res, { ok: true });
  }

  if (pathname === '/api/admin/settings' && method === 'PUT') {
    const body = await readBody(req);
    const db = getDB();
    db.settings = normalizeSettings(body, db.settings);
    saveDB(db);
    return ok(res, { settings: db.settings });
  }

  if (pathname === '/api/admin/upload' && method === 'POST') {
    const body = await readBody(req);
    try {
      const url = saveUpload(body.name, body.dataUrl);
      return ok(res, { url });
    } catch (e) { return fail(res, 400, e.message); }
  }

  if (pathname === '/api/admin/password' && method === 'POST') {
    const body = await readBody(req);
    if (!checkPassword(body.current)) return fail(res, 401, 'Текущий пароль неверный');
    const next = cleanStr(body.next, 200);
    if (next.length < 6) return fail(res, 400, 'Новый пароль — минимум 6 символов');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(next, salt, 64).toString('hex');
    writeJSON(ADMIN_FILE, { salt, hash, updatedAt: new Date().toISOString() });
    return ok(res, { ok: true });
  }

  return fail(res, 404, 'Не найдено');
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    if (pathname.startsWith('/api/')) return await handleAPI(req, res, pathname);
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 500, 'Ошибка сервера');
    else res.end();
  }
});

ensureFiles();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`TLT HOUSE running: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
