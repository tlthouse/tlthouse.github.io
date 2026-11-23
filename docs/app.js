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

function resolveImage(src) {
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  if (GH && src.startsWith('/uploads/')) return `${rawBase()}/docs${src}`;
  return src;
}

let state = { settings: {}, products: [] };
let activeCategory = 'Все';
let query = '';
let cart = [];
try { cart = JSON.parse(localStorage.getItem('tlt_cart') || '[]'); } catch { cart = []; }

function money(value, currency) {
  if (!value) return `<span class="price small">Цена уточняется</span>`;
  return `${Number(value).toLocaleString('ru-RU')} <small>${esc(currency || '₽')}</small>`;
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function saveCart() {
  localStorage.setItem('tlt_cart', JSON.stringify(cart));
  renderCart();
}

function cartTotal() {
  return cart.reduce((sum, item) => sum + (Number(item.price) || 0) * item.qty, 0);
}

function renderCart() {
  const count = cart.reduce((s, i) => s + i.qty, 0);
  $('#cartCount').textContent = count;
  $('#cartTotal').textContent = `${cartTotal().toLocaleString('ru-RU')} ${state.settings.currency || '₽'}`;
  $('#cartBar').classList.toggle('hidden', count === 0);
}

function addToCart(product, flavor) {
  const key = `${product.id}|${flavor || ''}`;
  const found = cart.find((i) => i.key === key);
  if (found) found.qty += 1;
  else cart.push({ key, id: product.id, name: product.name, flavor: flavor || '', price: Number(product.price) || 0, qty: 1 });
  saveCart();
  toast(`Добавлено: ${product.name}`);
}

function openPicker(product) {
  const available = product.flavors.filter((f) => f.available);
  const old = document.querySelector('.picker-modal');
  if (old) old.remove();
  const modal = document.createElement('div');
  modal.className = 'picker-modal';
  modal.innerHTML = `
    <div class="picker-card">
      <h3>Выберите вкус</h3>
      <p>${esc(product.name)}</p>
      <div class="picker-list">
        ${available.map((f, i) => `<label class="picker-item"><input type="radio" name="flavor" value="${esc(f.name)}" ${i === 0 ? 'checked' : ''}><span>${esc(f.name)}</span></label>`).join('')}
      </div>
      <div class="picker-actions">
        <button class="btn btn-ghost" data-close>Отмена</button>
        <button class="btn btn-primary" data-add>В корзину</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) modal.remove();
    if (e.target.closest('[data-add]')) {
      const chosen = modal.querySelector('input[name=flavor]:checked');
      addToCart(product, chosen ? chosen.value : '');
      modal.remove();
    }
  });
}

function renderCategories() {
  const cats = ['Все', ...new Set(state.products.map((p) => p.category).filter(Boolean))];
  $('#categories').innerHTML = cats.map((c) => `<button class="chip ${c === activeCategory ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $('#categories').querySelectorAll('[data-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      renderCategories();
      renderProducts();
    });
  });
}

