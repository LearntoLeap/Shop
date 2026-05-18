// Learn to Leap Shop — Storefront logic
const STATE = { data: null, filter: 'all', search: '' };

const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';

async function loadData() {
  try {
    const res = await fetch('data/products.json?t=' + Date.now());
    STATE.data = await res.json();
    renderCategories();
    renderFilters();
    renderFeatured();
    renderProducts();
  } catch (e) {
    document.getElementById('productGrid').innerHTML = '<div class="col-span-full text-center text-red-500 py-8">Không tải được dữ liệu sản phẩm.</div>';
    console.error(e);
  }
}

function renderCategories() {
  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = STATE.data.categories.map(c => `
    <button onclick="filterBy('${c.id}')" class="bg-white hover:bg-brand-50 border border-slate-200 hover:border-brand-300 rounded-xl p-4 text-left transition shadow-sm">
      <div class="text-3xl mb-1">${c.icon || '📦'}</div>
      <div class="font-semibold text-sm text-slate-800">${c.name}</div>
      <div class="text-xs text-slate-500 line-clamp-2 mt-1">${c.description || ''}</div>
    </button>
  `).join('');
}

function renderFilters() {
  const chips = document.getElementById('filterChips');
  const all = `<button onclick="filterBy('all')" data-filter="all" class="filter-chip px-3 py-1 rounded-full text-sm border">Tất cả</button>`;
  const cats = STATE.data.categories.map(c =>
    `<button onclick="filterBy('${c.id}')" data-filter="${c.id}" class="filter-chip px-3 py-1 rounded-full text-sm border">${c.icon || ''} ${c.name}</button>`
  ).join('');
  chips.innerHTML = all + cats;
  updateChipStyles();
}

function updateChipStyles() {
  document.querySelectorAll('.filter-chip').forEach(btn => {
    if (btn.dataset.filter === STATE.filter) {
      btn.className = 'filter-chip px-3 py-1 rounded-full text-sm border bg-brand-600 text-white border-brand-600';
    } else {
      btn.className = 'filter-chip px-3 py-1 rounded-full text-sm border bg-white text-slate-700 border-slate-300 hover:border-brand-400';
    }
  });
}

function filterBy(catId) {
  STATE.filter = catId;
  updateChipStyles();
  renderProducts();
  document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
}

function productCard(p) {
  const cat = STATE.data.categories.find(c => c.id === p.category);
  const img = (p.images && p.images[0]) || 'https://placehold.co/600x600/e2e8f0/64748b?text=No+Image';
  const discount = p.originalPrice && p.originalPrice > p.price
    ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;
  return `
    <div class="bg-white rounded-xl shadow-sm hover:shadow-lg transition overflow-hidden group cursor-pointer border border-slate-100" onclick="openProduct('${p.id}')">
      <div class="aspect-square bg-slate-100 overflow-hidden relative">
        <img src="${img}" alt="${p.name}" class="w-full h-full object-cover group-hover:scale-105 transition" loading="lazy" />
        ${discount > 0 ? `<span class="absolute top-2 left-2 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded">-${discount}%</span>` : ''}
        ${p.featured ? `<span class="absolute top-2 right-2 bg-amber-400 text-amber-900 text-xs font-bold px-2 py-1 rounded">⭐ HOT</span>` : ''}
      </div>
      <div class="p-4">
        <div class="text-xs text-brand-600 font-medium mb-1">${cat ? cat.icon + ' ' + cat.name : ''}</div>
        <div class="font-semibold text-slate-800 line-clamp-2 min-h-[3rem]">${p.name}</div>
        <div class="text-xs text-slate-500 line-clamp-2 mt-1 min-h-[2rem]">${p.shortDescription || ''}</div>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-lg font-extrabold text-brand-700">${fmtVND(p.price)}</span>
          ${p.originalPrice && p.originalPrice > p.price ? `<span class="text-xs text-slate-400 line-through">${fmtVND(p.originalPrice)}</span>` : ''}
        </div>
        <div class="mt-2 flex flex-wrap gap-1">
          ${(p.tags || []).slice(0, 3).map(t => `<span class="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded">#${t}</span>`).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderFeatured() {
  const featured = STATE.data.products.filter(p => p.featured).slice(0, 4);
  document.getElementById('featuredGrid').innerHTML = featured.map(productCard).join('');
}

function renderProducts() {
  let list = STATE.data.products;
  if (STATE.filter !== 'all') list = list.filter(p => p.category === STATE.filter);
  if (STATE.search) {
    const q = STATE.search.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('emptyState');
  if (list.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); }
  else { empty.classList.add('hidden'); grid.innerHTML = list.map(productCard).join(''); }
}

function openProduct(id) {
  const p = STATE.data.products.find(x => x.id === id);
  if (!p) return;
  const cat = STATE.data.categories.find(c => c.id === p.category);
  const img = (p.images && p.images[0]) || 'https://placehold.co/800x800/e2e8f0/64748b?text=No+Image';
  const html = `
    <div class="grid md:grid-cols-2 gap-6">
      <div class="bg-slate-100">
        <img src="${img}" alt="${p.name}" class="w-full aspect-square object-cover" />
        ${p.images && p.images.length > 1 ? `<div class="flex gap-2 p-3 overflow-x-auto">${p.images.map(i => `<img src="${i}" class="w-16 h-16 object-cover rounded border" />`).join('')}</div>` : ''}
      </div>
      <div class="p-6">
        <button onclick="closeModal()" class="float-right text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
        <div class="text-sm text-brand-600 font-medium mb-1">${cat ? cat.icon + ' ' + cat.name : ''}</div>
        <h2 class="text-2xl font-extrabold mb-2">${p.name}</h2>
        <div class="flex items-baseline gap-3 mb-4">
          <span class="text-3xl font-extrabold text-brand-700">${fmtVND(p.price)}</span>
          ${p.originalPrice && p.originalPrice > p.price ? `<span class="text-sm text-slate-400 line-through">${fmtVND(p.originalPrice)}</span>` : ''}
        </div>
        <div class="prose prose-sm max-w-none text-slate-700 whitespace-pre-line mb-4">${p.description || ''}</div>
        <div class="flex flex-wrap gap-1 mb-5">
          ${(p.tags || []).map(t => `<span class="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">#${t}</span>`).join('')}
        </div>
        <div class="text-sm text-slate-600 mb-4">Tình trạng: ${p.stock > 0 ? `<span class="text-emerald-600 font-semibold">Còn hàng (${p.stock})</span>` : '<span class="text-red-500">Liên hệ</span>'}</div>
        <a href="mailto:contact@learntoleap.vn?subject=Liên hệ đặt sản phẩm: ${encodeURIComponent(p.name)}" class="block text-center bg-gradient-to-r from-accent-500 to-brand-600 hover:opacity-90 text-white font-semibold py-3 rounded-lg shadow-lg shadow-purple-200">📧 Liên hệ đặt sản phẩm</a>
      </div>
    </div>
  `;
  document.getElementById('modalContent').innerHTML = html;
  const m = document.getElementById('modal');
  m.classList.remove('hidden');
  m.classList.add('flex');
}

function closeModal() {
  const m = document.getElementById('modal');
  m.classList.add('hidden');
  m.classList.remove('flex');
}

document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

document.getElementById('searchInput')?.addEventListener('input', (e) => {
  STATE.search = e.target.value;
  renderProducts();
});

loadData();
