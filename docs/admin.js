'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ghConfig() {
  const cfg = window.TLT_GH;
  if (cfg && cfg.owner && cfg.repo) return { branch: 'main', ...cfg };
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.slice(0, -'.github.io'.length);
    const repo = location.pathname.split('/').filter(Boolean)[0] || 'tlt-house';
    return { owner, repo, branch: 'main' };
  }
  return null;
}
const GH = ghConfig();
const rawBase = () => GH ? `https://raw.githubusercontent.com/${GH.owner}/${GH.repo}/${GH.branch}` : '';

let token = localStorage.getItem('tlt_gh_token') || '';
let passHash = localStorage.getItem('tlt_admin_hash') || '';
let dbSha = '';
let data = { settings: {}, products: [] };
let editingId = null;

function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(str) { return decodeURIComponent(escape(atob(String(str).replace(/\s/g, '')))); }
function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toast(message) {
  const el = $('#adminToast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function localApi(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let body = {};
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(body.error || `Ошибка ${res.status}`);
  return body;
}

async function ghApi(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(body?.message || `GitHub: ${res.status}`);
  return body;
}

async function loadDb() {
  if (GH) {
    const file = await ghApi(`/repos/${GH.owner}/${GH.repo}/contents/data/db.json?ref=${encodeURIComponent(GH.branch)}`);
    dbSha = file.sha;
    return JSON.parse(b64decode(file.content));
  }
  return await localApi('/api/admin/db');
}

async function persistDb(message) {
  if (GH) {
    const res = await ghApi(`/repos/${GH.owner}/${GH.repo}/contents/data/db.json`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: b64encode(JSON.stringify(data, null, 2)),
        sha: dbSha,
        branch: GH.branch
      })
    });
    dbSha = res.content.sha;
  } else {
    await localApi('/api/admin/db', { method: 'PUT', body: JSON.stringify({ db: data }) });
  }
}

function showScreen(id) {
  for (const s of ['setupScreen', 'loginScreen', 'app']) $(`#${s}`).classList.toggle('hidden', s !== id);
}

async function showApp() {
  showScreen('app');
  await refresh();
}
function showLogin() { showScreen('loginScreen'); }
function showSetup() { showScreen('setupScreen'); }

function pluralFlavors(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вкус`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} вкуса`;
  return `${n} вкусов`;
}

function renderAdminProducts() {
  const icon = (cat) => /жиж/i.test(cat) ? '🧪' : /однораз/i.test(cat) ? '⚡' : '💠';
  const image = (src) => {
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    if (GH && src.startsWith('/uploads/')) return `${rawBase()}/docs${src}`;
    return src;
  };
  $('#adminProducts').innerHTML = data.products.map((p, index) => `
    <div class="admin-item">
      <div class="admin-thumb">${image(p.image) ? `<img src="${esc(image(p.image))}" alt="">` : icon(p.category)}</div>
      <div class="admin-info">
        <strong>${esc(p.name)}</strong>
        <small>${esc(p.category)}${p.puffs ? ` · ${esc(p.puffs)} тяг` : ''} · ${p.price ? `${esc(p.price)} ${esc(data.settings.currency || '₽')}` : 'цена не указана'} · ${pluralFlavors(p.flavors.length)}</small>
      </div>
      <span class="status-pill ${p.stock ? 'on' : 'off'}">${p.stock ? 'в наличии' : 'нет'}</span>
      <div class="admin-actions">
        <button class="mini-btn" data-move="up" data-index="${index}" title="Выше">↑</button>
        <button class="mini-btn" data-move="down" data-index="${index}" title="Ниже">↓</button>
        <button class="mini-btn" data-edit="${esc(p.id)}" title="Изменить">✎</button>
        <button class="mini-btn danger" data-delete="${esc(p.id)}" title="Удалить">✕</button>
      </div>
    </div>`).join('') || '<div class="empty">Товаров пока нет. Нажмите «Добавить».</div>';

  $('#adminProducts').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(data.products.find((p) => p.id === b.dataset.edit))));
  $('#adminProducts').querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Удалить товар?')) return;
    try {
      data.products = data.products.filter((p) => p.id !== b.dataset.delete);
      await persistDb(`Delete product ${b.dataset.delete}`);
      toast('Товар удалён');
      await refresh();
    } catch (e) { toast(e.message); }
  }));
  $('#adminProducts').querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
    const i = Number(b.dataset.index);
    const j = b.dataset.move === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= data.products.length) return;
    [data.products[i], data.products[j]] = [data.products[j], data.products[i]];
    data.products.forEach((p, idx) => { p.order = idx + 1; });
    try { await persistDb('Reorder products'); await refresh(); }
    catch (e) { toast(e.message); }
  }));
}

