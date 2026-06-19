// Learn to Leap Shop — Storefront logic
const STATE = { data: null, filter: 'all', search: '' };

const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';

async function loadData() {
  try {
    const res = await fetch('data/products.json?t=' + Date.now());
    STATE.data = await res.json();
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
  updateTreeActive();
  const cat = STATE.data.categories.find(c => c.id === catId);
  document.getElementById('catTitle').textContent = cat ? `${cat.icon || ''} ${cat.name}` : 'Tất cả sản phẩm';
  renderProducts();
  document.getElementById('products').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    <a href="product.html?id=${encodeURIComponent(p.id)}" class="block bg-white rounded-xl shadow-sm hover:shadow-lg transition overflow-hidden group border border-slate-100">
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
  document.getElementById('productCount').textContent = list.length;
  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('emptyState');
  if (list.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); }
  else { empty.classList.add('hidden'); grid.innerHTML = list.map(productCard).join(''); }
}

document.getElementById('searchInput')?.addEventListener('input', (e) => {
  STATE.search = e.target.value;
  renderProducts();
});

loadData();