function renderProducts() {
  const q = query.toLowerCase().trim();
  const list = state.products.filter((p) => {
    const catOk = activeCategory === 'Все' || p.category === activeCategory;
    const hay = `${p.name} ${p.category} ${p.description} ${p.flavors.map((f) => f.name).join(' ')}`.toLowerCase();
    return catOk && (!q || hay.includes(q));
  });

  $('#productCount').textContent = list.length;
  $('#empty').classList.toggle('hidden', list.length > 0);
  const icon = (cat) => /жиж/i.test(cat) ? '🧪' : /однораз/i.test(cat) ? '⚡' : '💠';

  $('#products').innerHTML = list.map((p) => {
    const available = p.flavors.filter((f) => f.available);
    const flavors = p.flavors.length
      ? `<div class="flavors-label">Вкусы</div><div class="flavors">${p.flavors.map((f) => `<span class="flavor ${f.available ? '' : 'out'}">${esc(f.name)}</span>`).join('')}</div>`
      : '';
    const specs = [p.puffs && `${esc(p.puffs)} тяг`, p.strength && esc(p.strength)].filter(Boolean);
    const image = resolveImage(p.image);
    return `
      <article class="product-card ${p.stock ? '' : 'is-out'}">
        <div class="product-visual">
          ${image ? `<img src="${esc(image)}" alt="${esc(p.name)}">` : `<span class="product-icon">${icon(p.category)}</span>`}
          ${p.badge ? `<span class="product-badge">${esc(p.badge)}</span>` : ''}
          <span class="stock-dot ${p.stock ? '' : 'out'}">${p.stock ? 'в наличии' : 'нет в наличии'}</span>
        </div>
        <div class="product-body">
          <span class="product-category">${esc(p.category)}</span>
          <h3 class="product-name">${esc(p.name)}</h3>
          ${specs.length ? `<div class="product-specs">${specs.map((s) => `<span class="spec">${s}</span>`).join('')}</div>` : ''}
          ${p.description ? `<p class="product-desc">${esc(p.description)}</p>` : ''}
          ${flavors}
          <div class="product-bottom">
            <div class="price">${money(p.price, state.settings.currency)}${p.oldPrice ? `<span class="old-price">${esc(p.oldPrice)} ₽</span>` : ''}</div>
            <button class="btn btn-primary buy-btn" data-id="${esc(p.id)}" ${p.stock && available.length ? '' : 'disabled'}>${p.stock && available.length ? 'В корзину' : 'Нет'}</button>
          </div>
        </div>
      </article>`;
  }).join('');

  $('#products').querySelectorAll('[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const product = state.products.find((p) => p.id === btn.dataset.id);
      if (!product || !product.stock) return;
      const available = product.flavors.filter((f) => f.available);
      if (available.length > 1) openPicker(product);
      else addToCart(product, available[0] ? available[0].name : '');
    });
  });
}

function applySettings(s = {}) {
  document.title = `${s.brand || 'TLT HOUSE'} — каталог`;
  if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
  $('#brandName').textContent = s.brand || 'TLT HOUSE';
  $('#heroTitle').textContent = s.heroTitle || s.brand || 'TLT HOUSE';
  $('#heroSubtitle').textContent = s.heroSubtitle || '';
  $('#announcement').textContent = s.announcement || '';
  $('#footerBrand').textContent = s.brand || 'TLT HOUSE';
  $('#footerTagline').textContent = s.tagline || '';
  $('#disclaimer').textContent = s.disclaimer || '';
  $('#headerTg').href = s.telegramLink || '#';
  $('#heroTg').href = s.telegramLink || '#';
  $('#footerTg').href = s.telegramLink || '#';
  $('#footerReviews').href = s.reviewsLink || '#';
}

function order() {
  const lines = cart.map((i) => `• ${i.name}${i.flavor ? ` — ${i.flavor}` : ''} × ${i.qty}`);
  const total = cartTotal();
  const text = [`${state.settings.brand || 'TLT HOUSE'} — заказ:`, ...lines, total ? `Итого: ${total.toLocaleString('ru-RU')} ${state.settings.currency || '₽'}` : '', 'Подскажите, пожалуйста, наличие и способ оплаты.'].filter(Boolean).join('\n');
  const base = (state.settings.telegramLink || 'https://t.me/tlthouse1').split('?')[0];
  window.open(`${base}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

async function loadState() {
  if (GH) {
    const url = `${rawBase()}/data/db.json?t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Не удалось загрузить каталог из GitHub');
    return await res.json();
  }
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('Не удалось загрузить каталог');
  return await res.json();
}

async function init() {
  $('#year').textContent = new Date().getFullYear();

  try {
    state = await loadState();
    applySettings(state.settings);
    renderCategories();
    renderProducts();
    renderCart();
    if (state.settings.ageGate !== false && localStorage.getItem('tlt_age_ok') !== '1') $('#ageGate').classList.remove('hidden');
  } catch (e) {
    $('#products').innerHTML = `<div class="empty">Ошибка загрузки каталога: ${esc(e.message)}</div>`;
  }

  $('#search').addEventListener('input', (e) => { query = e.target.value; renderProducts(); });
  $('#ageYes').addEventListener('click', () => { localStorage.setItem('tlt_age_ok', '1'); $('#ageGate').classList.add('hidden'); });
  $('#ageNo').addEventListener('click', () => { window.location.href = 'about:blank'; });
  $('#cartClear').addEventListener('click', () => { cart = []; saveCart(); toast('Корзина очищена'); });
  $('#cartOrder').addEventListener('click', order);
}

init();