function flavorRow(flavor = { name: '', available: true }) {
  return `<div class="flavor-row">
    <input type="text" class="flavor-name" placeholder="Название вкуса" value="${esc(flavor.name)}">
    <label><input type="checkbox" class="flavor-avail" ${flavor.available ? 'checked' : ''}> есть</label>
    <button type="button" class="mini-btn danger" data-remove-flavor>✕</button>
  </div>`;
}

function openEditor(product) {
  editingId = product ? product.id : null;
  const p = product || { name: '', category: 'Одноразки', badge: '', price: 0, oldPrice: 0, puffs: '', strength: '', stock: true, image: '', description: '', flavors: [{ name: '', available: true }] };
  const displayImage = (src) => {
    if (!src) return '📷';
    if (/^https?:\/\//i.test(src)) return `<img src="${esc(src)}" alt="">`;
    if (GH && src.startsWith('/uploads/')) return `<img src="${esc(rawBase())}/docs${esc(src)}" alt="">`;
    return `<img src="${esc(src)}" alt="">`;
  };
  $('#editorTitle').textContent = product ? 'Редактировать товар' : 'Новый товар';
  $('#productForm').innerHTML = `
    <label class="field"><span>Название *</span><input name="name" value="${esc(p.name)}" required placeholder="Например, ТОРО 3500"></label>
    <div class="field-row">
      <label class="field"><span>Категория</span><input name="category" value="${esc(p.category)}" list="categoryOptions" placeholder="Одноразки / Жижа">
        <datalist id="categoryOptions"><option value="Одноразки"></option><option value="Жижа"></option><option value="Аксессуары"></option></datalist></label>
      <label class="field"><span>Бейдж</span><input name="badge" value="${esc(p.badge)}" placeholder="ХИТ / 3500 ТЯГ"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Цена, ₽</span><input name="price" type="number" min="0" step="1" value="${esc(p.price || '')}" placeholder="0 — уточняется"></label>
      <label class="field"><span>Старая цена</span><input name="oldPrice" type="number" min="0" step="1" value="${esc(p.oldPrice || '')}" placeholder="необязательно"></label>
    </div>
    <div class="field-row">
      <label class="field"><span>Тяг</span><input name="puffs" value="${esc(p.puffs)}" placeholder="3500"></label>
      <label class="field"><span>Крепость</span><input name="strength" value="${esc(p.strength)}" placeholder="81 mg"></label>
    </div>
    <label class="check-field"><input name="stock" type="checkbox" ${p.stock ? 'checked' : ''}> Товар в наличии</label>
    <label class="field"><span>Описание</span><textarea name="description" placeholder="Короткое описание">${esc(p.description)}</textarea></label>
    <div class="field">
      <span>Изображение</span>
      <div class="upload-row">
        <div class="upload-preview" id="uploadPreview">${displayImage(p.image)}</div>
        <input type="file" id="imageFile" accept="image/png,image/jpeg,image/webp">
        <button type="button" class="btn btn-outline btn-sm" id="pickImage">Загрузить фото</button>
      </div>
      <input name="image" id="imageUrl" type="text" value="${esc(p.image)}" placeholder="или вставьте ссылку на картинку">
    </div>
    <div class="field">
      <span>Вкусы и наличие</span>
      <div class="flavors-editor" id="flavorsEditor">${(p.flavors.length ? p.flavors : [{ name: '', available: true }]).map(flavorRow).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" id="addFlavor">+ Добавить вкус</button>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" id="editorCancel">Отмена</button>
      <button type="submit" class="btn btn-primary">Сохранить</button>
    </div>`;

  $('#editor').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  $('#editorClose').onclick = $('#editorCancel').onclick = closeEditor;
  $('#editor').onclick = (e) => { if (e.target.id === 'editor') closeEditor(); };
  $('#addFlavor').onclick = () => $('#flavorsEditor').insertAdjacentHTML('beforeend', flavorRow());
  $('#flavorsEditor').onclick = (e) => { if (e.target.closest('[data-remove-flavor]')) e.target.closest('.flavor-row').remove(); };
  $('#pickImage').onclick = () => $('#imageFile').click();
  $('#imageUrl').oninput = (e) => { $('#uploadPreview').innerHTML = e.target.value ? `<img src="${esc(e.target.value)}" alt="">` : '📷'; };
  $('#imageFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast('Загружаем фото...');
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const url = await uploadImage(file.name, dataUrl);
      $('#imageUrl').value = url;
      $('#uploadPreview').innerHTML = `<img src="${esc(url)}" alt="">`;
      toast('Фото загружено');
    } catch (err) { toast(err.message); }
  };

  $('#productForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      id: editingId || uid(),
      name: form.get('name'), category: form.get('category'), badge: form.get('badge'),
      price: Number(form.get('price')) || 0, oldPrice: Number(form.get('oldPrice')) || 0,
      puffs: form.get('puffs'), strength: form.get('strength'), stock: form.get('stock') === 'on',
      image: $('#imageUrl').value, description: form.get('description'),
      flavors: [...document.querySelectorAll('#flavorsEditor .flavor-row')].map((row) => ({
        name: row.querySelector('.flavor-name').value,
        available: row.querySelector('.flavor-avail').checked
      })).filter((f) => f.name.trim()),
      updatedAt: new Date().toISOString()
    };
    const index = data.products.findIndex((p) => p.id === payload.id);
    if (index >= 0) data.products[index] = { ...data.products[index], ...payload };
    else data.products.push({ ...payload, order: data.products.length + 1, createdAt: new Date().toISOString() });
    try {
      await persistDb(`${editingId ? 'Update' : 'Add'} product ${payload.name}`);
      closeEditor();
      toast('Сохранено');
      await refresh();
    } catch (err) { toast(err.message); }
  };
}

