// Learn to Leap Shop — Admin panel (GitHub API based)
const DATA_PATH = 'data/products.json';
const STATE = { auth: null, data: null, sha: null, tab: 'products', editing: null, selection: new Set(), filterCat: 'all', filterProject: 'all' };

const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- AUTH ----------
function loadStoredAuth() {
  const local = localStorage.getItem('ltl_admin_auth');
  const session = sessionStorage.getItem('ltl_admin_auth');
  const raw = session || local;
  if (raw) {
    try { STATE.auth = JSON.parse(raw); return true; } catch { return false; }
  }
  return false;
}

async function login() {
  const owner = document.getElementById('ghOwner').value.trim();
  const repo = document.getElementById('ghRepo').value.trim();
  const branch = document.getElementById('ghBranch').value.trim() || 'main';
  const token = document.getElementById('ghToken').value.trim();
  const remember = document.getElementById('rememberToken').checked;
  const err = document.getElementById('loginError');
  err.classList.add('hidden');

  if (!owner || !repo || !token) {
    err.textContent = 'Vui lòng nhập đầy đủ owner, repo và token.';
    err.classList.remove('hidden'); return;
  }

  // Verify by hitting the repo endpoint
  try {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    });
    if (!r.ok) throw new Error(`Không truy cập được repo (HTTP ${r.status}). Kiểm tra owner/repo/token.`);
  } catch (e) {
    err.textContent = e.message; err.classList.remove('hidden'); return;
  }

  STATE.auth = { owner, repo, branch, token };
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem('ltl_admin_auth', JSON.stringify(STATE.auth));
  enterAdmin();
}

function logout() {
  localStorage.removeItem('ltl_admin_auth');
  sessionStorage.removeItem('ltl_admin_auth');
  STATE.auth = null;
  location.reload();
}

// ---------- GITHUB API ----------
async function ghGet(path) {
  const { owner, repo, branch, token } = STATE.auth;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GET ' + path + ' failed: ' + r.status);
  return r.json();
}

async function ghPut(path, contentBase64, sha, message) {
  const { owner, repo, branch, token } = STATE.auth;
  const body = { message, content: contentBase64, branch };
  if (sha) body.sha = sha;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('PUT ' + path + ' failed: ' + r.status + ' ' + txt);
  }
  return r.json();
}

// UTF-8 safe base64
function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function fromBase64(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
}

async function loadProductsFile() {
  const file = await ghGet(DATA_PATH);
  if (!file) {
    STATE.data = { categories: [], products: [] };
    STATE.sha = null;
  } else {
    STATE.data = JSON.parse(fromBase64(file.content));
    STATE.sha = file.sha;
  }
}

// Purge jsDelivr CDN cache so storefront sees new data within ~10-30s
// (thay vì phải chờ ~2 phút GitHub Pages build).
async function purgeJsdelivrCache() {
  try {
    const url = `https://purge.jsdelivr.net/gh/${STATE.auth.owner}/${STATE.auth.repo}@${STATE.auth.branch}/data/products.json`;
    // no-cors: purge endpoint không cần response, chỉ cần hit
    await fetch(url, { mode: 'no-cors' });
  } catch (e) {
    console.warn('Purge CDN thất bại (không critical):', e.message);
  }
}

async function saveProductsFile(message = 'Cập nhật sản phẩm') {
  const status = document.getElementById('saveStatus');
  status.textContent = '💾 Đang lưu...';
  const content = JSON.stringify(STATE.data, null, 2);
  try {
    const res = await ghPut(DATA_PATH, toBase64(content), STATE.sha, message);
    STATE.sha = res.content.sha;
    status.textContent = '⚡ Đang đồng bộ CDN...';
    await purgeJsdelivrCache();
    status.textContent = '✓ Đã lưu — Shop cập nhật ~5-10s (F5 storefront để thấy ngay)';
    setTimeout(() => status.textContent = '', 6000);
  } catch (e) {
    // 409 Conflict: SHA stale → refresh SHA and retry once
    if (/\b409\b/.test(e.message)) {
      try {
        status.textContent = '⟳ Đồng bộ lại...';
        const file = await ghGet(DATA_PATH);
        if (!file) throw new Error('File không tồn tại sau khi refresh');
        const remote = JSON.parse(fromBase64(file.content));
        STATE.sha = file.sha;
        // Detect if remote has changes that local doesn't know about
        const remoteStr = JSON.stringify(remote);
        if (remoteStr !== content && !confirm('File trên GitHub đã bị thay đổi từ nơi khác. Ghi đè bằng phiên bản hiện tại của bạn?\n\n(Bấm Hủy để load lại bản trên GitHub, mất các thay đổi chưa lưu.)')) {
          STATE.data = remote;
          render();
          status.textContent = '↻ Đã load bản mới từ GitHub';
          setTimeout(() => status.textContent = '', 3000);
          return;
        }
        const res = await ghPut(DATA_PATH, toBase64(content), STATE.sha, message + ' (force after conflict)');
        STATE.sha = res.content.sha;
        status.textContent = '⚡ Đồng bộ CDN...';
        await purgeJsdelivrCache();
        status.textContent = '✓ Đã lưu (sau xung đột) — Shop cập nhật trong ~15s';
        setTimeout(() => status.textContent = '', 5000);
        return;
      } catch (e2) {
        status.textContent = '✗ Lỗi: ' + e2.message;
        alert('Lỗi khi đồng bộ: ' + e2.message);
        return;
      }
    }
    status.textContent = '✗ Lỗi: ' + e.message;
    alert('Lỗi khi lưu: ' + e.message);
  }
}

// ---------- ADMIN UI ----------
async function enterAdmin() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('adminPanel').classList.remove('hidden');
  document.getElementById('repoInfo').textContent = `${STATE.auth.owner}/${STATE.auth.repo} @ ${STATE.auth.branch}`;
  try {
    await loadProductsFile();
    render();
  } catch (e) {
    alert('Lỗi tải dữ liệu: ' + e.message);
  }
}

