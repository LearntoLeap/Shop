// Learn to Leap Shop — Storefront logic
const STATE = { data: null, filter: 'all', search: '', page: 1, pageSize: 24 };

const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';
const slugify = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const productUrl = (p) => {
  const slug = p.slug || slugify(p.name);
  let tail = '';
  if (p.projectCode && p.model) tail = `${p.projectCode}-${p.model}`;
  else if (p.sku) tail = p.sku;
  return tail ? `${slug}/${encodeURIComponent(tail)}` : slug;
};

// Fetch data — ưu tiên GitHub Contents API (real-time, no CDN cache, ~60 req/hr per IP).
// Nếu bị rate-limit (403) → fallback raw → jsDelivr → Pages local.
async function fetchData() {
  const bust = '?t=' + Date.now();
  // 1) GitHub API (real-time)
  try {
    const r = await fetch('https://api.github.com/repos/LearntoLeap/Shop/contents/data/products.json?ref=main' + '&t=' + Date.now(), {
      headers: { Accept: 'application/vnd.github.raw' },
      cache: 'no-store'
    });
    if (r.ok) return await r.json();
    if (r.status !== 403) throw new Error('API ' + r.status);
  } catch (e) { console.warn('API fail, fallback:', e.message); }
  // 2/3/4) fallback CDNs
  const fallbacks = [
    'https://raw.githubusercontent.com/LearntoLeap/Shop/main/data/products.json',
    'https://cdn.jsdelivr.net/gh/LearntoLeap/Shop@main/data/products.json',
    'data/products.json'
  ];
  let lastErr;
  for (const url of fallbacks) {
    try {
      const res = await fetch(url + bust, { cache: 'no-store' });
      if (!res.ok) throw new Error(url + ' → ' + res.status);
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
async function loadData() {
  try {
    STATE.data = await fetchData();
    renderTree();
    renderFeatured();
    renderProducts();
  } catch (e) {
    document.getElementById('productGrid').innerHTML = '<div class="col-span-full text-center text-red-500 py-8">Không tải được dữ liệu sản phẩm.</div>';
    console.error(e);
  }
}

function countByCat(catId) {
  if (catId === 'all') return STATE.data.products.length;
  return STATE.data.products.filter(p => p.category === catId).length;
}

function renderTree() {
  const tree = document.getElementById('treeList');
  const items = [
    { id: 'all', name: 'Tất cả sản phẩm', icon: '🗂' },
    ...STATE.data.categories.map(c => ({ id: c.id, name: c.name, icon: c.icon || '📦' }))
  ];
  tree.innerHTML = items.map(it => `
    <button onclick="filterBy('${it.id}')" data-tree="${it.id}"
      class="tree-item w-full text-left px-4 py-2.5 text-sm flex items-center justify-between border-l-4 border-transparent hover:bg-purple-50 transition">
      <span class="flex items-center gap-2"><span>${it.icon}</span><span>${it.name}</span></span>
      <span class="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">${countByCat(it.id)}</span>
    </button>
  `).join('');
  updateTreeActive();
}

function updateTreeActive() {
  document.querySelectorAll('[data-tree]').forEach(el => {
    el.classList.toggle('active', el.dataset.tree === STATE.filter);
  });
}

function filterBy(catId) {
  STATE.filter = catId;
  STATE.page = 1;
  updateTreeActive();
  const cat = STATE.data.categories.find(c => c.id === catId);
  document.getElementById('catTitle').textContent = cat ? `${cat.icon || ''} ${cat.name}` : 'Tất cả sản phẩm';
  renderProducts();
  document.getElementById('products').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function gotoPage(n) {
  STATE.page = n;
  renderProducts();
  document.getElementById('products').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPagination(totalPages) {
  const el = document.getElementById('pagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  const cur = STATE.page;
  const btn = (label, n, opts = {}) => {
    const disabled = opts.disabled || n === cur;
    const active = n === cur && !opts.plain;
    const cls = active
      ? 'bg-brand-600 text-white border-brand-600 font-bold'
      : disabled
        ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
        : 'bg-white text-slate-700 border-slate-300 hover:border-brand-500 hover:text-brand-700';
    const onclick = disabled ? '' : `onclick="gotoPage(${n})"`;
    return `<button ${onclick} class="min-w-[40px] px-3 py-1.5 rounded-lg border text-sm ${cls}">${label}</button>`;
  };
  // Build list: 1 ... cur-1 cur cur+1 ... last
  const pages = new Set([1, totalPages, cur, cur - 1, cur + 1]);
  const list = Array.from(pages).filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  let html = btn('‹', cur - 1, { disabled: cur === 1, plain: true });
  let prev = 0;
  for (const n of list) {
    if (prev && n - prev > 1) html += `<span class="px-1 text-slate-400">…</span>`;
    html += btn(String(n), n);
    prev = n;
  }
  html += btn('›', cur + 1, { disabled: cur === totalPages, plain: true });
  html += `<span class="ml-3 text-xs text-slate-500">Trang ${cur}/${totalPages}</span>`;
  el.innerHTML = html;
}

function productCard(p) {
  const cat = STATE.data.categories.find(c => c.id === p.category);
  const img = (p.images && p.images[0]) || 'https://placehold.co/600x600/e2e8f0/64748b?text=No+Image';
  const isContact = p.priceMode === 'contact';
  const discount = !isContact && p.originalPrice && p.originalPrice > p.price
    ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
  const priceBlock = isContact
    ? `<span class="text-lg font-extrabold text-brand-700">Liên hệ</span>`
    : `<span class="text-lg font-extrabold text-brand-700">${fmtVND(p.price)}</span>
       ${p.originalPrice && p.originalPrice > p.price ? `<span class="text-xs text-slate-400 line-through">${fmtVND(p.originalPrice)}</span>` : ''}`;
  return `
    <a href="${productUrl(p)}" class="block bg-white rounded-xl shadow-sm hover:shadow-lg transition overflow-hidden group border border-slate-100">
      <div class="aspect-square bg-slate-100 overflow-hidden relative">
        <img src="${img}" alt="${p.name}" class="w-full h-full object-cover group-hover:scale-105 transition" loading="lazy" />
        ${discount > 0 ? `<span class="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded">-${discount}%</span>` : ''}
        ${p.featured ? `<span class="absolute top-2 right-2 bg-amber-400 text-amber-900 text-xs font-bold px-2 py-1 rounded">⭐ HOT</span>` : ''}
      </div>
      <div class="p-4">
        <div class="text-xs text-brand-600 font-medium mb-1">${cat ? cat.icon + ' ' + cat.name : ''}</div>
        <div class="font-semibold text-slate-800 line-clamp-2 min-h-[3rem]">${p.name}</div>
        <div class="text-xs text-slate-500 line-clamp-2 mt-1 min-h-[2rem]">${p.shortDescription || ''}</div>
        <div class="mt-3 flex items-baseline gap-2">${priceBlock}</div>
        <div class="mt-2 flex flex-wrap gap-1">
          ${(p.tags || []).slice(0, 3).map(t => `<span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">#${t}</span>`).join('')}
        </div>
      </div>
    </a>
  `;
}

// Products are stored newest-first (unshift on insert). Reverse for display
// so users see them in insertion order (oldest → newest).
function displayProducts() { return STATE.data.products.slice().reverse(); }

function renderFeatured() {
  const featured = displayProducts().filter(p => p.featured).slice(0, 4);
  document.getElementById('featuredGrid').innerHTML = featured.map(productCard).join('');
}

function renderProducts() {
  let list = displayProducts();
  if (STATE.filter !== 'all') list = list.filter(p => p.category === STATE.filter);
  if (STATE.search) {
    const q = STATE.search.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  document.getElementById('productCount').textContent = list.length;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(list.length / STATE.pageSize));
  if (STATE.page > totalPages) STATE.page = totalPages;
  if (STATE.page < 1) STATE.page = 1;
  const start = (STATE.page - 1) * STATE.pageSize;
  const paged = list.slice(start, start + STATE.pageSize);

  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('emptyState');
  if (list.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); }
  else { empty.classList.add('hidden'); grid.innerHTML = paged.map(productCard).join(''); }
  renderPagination(totalPages);
}

document.getElementById('searchInput')?.addEventListener('input', (e) => {
  STATE.search = e.target.value;
  STATE.page = 1;
  renderProducts();
});

loadData();