function closeEditor() {
  $('#editor').classList.add('hidden');
  document.body.style.overflow = '';
}

async function uploadImage(name, dataUrl) {
  const match = String(dataUrl).match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Нужен JPG, PNG или WebP');
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const safe = String(name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w\u0400-\u04FF-]+/g, '-').replace(/^-|-$/g, '') || 'photo';
  const file = `${Date.now()}-${safe}.${ext}`;
  const path = `docs/uploads/${file}`;
  if (GH) {
    await ghApi(`/repos/${GH.owner}/${GH.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `Upload image ${file}`, content: match[2], branch: GH.branch })
    });
    return `${rawBase()}/${path}`;
  }
  const res = await localApi('/api/admin/upload', { method: 'POST', body: JSON.stringify({ name: file, dataUrl }) });
  return res.url;
}

const SETTINGS_FIELDS = [
  ['brand', 'Название бренда', 'text'],
  ['tagline', 'Подзаголовок в подвале', 'text'],
  ['heroTitle', 'Заголовок на главной', 'text'],
  ['heroSubtitle', 'Текст на главной', 'textarea'],
  ['announcement', 'Объявление под главной', 'text'],
  ['telegramLink', 'Ссылка на Telegram', 'text'],
  ['reviewsLink', 'Ссылка на отзывы', 'text'],
  ['currency', 'Валюта', 'text'],
  ['accent', 'Акцентный цвет', 'color'],
  ['disclaimer', 'Дисклеймер 18+', 'textarea'],
  ['ageGate', 'Показывать проверку возраста', 'checkbox']
];

function renderSettingsForm() {
  const s = data.settings;
  $('#settingsForm').innerHTML = SETTINGS_FIELDS.map(([key, label, type]) => {
    if (type === 'checkbox') return `<label class="check-field"><input name="${key}" type="checkbox" ${s[key] ? 'checked' : ''}> ${esc(label)}</label>`;
    if (type === 'textarea') return `<label class="field"><span>${esc(label)}</span><textarea name="${key}">${esc(s[key])}</textarea></label>`;
    return `<label class="field"><span>${esc(label)}</span><input name="${key}" type="${type}" value="${esc(s[key])}"></label>`;
  }).join('') + `<button class="btn btn-primary" type="submit">Сохранить настройки</button>`;

  $('#settingsForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    SETTINGS_FIELDS.forEach(([key, , type]) => { data.settings[key] = type === 'checkbox' ? form.get(key) === 'on' : form.get(key); });
    try { await persistDb('Update settings'); toast('Настройки сохранены'); await refresh(); }
    catch (err) { toast(err.message); }
  };
}

async function refresh() {
  try {
    data = await loadDb();
    renderAdminProducts();
    renderSettingsForm();
  } catch (e) {
    toast(e.message);
    if (!GH && (e.message.includes('Нужен вход') || e.message.includes('401'))) showLogin();
  }
}

async function init() {
  $('#setupForm').onsubmit = async (e) => {
    e.preventDefault();
    const newToken = $('#setupToken').value.trim();
    const password = $('#setupPassword').value;
    try {
      await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${newToken}`, Accept: 'application/vnd.github+json' } })
        .then((r) => { if (!r.ok) throw new Error('GitHub не принял токен'); return r.json(); });
      token = newToken;
      passHash = await sha256(password);
      localStorage.setItem('tlt_gh_token', token);
      localStorage.setItem('tlt_admin_hash', passHash);
      $('#setupToken').value = '';
      $('#setupPassword').value = '';
      toast('Готово');
      await showApp();
    } catch (err) { toast(err.message); }
  };

  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      if (GH) {
        const hash = await sha256($('#loginPassword').value);
        if (hash !== passHash) throw new Error('Неверный пароль');
        $('#loginPassword').value = '';
        await showApp();
      } else {
        await localApi('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#loginPassword').value }) });
        $('#loginPassword').value = '';
        await showApp();
      }
    } catch (err) { toast(err.message); }
  };

  $('#logoutBtn').onclick = async () => {
    if (!GH) { try { await localApi('/api/logout', { method: 'POST' }); } catch { /* ignore */ } }
    showLogin();
  };

  $('#addProduct').onclick = () => openEditor(null);

  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab.dataset.tab}`));
  }));

  $('#passwordForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      if (GH) {
        const current = await sha256(form.get('current'));
        if (current !== passHash) throw new Error('Текущий пароль неверный');
        const next = await sha256(form.get('next'));
        passHash = next;
        localStorage.setItem('tlt_admin_hash', next);
      } else {
        await localApi('/api/admin/password', { method: 'POST', body: JSON.stringify({ current: form.get('current'), next: form.get('next') }) });
      }
      e.target.reset();
      toast('Пароль изменён');
    } catch (err) { toast(err.message); }
  };

  if (GH && (!token || !passHash)) { showSetup(); return; }
  if (GH) { showLogin(); return; }
  try {
    const session = await localApi('/api/admin/session');
    if (session.auth) await showApp(); else showLogin();
  } catch { showLogin(); }
}

init();