function switchTab(tab) {
  STATE.tab = tab;
  if (tab !== 'products') { STATE.selection.clear(); const bar = document.getElementById('bulkActionBar'); if (bar) bar.remove(); }
  document.getElementById('paneProducts').classList.toggle('hidden', tab !== 'products');
  document.getElementById('paneCategories').classList.toggle('hidden', tab !== 'categories');
  document.getElementById('tabProducts').className = 'px-4 py-2 text-sm font-medium border-b-2 ' + (tab === 'products' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-blue-600');
  document.getElementById('tabCategories').className = 'px-4 py-2 text-sm font-medium border-b-2 ' + (tab === 'categories' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-blue-600');
  render();
}

function render() {
  if (STATE.tab === 'products') renderProducts();
  else renderCategories();
}

function renderProducts() {
  const list = document.getElementById('productList');
  document.getElementById('productCount').textContent = STATE.data.products.length;
  if (STATE.data.products.length === 0) {
    list.innerHTML = '<div class="bg-white rounded-lg p-8 text-center text-slate-500">Chưa có sản phẩm. Bấm "+ Thêm sản phẩm" để bắt đầu.</div>';
    renderBulkBar();
    return;
  }
  // Reverse so display matches insertion order (oldest first, newest last).
  const visible = STATE.data.products.slice().reverse()
    .filter(p => STATE.filterCat === 'all' || p.category === STATE.filterCat)
    .filter(p => {
      if (STATE.filterProject === 'all') return true;
      if (STATE.filterProject === '__none__') return !p.projectCode && !p.project;
      return (p.projectCode || '') === STATE.filterProject;
    });
  // Clean selection from products no longer present
  for (const id of STATE.selection) if (!STATE.data.products.find(p => p.id === id)) STATE.selection.delete(id);
  const allVisibleSelected = visible.length > 0 && visible.every(p => STATE.selection.has(p.id));
  const catOpts = STATE.data.categories.map(c => `<option value="${c.id}" ${STATE.filterCat === c.id ? 'selected' : ''}>${c.icon || ''} ${c.name} (${STATE.data.products.filter(p => p.category === c.id).length})</option>`).join('');

  // Build distinct project list from products (by projectCode; label from first occurrence)
  const projMap = new Map();
  STATE.data.products.forEach(p => {
    if (!p.projectCode) return;
    if (!projMap.has(p.projectCode)) projMap.set(p.projectCode, { code: p.projectCode, name: p.project || p.projectCode, count: 0 });
    projMap.get(p.projectCode).count++;
  });
  const noProjCount = STATE.data.products.filter(p => !p.projectCode && !p.project).length;
  const projOpts = Array.from(projMap.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    .map(pj => `<option value="${pj.code}" ${STATE.filterProject === pj.code ? 'selected' : ''}>${pj.name} [${pj.code}] (${pj.count})</option>`).join('');

  const toolbar = `
    <div class="bg-white rounded-lg p-3 mb-2 flex flex-wrap items-center gap-3 shadow-sm border border-slate-100">
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" ${allVisibleSelected ? 'checked' : ''} onchange="bulkToggleAllVisible(this.checked)" class="w-4 h-4" />
        Chọn tất cả hiển thị
      </label>
      <div class="h-5 border-l border-slate-200"></div>
      <label class="text-xs text-slate-600">Danh mục:</label>
      <select onchange="bulkSetFilter(this.value)" class="text-sm px-2 py-1 border rounded">
        <option value="all" ${STATE.filterCat === 'all' ? 'selected' : ''}>— Tất cả (${STATE.data.products.length}) —</option>
        ${catOpts}
      </select>
      <label class="text-xs text-slate-600">Dự án:</label>
      <select onchange="bulkSetProjectFilter(this.value)" class="text-sm px-2 py-1 border rounded">
        <option value="all" ${STATE.filterProject === 'all' ? 'selected' : ''}>— Tất cả dự án —</option>
        ${noProjCount ? `<option value="__none__" ${STATE.filterProject === '__none__' ? 'selected' : ''}>(chưa gán) (${noProjCount})</option>` : ''}
        ${projOpts}
      </select>
      <span class="text-xs text-slate-500 ml-auto">${visible.length} sản phẩm hiển thị</span>
    </div>
  `;

  const items = visible.map(p => {
    const cat = STATE.data.categories.find(c => c.id === p.category);
    const img = (p.images && p.images[0]) || 'https://placehold.co/100x100/e2e8f0/64748b?text=?';
    const checked = STATE.selection.has(p.id);
    return `
    <div class="bg-white rounded-lg p-3 flex items-center gap-3 shadow-sm ${checked ? 'ring-2 ring-blue-400' : ''}">
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="bulkToggleOne('${p.id}', this.checked)" class="w-4 h-4 shrink-0" />
      <img src="${img}" class="w-16 h-16 object-cover rounded" />
      <div class="flex-1 min-w-0">
        <div class="font-semibold truncate">${p.name} ${p.featured ? '<span class="text-amber-500">⭐</span>' : ''}</div>
        <div class="text-xs text-slate-500">${cat ? cat.icon + ' ' + cat.name : '(không phân loại)'} • ${p.priceMode === 'contact' ? 'Liên hệ' : fmtVND(p.price)} • Kho: ${p.stock}${p.model ? ' • <span class="font-mono text-brand-700">Model: ' + p.model + '</span>' : ''}${p.projectCode ? ' • <span class="font-mono text-emerald-700">📁 ' + p.projectCode + '</span>' : ''}${p.sku ? ' • SKU: <span class="font-mono">' + p.sku + '</span>' : ''}</div>
        <div class="text-xs text-slate-400 truncate">${(p.tags || []).map(t => '#' + t).join(' ')}</div>
      </div>
      <div class="flex gap-1">
        <button onclick="editProduct('${p.id}')" class="text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded text-sm">Sửa</button>
        <button onclick="deleteProduct('${p.id}')" class="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded text-sm">Xóa</button>
      </div>
    </div>`;
  }).join('');

  list.innerHTML = toolbar + (items || '<div class="bg-white rounded-lg p-8 text-center text-slate-500">Không có sản phẩm trong danh mục này.</div>');
  renderBulkBar();
}

// ---------- BULK SELECT & ACTIONS ----------
function bulkSetFilter(catId) {
  STATE.filterCat = catId;
  renderProducts();
}

function bulkSetProjectFilter(projectCode) {
  STATE.filterProject = projectCode;
  renderProducts();
}

function bulkToggleOne(id, on) {
  if (on) STATE.selection.add(id); else STATE.selection.delete(id);
  renderProducts();
}

function bulkToggleAllVisible(on) {
  const visible = STATE.data.products
    .filter(p => STATE.filterCat === 'all' || p.category === STATE.filterCat)
    .filter(p => {
      if (STATE.filterProject === 'all') return true;
      if (STATE.filterProject === '__none__') return !p.projectCode && !p.project;
      return (p.projectCode || '') === STATE.filterProject;
    });
  if (on) visible.forEach(p => STATE.selection.add(p.id));
  else visible.forEach(p => STATE.selection.delete(p.id));
  renderProducts();
}

function bulkClearSelection() {
  STATE.selection.clear();
  renderProducts();
}

function renderBulkBar() {
  let bar = document.getElementById('bulkActionBar');
  if (STATE.selection.size === 0) { if (bar) bar.remove(); return; }
  const catOpts = STATE.data.categories.map(c => `<option value="${c.id}">${c.icon || ''} ${c.name}</option>`).join('');
  const html = `
    <div id="bulkActionBar" class="fixed bottom-0 left-0 right-0 z-40 bg-gradient-to-r from-blue-600 to-purple-700 text-white shadow-2xl border-t-4 border-white">
      <div class="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
        <div class="font-bold text-base shrink-0">✓ Đã chọn <span class="bg-white text-blue-700 px-2 py-0.5 rounded">${STATE.selection.size}</span> sản phẩm</div>
        <div class="h-6 border-l border-white/30"></div>

        <div class="flex items-center gap-2">
          <select id="bulkCatSelect" class="text-sm px-2 py-1.5 rounded text-slate-800">
            <option value="">— Đổi danh mục —</option>
            ${catOpts}
          </select>
          <button onclick="bulkChangeCategory()" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded text-sm font-semibold">Áp dụng</button>
        </div>

        <button onclick="openBulkEdit()" class="bg-amber-400 hover:bg-amber-500 text-slate-900 font-semibold px-3 py-1.5 rounded text-sm">✏️ Sửa hàng loạt (bảng)</button>
        <button onclick="bulkChangePriceMode('show')" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded text-sm">💰 Hiện giá</button>
        <button onclick="bulkChangePriceMode('contact')" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded text-sm">📞 Liên hệ</button>
        <button onclick="bulkToggleFeatured(true)" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded text-sm">⭐ Nổi bật</button>
        <button onclick="bulkToggleFeatured(false)" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded text-sm">☆ Bỏ nổi bật</button>

        <div class="ml-auto flex items-center gap-2">
          <button onclick="bulkDeleteSelected()" class="bg-red-500 hover:bg-red-600 px-4 py-1.5 rounded text-sm font-bold">🗑 Xóa ${STATE.selection.size}</button>
          <button onclick="bulkClearSelection()" class="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded text-sm">✕ Bỏ chọn</button>
        </div>
      </div>
    </div>
  `;
  if (bar) bar.outerHTML = html;
  else document.body.insertAdjacentHTML('beforeend', html);
}

async function bulkChangeCategory() {
  const catId = document.getElementById('bulkCatSelect').value;
  if (!catId) { alert('Chọn danh mục đích trước.'); return; }
  const cat = STATE.data.categories.find(c => c.id === catId);
  if (!confirm(`Chuyển ${STATE.selection.size} sản phẩm sang danh mục "${cat.name}"?`)) return;
  STATE.data.products.forEach(p => { if (STATE.selection.has(p.id)) p.category = catId; });
  renderProducts();
  await saveProductsFile(`Bulk: chuyển ${STATE.selection.size} SP sang DM "${cat.name}"`);
}

async function bulkChangePriceMode(mode) {
  const label = mode === 'contact' ? '"Liên hệ"' : 'hiện giá cụ thể';
  if (!confirm(`Đổi kiểu giá của ${STATE.selection.size} sản phẩm sang ${label}?`)) return;
  STATE.data.products.forEach(p => { if (STATE.selection.has(p.id)) p.priceMode = mode; });
  renderProducts();
  await saveProductsFile(`Bulk: đổi kiểu giá ${STATE.selection.size} SP → ${mode}`);
}

async function bulkToggleFeatured(on) {
  if (!confirm(`${on ? 'Đánh dấu nổi bật' : 'Bỏ nổi bật'} ${STATE.selection.size} sản phẩm?`)) return;
  STATE.data.products.forEach(p => { if (STATE.selection.has(p.id)) p.featured = on; });
  renderProducts();
  await saveProductsFile(`Bulk: ${on ? 'đánh dấu nổi bật' : 'bỏ nổi bật'} ${STATE.selection.size} SP`);
}

async function bulkDeleteSelected() {
  const n = STATE.selection.size;
  if (!confirm(`⚠️ XÓA ${n} sản phẩm đã chọn? Thao tác không thể hoàn tác.`)) return;
  STATE.data.products = STATE.data.products.filter(p => !STATE.selection.has(p.id));
  STATE.selection.clear();
  renderProducts();
  await saveProductsFile(`Bulk: xóa ${n} sản phẩm`);
}

function renderCategories() {
  const list = document.getElementById('categoryList');
  document.getElementById('catCount').textContent = STATE.data.categories.length;
  if (STATE.data.categories.length === 0) {
    list.innerHTML = '<div class="bg-white rounded-lg p-8 text-center text-slate-500">Chưa có danh mục.</div>';
    return;
  }
  const info = `<div class="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-2 text-xs text-blue-800">
    💡 Thứ tự danh mục ở đây quyết định thứ tự hiển thị trên shop (sidebar, filter). Dùng ↑ ↓ để sắp xếp lại.
  </div>`;
  list.innerHTML = info + STATE.data.categories.map((c, i) => {
    const count = STATE.data.products.filter(p => p.category === c.id).length;
    const isFirst = i === 0;
    const isLast = i === STATE.data.categories.length - 1;
    return `
    <div class="bg-white rounded-lg p-3 flex items-center gap-3 shadow-sm">
      <div class="flex flex-col gap-0.5">
        <button onclick="moveCategory(${i}, -1)" ${isFirst ? 'disabled' : ''} class="text-slate-500 hover:text-brand-700 hover:bg-brand-50 rounded w-6 h-5 flex items-center justify-center text-xs ${isFirst ? 'opacity-30 cursor-not-allowed' : ''}" title="Lên">▲</button>
        <button onclick="moveCategory(${i}, 1)" ${isLast ? 'disabled' : ''} class="text-slate-500 hover:text-brand-700 hover:bg-brand-50 rounded w-6 h-5 flex items-center justify-center text-xs ${isLast ? 'opacity-30 cursor-not-allowed' : ''}" title="Xuống">▼</button>
      </div>
      <div class="text-xs text-slate-400 font-mono w-6 text-center">${i + 1}</div>
      <div class="text-3xl">${c.icon || '📦'}</div>
      <div class="flex-1">
        <div class="font-semibold">${c.name}</div>
        <div class="text-xs text-slate-500">ID: ${c.id} • ${count} sản phẩm</div>
        <div class="text-xs text-slate-400">${c.description || ''}</div>
      </div>
      <div class="flex gap-1">
        <button onclick="editCategory('${c.id}')" class="text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded text-sm">Sửa</button>
        <button onclick="deleteCategory('${c.id}')" class="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded text-sm">Xóa</button>
      </div>
    </div>`;
  }).join('');
}

async function moveCategory(idx, delta) {
  const cats = STATE.data.categories;
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= cats.length) return;
  [cats[idx], cats[newIdx]] = [cats[newIdx], cats[idx]];
  renderCategories();
  await saveProductsFile(`Đổi thứ tự DM: ${cats[newIdx].name} ⇄ ${cats[idx].name}`);
}

// ---------- PRODUCT EDITOR ----------
function newProduct() {
  STATE.editing = {
    id: uid(), name: '', slug: '', sku: '', category: STATE.data.categories[0]?.id || '',
    model: '', project: '', projectCode: '',
    brand: '', origin: '',
    priceMode: 'show', price: 0, originalPrice: 0, currency: 'VND',
    images: [], shortDescription: '', description: '', tags: [],
    stock: 0, featured: false, createdAt: new Date().toISOString().slice(0, 10)
  };
  renderProductEditor(true);
}

function editProduct(id) {
  STATE.editing = JSON.parse(JSON.stringify(STATE.data.products.find(p => p.id === id)));
  renderProductEditor(false);
}

function renderProductEditor(isNew) {
  const p = STATE.editing;
  const catOpts = STATE.data.categories.map(c => `<option value="${c.id}" ${c.id === p.category ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('');
  const imgList = (p.images || []).map((img, i) => `
    <div class="flex items-center gap-2 bg-slate-50 p-2 rounded">
      <img src="${img}" class="w-12 h-12 object-cover rounded" />
      <input type="text" value="${img}" onchange="STATE.editing.images[${i}] = this.value" class="flex-1 text-xs px-2 py-1 border rounded" />
      <button onclick="removeImage(${i})" class="text-red-500 hover:text-red-700 text-sm">✕</button>
    </div>`).join('');

  document.getElementById('editorContent').innerHTML = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold">${isNew ? '+ Sản phẩm mới' : 'Sửa sản phẩm'}</h2>
        <button onclick="closeEditor()" class="text-2xl text-slate-400 hover:text-slate-700">&times;</button>
      </div>
      <div class="space-y-3">
        <div>
          <label class="text-xs font-semibold">Tên sản phẩm *</label>
          <input id="ed_name" type="text" value="${p.name}" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.name=this.value; document.getElementById('ed_slug').value = slugify(this.value); STATE.editing.slug = slugify(this.value);" />
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-xs font-semibold">Slug (URL)</label>
            <input id="ed_slug" type="text" value="${p.slug}" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.slug=this.value" />
          </div>
          <div>
            <label class="text-xs font-semibold">Mã sản phẩm (SKU)</label>
            <input type="text" value="${p.sku || ''}" placeholder="VD: RT113 (tùy chọn)" class="w-full mt-1 px-3 py-2 border rounded font-mono" oninput="STATE.editing.sku=this.value.trim()" />
          </div>
          <div>
            <label class="text-xs font-semibold">Danh mục *</label>
            <select class="w-full mt-1 px-3 py-2 border rounded" onchange="STATE.editing.category=this.value">${catOpts}</select>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="text-xs font-semibold">Model</label>
            <input type="text" value="${p.model || ''}" placeholder="VD: RT113, mBot-R" class="w-full mt-1 px-3 py-2 border rounded font-mono" oninput="STATE.editing.model=this.value.trim()" />
          </div>
          <div>
            <label class="text-xs font-semibold">Dự án</label>
            <input type="text" value="${p.project || ''}" placeholder="VD: Trường TH Đa Kao" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.project=this.value" />
          </div>
          <div>
            <label class="text-xs font-semibold">Mã dự án</label>
            <input type="text" value="${p.projectCode || ''}" placeholder="VD: DAKAO, TS-001" class="w-full mt-1 px-3 py-2 border rounded font-mono" oninput="STATE.editing.projectCode=this.value.trim()" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs font-semibold">Hãng</label>
            <input type="text" value="${p.brand || ''}" placeholder="VD: Makeblock, Sciedu..." class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.brand=this.value" />
          </div>
          <div>
            <label class="text-xs font-semibold">Xuất xứ</label>
            <input type="text" value="${p.origin || ''}" placeholder="VD: Việt Nam, Trung Quốc, Đức..." class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.origin=this.value" />
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold">Cách hiển thị giá</label>
          <div class="flex gap-4 mt-1">
            <label class="flex items-center gap-2 text-sm">
              <input type="radio" name="priceMode" value="show" ${(p.priceMode || 'show') === 'show' ? 'checked' : ''} onchange="STATE.editing.priceMode='show'; togglePriceFields(true)" />
              Hiển thị giá cụ thể
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input type="radio" name="priceMode" value="contact" ${p.priceMode === 'contact' ? 'checked' : ''} onchange="STATE.editing.priceMode='contact'; togglePriceFields(false)" />
              Hiển thị "Liên hệ"
            </label>
          </div>
        </div>
        <div id="priceFields" class="grid grid-cols-3 gap-3 ${p.priceMode === 'contact' ? 'opacity-50' : ''}">
          <div>
            <label class="text-xs font-semibold">Giá bán (VND)</label>
            <input type="number" value="${p.price}" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.price=parseInt(this.value)||0" />
          </div>
          <div>
            <label class="text-xs font-semibold">Giá gốc (VND)</label>
            <input type="number" value="${p.originalPrice}" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.originalPrice=parseInt(this.value)||0" />
          </div>
          <div>
            <label class="text-xs font-semibold">Tồn kho</label>
            <input type="number" value="${p.stock}" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.stock=parseInt(this.value)||0" />
          </div>
        </div>
        <div>
          <label class="text-xs font-semibold">Mô tả ngắn (hiển thị trên card)</label>
          <textarea rows="2" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.shortDescription=this.value">${p.shortDescription || ''}</textarea>
        </div>
        <div>
          <label class="text-xs font-semibold">Mô tả chi tiết</label>
          <textarea rows="6" class="w-full mt-1 px-3 py-2 border rounded font-mono text-sm" oninput="STATE.editing.description=this.value">${p.description || ''}</textarea>
        </div>
        <div>
          <label class="text-xs font-semibold">Tags (phân cách bằng dấu phẩy)</label>
          <input type="text" value="${(p.tags || []).join(', ')}" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.tags = this.value.split(',').map(t=>t.trim()).filter(Boolean)" />
        </div>
        <div>
          <label class="text-xs font-semibold">Hình ảnh</label>
          <div class="space-y-1 mt-1">${imgList || '<div class="text-xs text-slate-400">Chưa có ảnh</div>'}</div>
          <div id="pasteDrop" tabindex="0"
               class="mt-2 border-2 border-dashed border-brand-300 rounded-lg p-3 text-center text-sm text-brand-700 bg-brand-50/50 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400 cursor-pointer">
            📋 <b>Click vào đây</b> rồi <kbd class="bg-white border px-1 rounded text-xs">Ctrl+V</kbd> để paste ảnh từ clipboard
            <div id="pasteDropInfo" class="text-[11px] text-slate-500 mt-0.5">Hoặc kéo–thả file ảnh vào đây</div>
          </div>
          <div class="flex gap-2 mt-2">
            <input id="newImgUrl" type="text" placeholder="Dán URL ảnh..." class="flex-1 px-3 py-1.5 border rounded text-sm" />
            <button onclick="addImageUrl()" class="bg-slate-700 text-white px-3 py-1.5 rounded text-sm">+ URL</button>
            <label class="bg-blue-600 text-white px-3 py-1.5 rounded text-sm cursor-pointer hover:bg-blue-700">
              📤 Chọn file
              <input type="file" accept="image/*" class="hidden" onchange="uploadImage(this)" />
            </label>
          </div>
          <p class="text-[11px] text-slate-500 mt-1">Ảnh sẽ commit vào repo (thư mục /images). Kích thước ≤ 1MB. Có thể paste (Ctrl+V), upload file, hoặc dán URL.</p>
        </div>
        <label class="flex items-center gap-2"><input type="checkbox" ${p.featured ? 'checked' : ''} onchange="STATE.editing.featured=this.checked" /> Sản phẩm nổi bật ⭐</label>
      </div>
      <div class="flex gap-2 mt-6 pt-4 border-t">
        <button onclick="saveProduct(${isNew})" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded">${isNew ? '+ Thêm sản phẩm' : '💾 Lưu thay đổi'}</button>
        <button onclick="closeEditor()" class="px-6 py-2.5 border rounded font-semibold">Hủy</button>
      </div>
    </div>
  `;
  openEditor();
  attachEditorPasteHandlers();
}

function attachEditorPasteHandlers() {
  // Paste ảnh ở bất kỳ đâu trong modal editor
  const modal = document.getElementById('editor');
  if (modal && !modal._pasteBound) {
    modal.addEventListener('paste', editorPasteHandler);
    modal._pasteBound = true;
  }
  // Drag & drop file ảnh vào vùng pasteDrop
  const drop = document.getElementById('pasteDrop');
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('bg-brand-100'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('bg-brand-100'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('bg-brand-100');
      const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
      for (const f of files) uploadImageFile(f);
    });
    // Đảm bảo focus khi click để Ctrl+V có target
    drop.addEventListener('click', () => drop.focus());
  }
}

function togglePriceFields(enabled) {
  const el = document.getElementById('priceFields');
  if (el) el.classList.toggle('opacity-50', !enabled);
}

function addImageUrl() {
  const url = document.getElementById('newImgUrl').value.trim();
  if (!url) return;
  STATE.editing.images = STATE.editing.images || [];
  STATE.editing.images.push(url);
  renderProductEditor(!STATE.data.products.find(p => p.id === STATE.editing.id));
}

function removeImage(i) {
  STATE.editing.images.splice(i, 1);
  renderProductEditor(!STATE.data.products.find(p => p.id === STATE.editing.id));
}

async function uploadImage(input) {
  const file = input.files[0];
  if (!file) return;
  await uploadImageFile(file);
}

async function uploadImageFile(file, sourceLabel) {
  if (!file) return;
  if (file.size > 1024 * 1024) { alert('Ảnh quá lớn (>1MB). Resize trước.'); return; }
  const status = document.getElementById('saveStatus');
  const dropInfo = document.getElementById('pasteDropInfo');
  if (dropInfo) dropInfo.textContent = '📤 Đang upload...';
  status.textContent = '📤 Đang upload ảnh...';
  try {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const baseName = file.name ? file.name.replace(/\.[^.]+$/, '') : (sourceLabel || 'clipboard');
    const ext = (file.type.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
    const path = `images/${Date.now()}-${slugify(baseName) || 'img'}.${ext}`;
    const res = await ghPut(path, b64, null, 'Upload ảnh: ' + (file.name || sourceLabel || 'clipboard'));
    const url = res.content.download_url;
    STATE.editing.images = STATE.editing.images || [];
    STATE.editing.images.push(url);
    status.textContent = '✓ Đã upload ảnh';
    setTimeout(() => status.textContent = '', 2500);
    renderProductEditor(!STATE.data.products.find(p => p.id === STATE.editing.id));
  } catch (e) {
    alert('Lỗi upload: ' + e.message);
    status.textContent = '';
  }
}

// Bắt Ctrl+V ảnh clipboard trong editor sản phẩm (single product)
function editorPasteHandler(e) {
  if (!STATE.editing || !STATE.editing.hasOwnProperty('images')) return;
  const cb = e.clipboardData || window.clipboardData;
  if (!cb) return;
  // Nếu đang paste text vào 1 ô input/textarea thì bỏ qua (chỉ intercept khi có ảnh)
  const items = cb.items || [];
  for (const it of items) {
    if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
      const file = it.getAsFile();
      if (file) {
        e.preventDefault();
        uploadImageFile(file, 'clipboard-paste');
        return;
      }
    }
  }
}

async function saveProduct(isNew) {
  const p = STATE.editing;
  if (!p.name) { alert('Tên sản phẩm bắt buộc.'); return; }
  if (p.sku) {
    const dup = STATE.data.products.find(x => x.sku === p.sku && x.id !== p.id);
    if (dup) { alert('Mã sản phẩm "' + p.sku + '" đã tồn tại ở sản phẩm: ' + dup.name); return; }
  }
  if (isNew) STATE.data.products.unshift(p);
  else {
    const idx = STATE.data.products.findIndex(x => x.id === p.id);
    STATE.data.products[idx] = p;
  }
  closeEditor();
  render();
  await saveProductsFile((isNew ? 'Thêm SP: ' : 'Cập nhật SP: ') + p.name);
}

async function deleteProduct(id) {
  const p = STATE.data.products.find(x => x.id === id);
  if (!confirm(`Xóa sản phẩm "${p.name}"?`)) return;
  STATE.data.products = STATE.data.products.filter(x => x.id !== id);
  render();
  await saveProductsFile('Xóa SP: ' + p.name);
}

// ---------- BULK IMPORT ----------
const BULK_COLUMNS = [
  { key: 'name',             label: 'Tên sản phẩm *',           required: true },
  { key: 'model',            label: 'Model',                    required: false },
  { key: 'project',          label: 'Dự án',                    required: false },
  { key: 'projectCode',      label: 'Mã dự án',                 required: false },
  { key: 'sku',              label: 'Mã SP (SKU)',              required: false },
  { key: 'category',         label: 'Danh mục (id hoặc tên)',   required: false },
  { key: 'brand',            label: 'Hãng',                     required: false },
  { key: 'origin',           label: 'Xuất xứ',                  required: false },
  { key: 'priceMode',        label: 'Kiểu giá (show/contact)',  required: false },
  { key: 'price',            label: 'Giá bán',                  required: false },
  { key: 'originalPrice',    label: 'Giá gốc',                  required: false },
  { key: 'stock',            label: 'Tồn kho',                  required: false },
  { key: 'shortDescription', label: 'Mô tả ngắn',               required: false, multiline: true },
  { key: 'description',      label: 'Mô tả chi tiết',           required: false, multiline: true },
  { key: 'tags',             label: 'Tags (phẩy)',              required: false },
  { key: 'images',           label: 'Ảnh (URL, phẩy)',          required: false },
  { key: 'featured',         label: 'Nổi bật (true/false)',     required: false }
];

const BULK_COL_WIDTH = {
  name: 220, model: 120, project: 160, projectCode: 120, sku: 110, category: 140, brand: 130, origin: 130,
  priceMode: 110, price: 110, originalPrice: 110, stock: 80, shortDescription: 240, description: 280,
  tags: 170, images: 220, featured: 90
};

function openBulkImport() {
  const catList = STATE.data.categories.map(c => `<span class="font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[11px]">${c.id}</span>`).join(' ');

  // Widen modal for the spreadsheet view
  const box = document.getElementById('editorBox');
  if (box) { box.classList.remove('max-w-3xl'); box.classList.add('max-w-7xl'); }

  document.getElementById('editorContent').innerHTML = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-3">
        <h2 class="text-xl font-bold">📥 Nhập sản phẩm hàng loạt</h2>
        <button onclick="closeEditor()" class="text-2xl text-slate-400 hover:text-slate-700">&times;</button>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-xs flex flex-wrap gap-x-4 gap-y-1">
        <span class="font-semibold text-blue-800">💡 Cách dùng:</span>
        <span>• Nhập trực tiếp vào ô như Google Sheet</span>
        <span>• Copy từ Excel/Sheets → click ô đầu → <kbd class="bg-white border px-1 rounded">Ctrl+V</kbd> (trải nhiều dòng/cột)</span>
        <span>• <b>Paste ảnh từ clipboard</b> vào ô "Ảnh" → tự upload lên GitHub</span>
        <span>• <b>Bỏ tick ☑ ở header cột</b> nếu không muốn nhập cột đó (dữ liệu cột đó bị bỏ qua)</span>
        <span>• <kbd class="bg-white border px-1 rounded">Ctrl+Z</kbd> hoàn tác thao tác paste/xóa/thêm dòng gần nhất</span>
        <span>• Ô Mô tả là <b>textarea</b> — Enter xuống dòng trong ô; <kbd class="bg-white border px-1 rounded">Ctrl+Enter</kbd> nhảy xuống dòng lưới</span>
      </div>

      <div class="bg-slate-50 border border-slate-200 rounded-lg p-2 mb-2 text-[11px]">
        <span class="font-semibold text-slate-700">Danh mục hợp lệ (cột "Danh mục"):</span> ${catList || '<i>chưa có</i>'}
      </div>

      <div class="flex gap-2 mb-2 items-center">
        <button onclick="bulkAddRow(1)" class="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-1 rounded">+ 1 dòng</button>
        <button onclick="bulkAddRow(5)" class="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-1 rounded">+ 5 dòng</button>
        <button onclick="bulkFillSample()" class="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-1 rounded">📝 Mẫu</button>
        <button onclick="bulkClear()" class="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-1 rounded">🗑 Xóa hết</button>
        <span class="text-[11px] text-slate-500 ml-auto" id="bulkRowInfo"></span>
      </div>

      <div id="bulkGridWrap" class="overflow-auto border border-slate-300 rounded-lg max-h-[70vh] bg-white">
        <table class="border-collapse text-xs w-max">
          <thead>
            <tr>
              <th class="bg-slate-200 border border-slate-300 px-1 py-1.5 w-10 text-slate-600 sticky top-0 left-0 z-30">#</th>
              ${BULK_COLUMNS.map((c, ci) => {
                const cb = c.required
                  ? `<input type="checkbox" data-col-include="${ci}" checked disabled title="Cột bắt buộc — không thể bỏ qua" class="w-4 h-4 opacity-60 cursor-not-allowed" />`
                  : `<input type="checkbox" data-col-include="${ci}" checked onchange="bulkToggleColInclude(${ci}, this.checked)" title="Bỏ tick để bỏ qua cột này" class="w-4 h-4" />`;
                const thStick = ci === 0 ? 'sticky top-0 left-10 z-20' : 'sticky top-0 z-20';
                return `<th class="bg-purple-100 border border-slate-300 px-2 py-1.5 text-left text-brand-700 font-semibold whitespace-nowrap ${thStick}" style="min-width:${BULK_COL_WIDTH[c.key]}px">
                  <label class="flex items-center gap-1.5 ${c.required ? '' : 'cursor-pointer'} select-none">
                    ${cb}
                    <span data-col-label="${ci}">${c.label}</span>
                  </label>
                </th>`;
              }).join('')}
              <th class="bg-purple-100 border border-slate-300 px-1 w-8 sticky top-0 z-20"></th>
            </tr>
          </thead>
          <tbody id="bulkGridBody"></tbody>
        </table>
      </div>

      <div class="flex gap-2 mt-3">
        <button onclick="bulkPreview()" class="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 rounded">👁 Xem trước & kiểm tra</button>
        <button onclick="closeEditor()" class="px-6 py-2 border rounded font-semibold">Hủy</button>
      </div>

      <div id="bulkPreview" class="mt-4"></div>
    </div>
  `;
  openEditor();
  bulkResetHistory();
  bulkAddRow(10);
  document.getElementById('bulkGridWrap').addEventListener('paste', bulkPasteHandler);
  document.getElementById('bulkGridWrap').addEventListener('keydown', bulkKeyNav);
}

function bulkRowHtml(idx) {
  return `<tr data-row="${idx}">
    <td class="bg-slate-50 border border-slate-300 px-1 text-center text-slate-500 text-[11px] sticky left-0 z-10 align-top pt-2">${idx + 1}</td>
    ${BULK_COLUMNS.map((c, ci) => {
      // Cột đầu (Tên) sticky ngay sau # để luôn nhìn thấy khi cuộn ngang.
      const isNameCol = ci === 0;
      const tdCls = isNameCol
        ? 'border border-slate-200 p-0 align-top sticky left-10 z-10 bg-white'
        : 'border border-slate-200 p-0 align-top';
      if (c.multiline) {
        return `<td class="${tdCls}">
          <textarea data-col="${ci}" data-key="${c.key}" rows="2"
            class="w-full px-2 py-1.5 outline-none focus:bg-yellow-50 focus:ring-2 focus:ring-inset focus:ring-brand-400 resize-y text-xs leading-snug"
            style="min-height:2.4rem"></textarea>
        </td>`;
      }
      return `<td class="${tdCls}">
        <input type="text" data-col="${ci}" data-key="${c.key}"
          class="w-full px-2 py-1.5 outline-none focus:bg-yellow-50 focus:ring-2 focus:ring-inset focus:ring-brand-400" />
      </td>`;
    }).join('')}
    <td class="border border-slate-200 text-center align-top pt-2"><button onclick="bulkRemoveRow(this)" class="text-red-400 hover:text-red-600 px-1" title="Xóa dòng">✕</button></td>
  </tr>`;
}

function bulkAddRow(n = 1, snap = false) {
  if (snap) bulkSnapshot();
  const body = document.getElementById('bulkGridBody');
  for (let i = 0; i < n; i++) {
    const idx = body.children.length;
    body.insertAdjacentHTML('beforeend', bulkRowHtml(idx));
  }
  bulkUpdateRowInfo();
}

function bulkRemoveRow(btn) {
  bulkSnapshot();
  btn.closest('tr').remove();
  bulkReindexRows();
}

function bulkReindexRows() {
  document.querySelectorAll('#bulkGridBody tr').forEach((tr, i) => {
    tr.dataset.row = i;
    tr.children[0].textContent = i + 1;
  });
  bulkUpdateRowInfo();
}

function bulkUpdateRowInfo() {
  const total = document.querySelectorAll('#bulkGridBody tr').length;
  const filled = Array.from(document.querySelectorAll('#bulkGridBody tr')).filter(tr =>
    Array.from(tr.querySelectorAll('[data-col]')).some(i => i.value.trim())
  ).length;
  const el = document.getElementById('bulkRowInfo');
  if (el) el.textContent = `${filled}/${total} dòng có dữ liệu`;
}

function bulkClear() {
  bulkSnapshot();
  document.querySelectorAll('#bulkGridBody input').forEach(i => i.value = '');
  const pv = document.getElementById('bulkPreview'); if (pv) pv.innerHTML = '';
  bulkUpdateRowInfo();
}

function bulkFillSample() {
  bulkSnapshot();
  const sample = [
    ['Robot mBot Ranger', 'RBT-001', 'robotics', 'show', '2500000', '3000000', '15', 'Robot lập trình STEM cho HS THCS', 'Bộ kit Ranger 3-trong-1 — xe đua, xe tăng, vượt địa hình. Scratch/Python.', 'robot,stem,thcs', '', 'true'],
    ['Kit Arduino Starter', 'ARD-100', 'stem-kit', 'show', '850000', '0', '30', 'Bộ Arduino cơ bản cho người mới', 'Board Uno R3, breadboard, LED, điện trở, cảm biến cơ bản.', 'arduino,stem,thpt', '', 'false'],
    ['AI Vision Box', 'AIV-200', 'ai-iot', 'contact', '0', '0', '5', 'Camera AI nhận diện vật thể real-time', 'Edge AI dùng Jetson Nano, train model nhận diện vật thể.', 'ai,vision,iot', '', 'true']
  ];
  bulkFillGrid(sample, 0, 0);
}

function bulkFillGrid(matrix, startRow, startCol) {
  const body = document.getElementById('bulkGridBody');
  while (body.children.length < startRow + matrix.length) bulkAddRow(1);
  matrix.forEach((row, r) => {
    const tr = body.children[startRow + r];
    const inputs = tr.querySelectorAll('[data-col]');
    row.forEach((val, c) => {
      const target = inputs[startCol + c];
      if (target) target.value = (val || '').toString();
    });
  });
  bulkUpdateRowInfo();
}

// ---------- BULK GRID UNDO (Ctrl+Z snapshots) ----------
const BULK_HISTORY_MAX = 50;
let bulkHistory = [];

function bulkResetHistory() { bulkHistory = []; }

function bulkSnapshot() {
  const rows = [];
  document.querySelectorAll('#bulkGridBody tr').forEach(tr => {
    const productId = tr.dataset.productId || null;
    const cells = Array.from(tr.querySelectorAll('[data-col]')).map(i => i.value);
    rows.push({ productId, cells });
  });
  bulkHistory.push(rows);
  if (bulkHistory.length > BULK_HISTORY_MAX) bulkHistory.shift();
}

function bulkUndo() {
  if (!bulkHistory.length) return false;
  const snap = bulkHistory.pop();
  const body = document.getElementById('bulkGridBody');
  if (!body) return false;
  body.innerHTML = '';
  snap.forEach((row, i) => {
    body.insertAdjacentHTML('beforeend', bulkRowHtml(i));
    const tr = body.children[i];
    if (row.productId) tr.dataset.productId = row.productId;
    const inputs = tr.querySelectorAll('[data-col]');
    row.cells.forEach((v, ci) => { if (inputs[ci]) inputs[ci].value = v; });
  });
  // Reapply column-disabled state per current header checkboxes
  document.querySelectorAll('[data-col-include]').forEach(cb => {
    bulkToggleColInclude(+cb.dataset.colInclude, cb.checked);
  });
  bulkUpdateRowInfo();
  return true;
}

function bulkToggleColInclude(ci, on) {
  const label = document.querySelector(`[data-col-label="${ci}"]`);
  if (label) label.style.textDecoration = on ? '' : 'line-through';
  document.querySelectorAll(`#bulkGridBody input[data-col="${ci}"]`).forEach(inp => {
    inp.disabled = !on;
    inp.classList.toggle('bg-slate-100', !on);
    inp.classList.toggle('text-slate-400', !on);
  });
}

function bulkGetIncludedCols() {
  const inc = [];
  document.querySelectorAll('[data-col-include]').forEach(cb => {
    if (cb.checked) inc.push(+cb.dataset.colInclude);
  });
  return inc;
}

async function bulkUploadImageToCell(file, input) {
  if (file.size > 1024 * 1024) { alert('Ảnh quá lớn (>1MB). Resize trước khi paste.'); return; }
  const orig = input.value;
  const wasDisabled = input.disabled;
  input.disabled = true;
  input.value = '⏳ Đang upload ảnh...';
  try {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const ext = (file.type.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
    const path = `images/${Date.now()}-bulk-clip.${ext}`;
    const res = await ghPut(path, b64, null, 'Upload ảnh clipboard (bulk)');
    const url = res.content.download_url;
    input.value = orig ? orig + ',' + url : url;
    bulkUpdateRowInfo();
  } catch (e) {
    alert('Upload thất bại: ' + e.message);
    input.value = orig;
  } finally {
    input.disabled = wasDisabled;
  }
}

// Proper TSV parser that respects "..." quoted cells (Excel/Sheets format).
// A cell with newlines/tabs inside is wrapped in "..." and embedded " is escaped as "".
function parseTSVMatrix(text) {
  const rows = [];
  let cur = '', row = [], inQ = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"' && cur === '') { inQ = true; }
      else if (ch === '\t') { row.push(cur); cur = ''; }
      else if (ch === '\r') { /* skip; \n handles line end */ }
      else if (ch === '\n') { row.push(cur); rows.push(row); cur = ''; row = []; }
      else cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

function bulkPasteHandler(e) {
  const cb = e.clipboardData || window.clipboardData;
  if (!cb) return;
  const active = document.activeElement;

  // 1) Image paste — clipboard has an image file AND focus is on "images" cell
  if (active && active.tagName === 'INPUT' && active.dataset.key === 'images') {
    const items = cb.items || [];
    for (const it of items) {
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          bulkSnapshot();
          bulkUploadImageToCell(file, active);
          return;
        }
      }
    }
  }

  // 2) Text paste
  const text = cb.getData('text/plain');
  if (!text) return;
  // Nếu KHÔNG có tab → text đơn (kể cả có newline) → để browser paste native
  // (textarea giữ newline; input nuốt newline). Tránh việc paste đoạn văn bản nhiều dòng
  // vào 1 ô lại bị hiểu là nhiều dòng lưới.
  if (!text.includes('\t')) return;
  const matrix = parseTSVMatrix(text);
  e.preventDefault();
  let startRow = 0, startCol = 0;
  if (active && active.tagName === 'INPUT' && active.dataset.col) {
    const tr = active.closest('tr');
    startRow = +tr.dataset.row;
    startCol = +active.dataset.col;
  }
  bulkSnapshot();
  bulkFillGrid(matrix, startRow, startCol);
}

function bulkKeyNav(e) {
  // Grid-level Ctrl+Z: undo last major op (paste / fill sample / clear / add / remove row)
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    if (bulkHistory.length) {
      e.preventDefault();
      bulkUndo();
      return;
    }
  }
  const t = e.target;
  if (!t.dataset || !t.dataset.col) return;
  const isTextarea = t.tagName === 'TEXTAREA';
  const tr = t.closest('tr');
  const row = +tr.dataset.row;
  const col = +t.dataset.col;
  const body = document.getElementById('bulkGridBody');
  let next = null;
  if (e.key === 'Enter' && !isTextarea) {
    e.preventDefault();
    const nextTr = body.children[row + 1];
    if (nextTr) next = nextTr.querySelectorAll('[data-col]')[col];
    else { bulkAddRow(1); next = body.children[row + 1].querySelectorAll('[data-col]')[col]; }
  } else if (e.key === 'Enter' && isTextarea && (e.ctrlKey || e.metaKey)) {
    // Ctrl+Enter trong textarea = di chuyển xuống dòng dưới
    e.preventDefault();
    const nextTr = body.children[row + 1];
    if (nextTr) next = nextTr.querySelectorAll('[data-col]')[col];
    else { bulkAddRow(1); next = body.children[row + 1].querySelectorAll('[data-col]')[col]; }
  } else if (e.key === 'ArrowDown' && !e.shiftKey && !isTextarea) {
    const nextTr = body.children[row + 1];
    if (nextTr) { e.preventDefault(); next = nextTr.querySelectorAll('[data-col]')[col]; }
  } else if (e.key === 'ArrowUp' && !e.shiftKey && !isTextarea) {
    const prevTr = body.children[row - 1];
    if (prevTr) { e.preventDefault(); next = prevTr.querySelectorAll('[data-col]')[col]; }
  }
  if (next) { next.focus(); next.select && next.select(); }
  bulkUpdateRowInfo();
}

function parseBulkLine(line) {
  // Detect delimiter: tab if found, else comma
  const delim = line.includes('\t') ? '\t' : ',';
  // Simple split — no quoted-CSV parsing. For most spreadsheet pastes via tab, this is safe.
  if (delim === '\t') return line.split('\t');
  // Naive CSV: handle "..." wrapped values containing commas
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

function parseBulkData(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  const errors = [];
  const seenSkus = new Set();
  const existingSkus = new Set(STATE.data.products.filter(p => p.sku).map(p => p.sku));

  for (let i = 0; i < lines.length; i++) {
    const cells = parseBulkLine(lines[i]).map(c => c.trim());
    const row = {};
    BULK_COLUMNS.forEach((col, idx) => row[col.key] = cells[idx] || '');

    const rowErrs = [];
    if (!row.name) rowErrs.push('thiếu tên');
    if (row.sku && seenSkus.has(row.sku)) rowErrs.push('SKU trùng trong file');
    if (row.sku && existingSkus.has(row.sku)) rowErrs.push('SKU đã tồn tại');
    if (row.sku) seenSkus.add(row.sku);

    // Resolve category by id or name
    let catId = '';
    if (row.category) {
      const norm = row.category.toLowerCase();
      const cat = STATE.data.categories.find(c => c.id.toLowerCase() === norm || c.name.toLowerCase() === norm);
      if (cat) catId = cat.id;
      else rowErrs.push('danh mục không tồn tại: "' + row.category + '"');
    } else if (STATE.data.categories.length) {
      catId = STATE.data.categories[0].id;
    }

    rows.push({
      line: i + 1,
      raw: row,
      errors: rowErrs,
      product: {
        id: uid(),
        name: row.name,
        sku: row.sku || '',
        slug: slugify(row.name),
        category: catId,
        model: row.model || '',
        project: row.project || '',
        projectCode: row.projectCode || '',
        brand: row.brand || '',
        origin: row.origin || '',
        priceMode: (row.priceMode || 'show').toLowerCase() === 'contact' ? 'contact' : 'show',
        price: parseInt(row.price) || 0,
        originalPrice: parseInt(row.originalPrice) || 0,
        currency: 'VND',
        stock: parseInt(row.stock) || 0,
        shortDescription: row.shortDescription || '',
        description: row.description || '',
        tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        images: row.images ? row.images.split(',').map(t => t.trim()).filter(Boolean) : [],
        featured: /^(true|1|yes|y|x)$/i.test(row.featured || ''),
        createdAt: new Date().toISOString().slice(0, 10)
      }
    });
  }
  return rows;
}

function bulkPreview() {
  const includedCols = new Set(bulkGetIncludedCols());
  const lines = [];
  document.querySelectorAll('#bulkGridBody tr').forEach(tr => {
    const vals = Array.from(tr.querySelectorAll('[data-col]')).map((i, ci) =>
      includedCols.has(ci) ? i.value : ''
    );
    if (vals.some(v => v.trim())) lines.push(vals.join('\t'));
  });
  if (!lines.length) { alert('Lưới chưa có dữ liệu. Nhập tay hoặc paste từ Excel.'); return; }
  const rows = parseBulkData(lines.join('\n'));
  const okCount = rows.filter(r => !r.errors.length).length;
  const errCount = rows.length - okCount;

  document.getElementById('bulkPreview').innerHTML = `
    <div class="bg-white border rounded-lg overflow-hidden">
      <div class="bg-slate-50 px-3 py-2 border-b flex items-center justify-between">
        <div class="text-sm">
          <span class="font-semibold">${rows.length}</span> dòng •
          <span class="text-emerald-700 font-semibold">${okCount} OK</span>${errCount ? ' • <span class="text-red-600 font-semibold">' + errCount + ' lỗi</span>' : ''}
        </div>
        ${okCount > 0 ? `<button onclick="bulkConfirmImport()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-1.5 rounded text-sm">✓ Nhập ${okCount} sản phẩm</button>` : ''}
      </div>
      <div class="max-h-72 overflow-auto">
        <table class="w-full text-xs">
          <thead class="bg-slate-100 sticky top-0">
            <tr>
              <th class="px-2 py-1.5 text-left">#</th>
              <th class="px-2 py-1.5 text-left">Tên</th>
              <th class="px-2 py-1.5 text-left">SKU</th>
              <th class="px-2 py-1.5 text-left">DM</th>
              <th class="px-2 py-1.5 text-right">Giá</th>
              <th class="px-2 py-1.5 text-left">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr class="${r.errors.length ? 'bg-red-50' : ''} border-t border-slate-100">
                <td class="px-2 py-1.5 text-slate-500">${r.line}</td>
                <td class="px-2 py-1.5 font-medium">${r.raw.name || '<span class="text-red-500">—</span>'}</td>
                <td class="px-2 py-1.5 font-mono">${r.raw.sku || '<span class="text-red-500">—</span>'}</td>
                <td class="px-2 py-1.5">${r.product.category || '<span class="text-slate-400">—</span>'}</td>
                <td class="px-2 py-1.5 text-right">${r.product.priceMode === 'contact' ? 'Liên hệ' : fmtVND(r.product.price)}</td>
                <td class="px-2 py-1.5">${r.errors.length ? '<span class="text-red-600">✗ ' + r.errors.join('; ') + '</span>' : '<span class="text-emerald-600">✓ OK</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  window._bulkParsed = rows;
}

// ---------- BULK IMAGE UPLOAD (nhiều ảnh cùng lúc → trả URL để dán Excel) ----------
async function bulkUploadImages(input) {
  const files = Array.from(input.files || []).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;

  // Open modal — reuse editor modal for display
  const box = document.getElementById('editorBox');
  if (box) { box.classList.remove('max-w-3xl'); box.classList.add('max-w-4xl'); }

  const rows = files.map((f, i) => ({
    idx: i,
    file: f,
    name: f.name,
    size: (f.size / 1024).toFixed(0) + ' KB',
    url: null,
    error: null,
    status: 'pending'
  }));

  const renderTable = () => {
    const done = rows.filter(r => r.status === 'done').length;
    const failed = rows.filter(r => r.status === 'error').length;
    document.getElementById('editorContent').innerHTML = `
      <div class="p-6">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold">🖼 Upload ${files.length} ảnh — ${done}/${files.length} xong${failed ? `, ${failed} lỗi` : ''}</h2>
          <button onclick="closeEditor()" class="text-2xl text-slate-400 hover:text-slate-700">&times;</button>
        </div>
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-xs text-blue-900">
          💡 Sau khi upload xong, bấm <b>Copy tất cả URL</b> hoặc copy từng URL → dán vào cột <b>"Ảnh (URL, phẩy)"</b> trong Excel.
          Nhiều ảnh cho 1 SP: tách bằng dấu phẩy trong cùng ô Excel.
        </div>
        <div class="border border-slate-200 rounded-lg max-h-[60vh] overflow-auto">
          <table class="w-full text-xs">
            <thead class="bg-slate-100 sticky top-0">
              <tr>
                <th class="px-2 py-1.5 text-left w-8">#</th>
                <th class="px-2 py-1.5 text-left">Tên file</th>
                <th class="px-2 py-1.5 text-left w-20">Cỡ</th>
                <th class="px-2 py-1.5 text-left">URL / trạng thái</th>
                <th class="px-2 py-1.5 w-16"></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr class="border-t border-slate-100 ${r.status === 'error' ? 'bg-red-50' : (r.status === 'done' ? 'bg-emerald-50' : '')}">
                  <td class="px-2 py-1.5 text-slate-500">${r.idx + 1}</td>
                  <td class="px-2 py-1.5 font-medium truncate max-w-xs">${r.name}</td>
                  <td class="px-2 py-1.5">${r.size}</td>
                  <td class="px-2 py-1.5">
                    ${r.status === 'pending' ? '<span class="text-slate-400">⏳ đang chờ...</span>' : ''}
                    ${r.status === 'uploading' ? '<span class="text-blue-600">📤 uploading...</span>' : ''}
                    ${r.status === 'done' ? `<input type="text" readonly value="${r.url}" onclick="this.select()" class="w-full px-2 py-0.5 text-[11px] bg-white border rounded font-mono" />` : ''}
                    ${r.status === 'error' ? `<span class="text-red-600">✗ ${r.error}</span>` : ''}
                  </td>
                  <td class="px-2 py-1.5">
                    ${r.status === 'done' ? `<button onclick="bulkCopyLink(this, '${r.url.replace(/'/g, "\\'")}')" class="text-xs bg-brand-100 hover:bg-brand-200 text-brand-700 px-2 py-1 rounded">📋</button>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="flex gap-2 mt-3">
          ${done > 0 ? `
            <button onclick="bulkCopyAllUploadedUrls()" class="flex-1 bg-brand-600 hover:bg-brand-700 text-white font-semibold py-2 rounded">📋 Copy tất cả URL (${done})</button>
            <button onclick="bulkCopyAllUploadedUrls('csv')" class="bg-slate-600 hover:bg-slate-700 text-white font-semibold px-4 py-2 rounded">📋 Copy CSV (phẩy)</button>
          ` : ''}
          <button onclick="closeEditor()" class="px-6 py-2 border rounded font-semibold">Đóng</button>
        </div>
      </div>
    `;
  };

  openEditor();
  window._uploadedRows = rows;
  renderTable();

  // Upload tuần tự (tránh rate-limit GitHub API)
  for (const r of rows) {
    r.status = 'uploading';
    renderTable();
    try {
      if (r.file.size > 1024 * 1024) throw new Error('>1MB');
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = () => res(rd.result.split(',')[1]);
        rd.onerror = rej;
        rd.readAsDataURL(r.file);
      });
      const baseName = r.file.name.replace(/\.[^.]+$/, '');
      const ext = (r.file.type.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
      const path = `images/${Date.now()}-${slugify(baseName) || 'img'}.${ext}`;
      const res = await ghPut(path, b64, null, 'Bulk upload ảnh: ' + r.file.name);
      r.url = res.content.download_url;
      r.status = 'done';
    } catch (e) {
      r.status = 'error';
      r.error = e.message;
    }
    renderTable();
  }

  input.value = '';
}

function bulkCopyAllUploadedUrls(format) {
  const rows = window._uploadedRows || [];
  const urls = rows.filter(r => r.status === 'done').map(r => r.url);
  if (!urls.length) return;
  const text = format === 'csv' ? urls.join(', ') : urls.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    alert(`✓ Đã copy ${urls.length} URL (${format === 'csv' ? 'phân cách phẩy — dán vào 1 ô Excel' : 'mỗi URL 1 dòng — dán vào cột'})`);
  }).catch(() => prompt('Copy thủ công:', text));
}

// ---------- EXCEL EXPORT / IMPORT (SheetJS) ----------
async function ensureSheetJS() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Không tải được thư viện SheetJS'));
    document.head.appendChild(s);
  });
  return window.XLSX;
}

async function exportProductsExcel() {
  const status = document.getElementById('saveStatus');
  status.textContent = '📊 Đang chuẩn bị Excel...';
  try {
    const XLSX = await ensureSheetJS();
    // Header: id (ẩn ID để match khi import lại) + các cột BULK_COLUMNS
    const header = ['id', ...BULK_COLUMNS.map(c => c.label.replace(' *', ''))];
    // Data theo thứ tự hiển thị (cũ → mới)
    const products = STATE.data.products.slice().reverse();
    const rows = [header];
    products.forEach(p => {
      const row = [p.id];
      BULK_COLUMNS.forEach(c => {
        const v = p[c.key];
        if (c.key === 'tags' || c.key === 'images') row.push((v || []).join(', '));
        else if (c.key === 'featured') row.push(v ? 'true' : 'false');
        else if (c.key === 'priceMode') row.push(v || 'show');
        else if (c.key === 'category') {
          const cat = STATE.data.categories.find(x => x.id === v);
          row.push(cat ? cat.id : (v || ''));
        }
        else if (v === undefined || v === null) row.push('');
        else row.push(v);
      });
      rows.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Width gợi ý theo BULK_COL_WIDTH (px → xấp xỉ ký tự)
    ws['!cols'] = [{ wch: 14 }, ...BULK_COLUMNS.map(c => ({ wch: Math.max(12, Math.min(48, Math.round((BULK_COL_WIDTH[c.key] || 130) / 8))) }))];
    ws['!freeze'] = { xSplit: 2, ySplit: 1 }; // freeze cột id + tên + hàng header
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sản phẩm');
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `LtL-Shop-products-${today}.xlsx`);
    status.textContent = `✓ Đã xuất ${products.length} SP ra Excel`;
    setTimeout(() => status.textContent = '', 4000);
  } catch (e) {
    status.textContent = '';
    alert('Lỗi xuất Excel: ' + e.message);
  }
}

async function importExcelFile(input) {
  const file = input.files[0];
  if (!file) return;
  const status = document.getElementById('saveStatus');
  status.textContent = '📤 Đang đọc file...';
  try {
    const XLSX = await ensureSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) throw new Error('File rỗng hoặc chỉ có header.');

    // Header → column key map
    const header = rows[0].map(h => String(h).trim());
    const idIdx = header.findIndex(h => h.toLowerCase() === 'id');
    const colMap = {}; // colIdx → BULK_COLUMN key
    BULK_COLUMNS.forEach(c => {
      const label = c.label.replace(' *', '');
      const idx = header.findIndex(h => h === label || h.toLowerCase() === c.key.toLowerCase());
      if (idx !== -1) colMap[idx] = c.key;
    });
    if (!Object.values(colMap).includes('name')) {
      throw new Error('Không tìm thấy cột "Tên sản phẩm" trong file. Xuất Excel từ đây trước để lấy template chuẩn.');
    }

    const updates = [];
    const inserts = [];
    const errors = [];
    const skippedEmpty = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (row.every(v => !String(v).trim())) { skippedEmpty.push(r + 1); continue; }
      const id = idIdx !== -1 ? String(row[idIdx] || '').trim() : '';
      const existing = id ? STATE.data.products.find(p => p.id === id) : null;

      const changes = {};
      Object.entries(colMap).forEach(([ci, key]) => {
        const val = String(row[ci] ?? '').trim();
        switch (key) {
          case 'price':
          case 'originalPrice':
          case 'stock':
            changes[key] = parseInt(String(val).replace(/[^\d-]/g, '')) || 0; break;
          case 'priceMode':
            changes[key] = val.toLowerCase() === 'contact' ? 'contact' : 'show'; break;
          case 'featured':
            changes[key] = /^(true|1|yes|y|x|✓)$/i.test(val); break;
          case 'tags':
          case 'images':
            changes[key] = val ? val.split(/[,;\n]/).map(t => t.trim()).filter(Boolean) : []; break;
          case 'category':
            if (val) {
              const cat = STATE.data.categories.find(c => c.id.toLowerCase() === val.toLowerCase() || c.name.toLowerCase() === val.toLowerCase());
              if (cat) changes.category = cat.id;
              else errors.push(`Dòng ${r + 1}: danh mục "${val}" không tồn tại`);
            } else changes.category = '';
            break;
          default:
            changes[key] = val;
        }
      });

      if (existing) {
        updates.push({ product: existing, changes });
      } else {
        if (!changes.name) { errors.push(`Dòng ${r + 1}: thiếu tên (không update được và không tạo mới được)`); continue; }
        inserts.push({
          id: uid(),
          currency: 'VND',
          createdAt: new Date().toISOString().slice(0, 10),
          sku: '', slug: slugify(changes.name),
          images: [], tags: [],
          model: '', project: '', projectCode: '',
          brand: '', origin: '',
          priceMode: 'show', price: 0, originalPrice: 0, stock: 0,
          shortDescription: '', description: '', featured: false,
          category: STATE.data.categories[0]?.id || '',
          ...changes
        });
      }
    }

    if (errors.length && !confirm(`Có ${errors.length} lỗi:\n\n• ${errors.slice(0, 8).join('\n• ')}${errors.length > 8 ? '\n…' : ''}\n\nBỏ qua các dòng lỗi và tiếp tục?`)) {
      status.textContent = '';
      input.value = '';
      return;
    }

    if (!updates.length && !inserts.length) {
      alert('Không có dòng nào để cập nhật hoặc thêm mới.');
      status.textContent = '';
      input.value = '';
      return;
    }

    const msg = `Kết quả xử lý file "${file.name}":\n
  • ${updates.length} sản phẩm sẽ CẬP NHẬT (match theo id)
  • ${inserts.length} sản phẩm sẽ TẠO MỚI
  • ${skippedEmpty.length} dòng trống bỏ qua
  • ${errors.length} lỗi (không xử lý)

Tiếp tục lưu lên GitHub?`;
    if (!confirm(msg)) { status.textContent = ''; input.value = ''; return; }

    updates.forEach(({ product, changes }) => {
      Object.assign(product, changes);
      if (changes.name) product.slug = slugify(changes.name);
    });
    inserts.forEach(p => STATE.data.products.unshift(p));
    render();
    await saveProductsFile(`Import Excel: ${updates.length} cập nhật, ${inserts.length} mới (${file.name})`);
    input.value = '';
  } catch (e) {
    status.textContent = '';
    alert('Lỗi nhập Excel: ' + e.message);
    input.value = '';
  }
}

async function bulkConfirmImport() {
  const rows = window._bulkParsed || [];
  const valid = rows.filter(r => !r.errors.length);
  if (!valid.length) { alert('Không có dòng hợp lệ để nhập.'); return; }
  if (!confirm(`Nhập ${valid.length} sản phẩm vào shop? (sẽ commit 1 lần lên GitHub)`)) return;
  valid.forEach(r => STATE.data.products.unshift(r.product));
  closeEditor();
  render();
  await saveProductsFile(`Nhập hàng loạt ${valid.length} sản phẩm`);
}

// ---------- BULK EDIT (spreadsheet) ----------
function openBulkEdit() {
  if (STATE.selection.size === 0) { alert('Chưa chọn sản phẩm nào.'); return; }
  // Match admin list order (oldest → newest). STATE.data.products is unshift-order (newest first) → reverse.
  const products = STATE.data.products.slice().reverse().filter(p => STATE.selection.has(p.id));
  const catList = STATE.data.categories.map(c => `<span class="font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[11px]">${c.id}</span>`).join(' ');

  const box = document.getElementById('editorBox');
  if (box) { box.classList.remove('max-w-3xl'); box.classList.add('max-w-7xl'); }

  document.getElementById('editorContent').innerHTML = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-3">
        <h2 class="text-xl font-bold">✏️ Sửa hàng loạt — ${products.length} sản phẩm</h2>
        <button onclick="closeEditor()" class="text-2xl text-slate-400 hover:text-slate-700">&times;</button>
      </div>

      <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-xs flex flex-wrap gap-x-4 gap-y-1">
        <span class="font-semibold text-amber-800">💡 Cách dùng:</span>
        <span>• Mỗi dòng = 1 sản phẩm đã chọn, đã pre-fill giá trị hiện tại</span>
        <span>• Sửa thẳng vào ô; bỏ tick ☑ ở header cột để <b>không động vào cột đó</b> (giữ nguyên giá trị cũ)</span>
        <span>• Paste ảnh vào ô "Ảnh" để upload</span>
        <span>• Xóa dòng (✕) → sản phẩm đó không bị cập nhật</span>
        <span>• <kbd class="bg-white border px-1 rounded">Ctrl+Z</kbd> để hoàn tác thao tác gần nhất</span>
        <span>• Cột "🔗 Link" ở cuối bảng để copy đường dẫn trang chi tiết</span>
      </div>

      <div class="bg-slate-50 border border-slate-200 rounded-lg p-2 mb-2 text-[11px]">
        <span class="font-semibold text-slate-700">Danh mục hợp lệ:</span> ${catList || '<i>chưa có</i>'}
      </div>

      <div class="flex gap-2 mb-2 items-center flex-wrap">
        <button onclick="bulkClear()" class="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-1 rounded">🗑 Xóa nội dung tất cả ô</button>
        <button onclick="bulkCopyAllLinks('url')" class="text-xs bg-brand-100 hover:bg-brand-200 text-brand-700 px-3 py-1 rounded">📋 Copy tất cả link (chỉ URL)</button>
        <button onclick="bulkCopyAllLinks('name-url')" class="text-xs bg-brand-100 hover:bg-brand-200 text-brand-700 px-3 py-1 rounded">📋 Copy Tên + Link (TSV)</button>
        <button onclick="bulkCopyAllLinks('md')" class="text-xs bg-brand-100 hover:bg-brand-200 text-brand-700 px-3 py-1 rounded">📋 Copy Markdown</button>
        <span class="text-[11px] text-slate-500 ml-auto" id="bulkRowInfo">${products.length} sản phẩm</span>
      </div>

      <div id="bulkGridWrap" class="overflow-auto border border-slate-300 rounded-lg max-h-[70vh] bg-white">
        <table class="border-collapse text-xs w-max">
          <thead>
            <tr>
              <th class="bg-slate-200 border border-slate-300 px-1 py-1.5 w-10 text-slate-600 sticky top-0 left-0 z-30">#</th>
              ${BULK_COLUMNS.map((c, ci) => {
                const cb = c.required
                  ? `<input type="checkbox" data-col-include="${ci}" checked disabled title="Cột bắt buộc" class="w-4 h-4 opacity-60 cursor-not-allowed" />`
                  : `<input type="checkbox" data-col-include="${ci}" checked onchange="bulkToggleColInclude(${ci}, this.checked)" title="Bỏ tick để giữ nguyên cột này" class="w-4 h-4" />`;
                const thStick = ci === 0 ? 'sticky top-0 left-10 z-20' : 'sticky top-0 z-20';
                return `<th class="bg-amber-100 border border-slate-300 px-2 py-1.5 text-left text-amber-800 font-semibold whitespace-nowrap ${thStick}" style="min-width:${BULK_COL_WIDTH[c.key]}px">
                  <label class="flex items-center gap-1.5 ${c.required ? '' : 'cursor-pointer'} select-none">
                    ${cb}<span data-col-label="${ci}">${c.label}</span>
                  </label>
                </th>`;
              }).join('')}
              <th class="bg-amber-100 border border-slate-300 px-2 py-1.5 text-left text-brand-700 font-semibold whitespace-nowrap sticky top-0 z-20" style="min-width:320px">🔗 Link sản phẩm</th>
              <th class="bg-amber-100 border border-slate-300 px-1 w-8 sticky top-0 z-20"></th>
            </tr>
          </thead>
          <tbody id="bulkGridBody"></tbody>
        </table>
      </div>

      <div class="flex gap-2 mt-3">
        <button onclick="bulkConfirmEdit()" class="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 rounded">💾 Lưu thay đổi ${products.length} sản phẩm</button>
        <button onclick="closeEditor()" class="px-6 py-2 border rounded font-semibold">Hủy</button>
      </div>
    </div>
  `;
  openEditor();
  bulkResetHistory();

  // Add rows + pre-fill + tag product id + inject Link cell
  bulkAddRow(products.length);
  const trs = document.querySelectorAll('#bulkGridBody tr');
  const baseUrl = shopBaseUrl();
  products.forEach((p, i) => {
    const tr = trs[i];
    tr.dataset.productId = p.id;
    const inputs = tr.querySelectorAll('[data-col]');
    BULK_COLUMNS.forEach((col, ci) => {
      const v = p[col.key];
      let val = '';
      if (col.key === 'tags' || col.key === 'images') val = (v || []).join(',');
      else if (col.key === 'featured') val = v ? 'true' : 'false';
      else if (col.key === 'priceMode') val = v || 'show';
      else if (v === undefined || v === null) val = '';
      else val = String(v);
      inputs[ci].value = val;
    });
    // Insert Link cell just before the last <td> (delete button)
    const url = baseUrl + productUrlFor(p);
    const linkTd = document.createElement('td');
    linkTd.className = 'border border-slate-200 p-0 bg-slate-50';
    linkTd.innerHTML = `
      <div class="flex items-center gap-1 px-2 py-1">
        <input type="text" readonly value="${url.replace(/"/g, '&quot;')}" onclick="this.select()" class="flex-1 min-w-0 px-2 py-1 text-[11px] bg-white border rounded outline-none" />
        <button type="button" onclick="bulkCopyLink(this, '${url.replace(/'/g, "\\'")}')" class="text-xs bg-brand-100 hover:bg-brand-200 text-brand-700 px-2 py-1 rounded shrink-0" title="Copy link">📋</button>
        <a href="${url}" target="_blank" rel="noopener" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded shrink-0" title="Mở trang chi tiết">↗</a>
      </div>`;
    const lastTd = tr.querySelector('td:last-child');
    tr.insertBefore(linkTd, lastTd);
  });

  document.getElementById('bulkGridWrap').addEventListener('paste', bulkPasteHandler);
  document.getElementById('bulkGridWrap').addEventListener('keydown', bulkKeyNav);
}

function shopBaseUrl() {
  const isGh = location.host.endsWith('.github.io');
  return location.origin + (isGh ? '/Shop/' : '/');
}

function productUrlFor(p) {
  const slug = p.slug || slugify(p.name);
  // Ưu tiên: <projectCode>-<model> → sku → chỉ slug
  let tail = '';
  if (p.projectCode && p.model) tail = `${p.projectCode}-${p.model}`;
  else if (p.sku) tail = p.sku;
  return tail ? `${slug}/${encodeURIComponent(tail)}` : slug;
}

function bulkCopyAllLinks(format) {
  const trs = Array.from(document.querySelectorAll('#bulkGridBody tr'));
  const lines = [];
  const nameColIdx = BULK_COLUMNS.findIndex(c => c.key === 'name');
  trs.forEach(tr => {
    const id = tr.dataset.productId;
    if (!id) return;
    const p = STATE.data.products.find(x => x.id === id);
    if (!p) return;
    // Prefer current in-grid name (in case user edited it)
    const nameInput = tr.querySelectorAll('[data-col]')[nameColIdx];
    const name = (nameInput && nameInput.value.trim()) || p.name;
    const url = shopBaseUrl() + productUrlFor({ ...p, name, slug: p.slug || slugify(name) });
    switch (format) {
      case 'name-url': lines.push(name + '\t' + url); break;
      case 'md':       lines.push(`- [${name}](${url})`); break;
      default:         lines.push(url);
    }
  });
  if (!lines.length) { alert('Không có sản phẩm để copy link.'); return; }
  const text = lines.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    alert('✓ Đã copy ' + lines.length + ' link vào clipboard');
  }).catch(() => {
    // Fallback: show textarea for manual copy
    const w = window.open('', '_blank', 'width=600,height=400');
    w.document.body.innerHTML = `<textarea style="width:100%;height:100%;font-family:monospace;padding:10px" autofocus>${text.replace(/</g, '&lt;')}</textarea>`;
  });
}

function bulkCopyLink(btn, url) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    btn.classList.add('bg-emerald-200', 'text-emerald-700');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('bg-emerald-200', 'text-emerald-700'); }, 1200);
  }).catch(() => {
    prompt('Copy link:', url);
  });
}

async function bulkConfirmEdit() {
  const includedCols = new Set(bulkGetIncludedCols());
  const trs = Array.from(document.querySelectorAll('#bulkGridBody tr'));
  const updates = [];
  const errors = [];

  for (const tr of trs) {
    const id = tr.dataset.productId;
    if (!id) continue; // row removed or new
    const product = STATE.data.products.find(p => p.id === id);
    if (!product) continue;
    const inputs = tr.querySelectorAll('[data-col]');
    const changes = {};
    BULK_COLUMNS.forEach((col, ci) => {
      if (!includedCols.has(ci)) return;
      const val = inputs[ci].value.trim();
      switch (col.key) {
        case 'name':
          if (!val) errors.push(`SP "${product.name}": tên trống`);
          else changes.name = val;
          break;
        case 'sku':
          changes.sku = val;
          break;
        case 'category':
          if (val) {
            const cat = STATE.data.categories.find(c => c.id.toLowerCase() === val.toLowerCase() || c.name.toLowerCase() === val.toLowerCase());
            if (cat) changes.category = cat.id;
            else errors.push(`SP "${product.name}": danh mục "${val}" không tồn tại`);
          } else changes.category = '';
          break;
        case 'priceMode':
          changes.priceMode = val.toLowerCase() === 'contact' ? 'contact' : 'show';
          break;
        case 'price':
        case 'originalPrice':
        case 'stock':
          changes[col.key] = parseInt(val) || 0;
          break;
        case 'featured':
          changes.featured = /^(true|1|yes|y|x|✓)$/i.test(val);
          break;
        case 'tags':
        case 'images':
          changes[col.key] = val ? val.split(',').map(t => t.trim()).filter(Boolean) : [];
          break;
        default:
          changes[col.key] = val;
      }
    });
    updates.push({ product, changes });
  }

  if (!updates.length) { alert('Không có sản phẩm nào để cập nhật (đã xóa hết dòng?).'); return; }

  // Kiểm tra SKU trùng: build map sku → [product,...] sau khi apply changes
  const skuMap = new Map();
  STATE.data.products.forEach(p => {
    const u = updates.find(x => x.product.id === p.id);
    const sku = (u && u.changes.sku !== undefined) ? u.changes.sku : p.sku;
    if (sku) {
      if (!skuMap.has(sku)) skuMap.set(sku, []);
      skuMap.get(sku).push({ product: p, changes: (u && u.changes) || null });
    }
  });
  const dupSkus = Array.from(skuMap.entries()).filter(([, arr]) => arr.length > 1);

  if (errors.length) {
    alert('Có lỗi (không phải SKU trùng):\n\n• ' + errors.slice(0, 10).join('\n• ') + (errors.length > 10 ? `\n…và ${errors.length - 10} lỗi khác` : ''));
    return;
  }

  // Nếu có SKU trùng → mở modal chọn cách xử lý
  if (dupSkus.length) {
    showSkuConflictModal(dupSkus, updates);
    return;
  }

  if (!confirm(`Áp dụng thay đổi cho ${updates.length} sản phẩm? (commit 1 lần lên GitHub)`)) return;

  await bulkApplyEditAndSave(updates, '');
}

function showSkuConflictModal(dupSkus, updates) {
  const box = document.getElementById('editorBox');
  if (box) { box.classList.remove('max-w-3xl', 'max-w-7xl'); box.classList.add('max-w-4xl'); }
  document.getElementById('editorContent').innerHTML = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-3">
        <h2 class="text-xl font-bold text-amber-700">⚠️ ${dupSkus.length} SKU đang trùng</h2>
        <button onclick="closeEditor()" class="text-2xl text-slate-400 hover:text-slate-700">&times;</button>
      </div>
      <p class="text-sm text-slate-700 mb-3">SKU dùng để tạo URL trang chi tiết — mỗi SKU chỉ nên xuất hiện ở 1 sản phẩm. Chọn cách xử lý:</p>
      <div class="border rounded-lg max-h-64 overflow-auto mb-4">
        <table class="w-full text-xs">
          <thead class="bg-slate-100 sticky top-0">
            <tr><th class="px-2 py-1.5 text-left w-32">SKU trùng</th><th class="px-2 py-1.5 text-left">SP có SKU này</th></tr>
          </thead>
          <tbody>
            ${dupSkus.map(([sku, arr]) => `<tr class="border-t">
              <td class="px-2 py-1.5 font-mono font-semibold text-brand-700">${sku}</td>
              <td class="px-2 py-1.5 text-slate-700">${arr.map((x, i) => `<span class="${i === 0 ? 'text-emerald-700 font-semibold' : 'text-red-600'}">${x.product.name}${i === 0 ? ' (giữ)' : ' (trùng)'}</span>`).join(' • ')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="space-y-2">
        <button onclick="resolveSkuConflict('clearDup')" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded text-left px-4">
          🧹 <b>Xóa SKU khỏi các bản trùng</b> — Giữ nguyên tất cả SP, nhưng chỉ SP đầu tiên có SKU đó, các SP còn lại để trống SKU (sẽ dùng URL theo tên)
        </button>
        <button onclick="resolveSkuConflict('mergeDup')" class="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2.5 rounded text-left px-4">
          🔗 <b>Gộp — Xóa hẳn các SP trùng</b> — Chỉ giữ SP đầu tiên có SKU đó, các SP còn lại bị xóa khỏi shop
        </button>
        <button onclick="closeEditor()" class="w-full border-2 border-slate-300 text-slate-700 font-semibold py-2.5 rounded">Hủy — Anh tự sửa SKU</button>
      </div>
    </div>
  `;
  openEditor();
  window._skuConflict = { dupSkus, updates };
}

async function resolveSkuConflict(action) {
  const ctx = window._skuConflict;
  if (!ctx) return;
  const { dupSkus, updates } = ctx;

  if (action === 'clearDup') {
    // Clear SKU on 2nd+ duplicates
    for (const [, arr] of dupSkus) {
      for (let i = 1; i < arr.length; i++) {
        const item = arr[i];
        if (item.changes) item.changes.sku = '';
        else item.product.sku = '';
      }
    }
  } else if (action === 'mergeDup') {
    // Delete 2nd+ duplicate products
    const toDelete = new Set();
    for (const [, arr] of dupSkus) {
      for (let i = 1; i < arr.length; i++) toDelete.add(arr[i].product.id);
    }
    STATE.data.products = STATE.data.products.filter(p => !toDelete.has(p.id));
    // Also drop from updates (those products no longer exist)
    for (let i = updates.length - 1; i >= 0; i--) {
      if (toDelete.has(updates[i].product.id)) updates.splice(i, 1);
    }
  }

  closeEditor();
  await bulkApplyEditAndSave(updates, action === 'mergeDup' ? ` + gộp ${dupSkus.length} SKU trùng` : ` + dọn SKU trùng`);
  window._skuConflict = null;
}

async function bulkApplyEditAndSave(updates, suffix) {
  updates.forEach(({ product, changes }) => {
    if (!STATE.data.products.find(p => p.id === product.id)) return;
    Object.assign(product, changes);
    if (changes.name) product.slug = slugify(changes.name);
  });
  STATE.selection.clear();
  renderProducts();
  await saveProductsFile(`Bulk edit ${updates.length} SP${suffix}`);
}

// ---------- CATEGORY EDITOR ----------
function newCategory() {
  STATE.editing = { id: '', name: '', icon: '📦', description: '' };
  renderCategoryEditor(true);
}

function editCategory(id) {
  STATE.editing = JSON.parse(JSON.stringify(STATE.data.categories.find(c => c.id === id)));
  STATE.editing._origId = id;
  renderCategoryEditor(false);
}

function renderCategoryEditor(isNew) {
  const c = STATE.editing;
  document.getElementById('editorContent').innerHTML = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold">${isNew ? '+ Danh mục mới' : 'Sửa danh mục'}</h2>
        <button onclick="closeEditor()" class="text-2xl text-slate-400 hover:text-slate-700">&times;</button>
      </div>
      <div class="space-y-3">
        <div>
          <label class="text-xs font-semibold">Tên danh mục *</label>
          <input type="text" value="${c.name}" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.name=this.value; if(${isNew}){STATE.editing.id=slugify(this.value); document.getElementById('ed_catid').value=STATE.editing.id;}" />
        </div>
        <div>
          <label class="text-xs font-semibold">ID (slug) *</label>
          <input id="ed_catid" type="text" value="${c.id}" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.id=this.value" />
        </div>
        <div>
          <label class="text-xs font-semibold">Icon (emoji)</label>
          <input type="text" value="${c.icon || ''}" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.icon=this.value" />
        </div>
        <div>
          <label class="text-xs font-semibold">Mô tả</label>
          <textarea rows="2" class="w-full mt-1 px-3 py-2 border rounded" oninput="STATE.editing.description=this.value">${c.description || ''}</textarea>
        </div>
      </div>
      <div class="flex gap-2 mt-6 pt-4 border-t">
        <button onclick="saveCategory(${isNew})" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded">${isNew ? '+ Thêm' : '💾 Lưu'}</button>
        <button onclick="closeEditor()" class="px-6 py-2.5 border rounded font-semibold">Hủy</button>
      </div>
    </div>`;
  openEditor();
}

async function saveCategory(isNew) {
  const c = STATE.editing;
  if (!c.name || !c.id) { alert('Tên và ID bắt buộc.'); return; }
  if (isNew) {
    if (STATE.data.categories.some(x => x.id === c.id)) { alert('ID đã tồn tại.'); return; }
    STATE.data.categories.push(c);
  } else {
    const origId = c._origId; delete c._origId;
    const idx = STATE.data.categories.findIndex(x => x.id === origId);
    if (origId !== c.id) {
      STATE.data.products.forEach(p => { if (p.category === origId) p.category = c.id; });
    }
    STATE.data.categories[idx] = c;
  }
  closeEditor();
  render();
  await saveProductsFile((isNew ? 'Thêm DM: ' : 'Cập nhật DM: ') + c.name);
}

async function deleteCategory(id) {
  const c = STATE.data.categories.find(x => x.id === id);
  const count = STATE.data.products.filter(p => p.category === id).length;
  if (count > 0) {
    if (!confirm(`Danh mục này có ${count} sản phẩm. Vẫn xóa? (sản phẩm sẽ không thuộc danh mục nào)`)) return;
  } else if (!confirm(`Xóa danh mục "${c.name}"?`)) return;
  STATE.data.categories = STATE.data.categories.filter(x => x.id !== id);
  render();
  await saveProductsFile('Xóa DM: ' + c.name);
}

function openEditor() {
  const e = document.getElementById('editor');
  e.classList.remove('hidden'); e.classList.add('flex');
}
function closeEditor() {
  const e = document.getElementById('editor');
  e.classList.add('hidden'); e.classList.remove('flex');
  const box = document.getElementById('editorBox');
  if (box) { box.classList.remove('max-w-7xl'); box.classList.add('max-w-3xl'); }
  STATE.editing = null;
}

// ---------- INIT ----------
if (loadStoredAuth()) {
  enterAdmin();
}
