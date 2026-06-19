// Learn to Leap Shop — Admin panel (GitHub API based)
const DATA_PATH = 'data/products.json';
const STATE = { auth: null, data: null, sha: null, tab: 'products', editing: null, selection: new Set(), filterCat: 'all' };

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

async function saveProductsFile(message = 'Cập nhật sản phẩm') {
  const status = document.getElementById('saveStatus');
  status.textContent = '💾 Đang lưu...';
  const content = JSON.stringify(STATE.data, null, 2);
  try {
    const res = await ghPut(DATA_PATH, toBase64(content), STATE.sha, message);
    STATE.sha = res.content.sha;
    status.textContent = '✓ Đã lưu lên GitHub';
    setTimeout(() => status.textContent = '', 3000);
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
        status.textContent = '✓ Đã lưu (sau khi giải quyết xung đột)';
        setTimeout(() => status.textContent = '', 3000);
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
  const visible = STATE.data.products.filter(p => STATE.filterCat === 'all' || p.category === STATE.filterCat);
  // Clean selection from products no longer present
  for (const id of STATE.selection) if (!STATE.data.products.find(p => p.id === id)) STATE.selection.delete(id);
  const allVisibleSelected = visible.length > 0 && visible.every(p => STATE.selection.has(p.id));
  const catOpts = STATE.data.categories.map(c => `<option value="${c.id}" ${STATE.filterCat === c.id ? 'selected' : ''}>${c.icon || ''} ${c.name} (${STATE.data.products.filter(p => p.category === c.id).length})</option>`).join('');

  const toolbar = `
    <div class="bg-white rounded-lg p-3 mb-2 flex flex-wrap items-center gap-3 shadow-sm border border-slate-100">
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" ${allVisibleSelected ? 'checked' : ''} onchange="bulkToggleAllVisible(this.checked)" class="w-4 h-4" />
        Chọn tất cả hiển thị
      </label>
      <div class="h-5 border-l border-slate-200"></div>
      <label class="text-xs text-slate-600">Lọc theo danh mục:</label>
      <select onchange="bulkSetFilter(this.value)" class="text-sm px-2 py-1 border rounded">
        <option value="all" ${STATE.filterCat === 'all' ? 'selected' : ''}>— Tất cả (${STATE.data.products.length}) —</option>
        ${catOpts}
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
        <div class="text-xs text-slate-500">${cat ? cat.icon + ' ' + cat.name : '(không phân loại)'} • ${p.priceMode === 'contact' ? 'Liên hệ' : fmtVND(p.price)} • Kho: ${p.stock}${p.sku ? ' • <span class="font-mono text-brand-700">Mã: ' + p.sku + '</span>' : ''}</div>
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

function bulkToggleOne(id, on) {
  if (on) STATE.selection.add(id); else STATE.selection.delete(id);
  renderProducts();
}

function bulkToggleAllVisible(on) {
  const visible = STATE.data.products.filter(p => STATE.filterCat === 'all' || p.category === STATE.filterCat);
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
  list.innerHTML = STATE.data.categories.map(c => {
    const count = STATE.data.products.filter(p => p.category === c.id).length;
    return `
    <div class="bg-white rounded-lg p-3 flex items-center gap-3 shadow-sm">
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

// ---------- PRODUCT EDITOR ----------
function newProduct() {
  STATE.editing = {
    id: uid(), name: '', slug: '', sku: '', category: STATE.data.categories[0]?.id || '',
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
            <label class="text-xs font-semibold">Mã sản phẩm (SKU) *</label>
            <input type="text" value="${p.sku || ''}" placeholder="VD: RT113" class="w-full mt-1 px-3 py-2 border rounded font-mono" oninput="STATE.editing.sku=this.value.trim()" />
          </div>
          <div>
            <label class="text-xs font-semibold">Danh mục *</label>
            <select class="w-full mt-1 px-3 py-2 border rounded" onchange="STATE.editing.category=this.value">${catOpts}</select>
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
          <div class="flex gap-2 mt-2">
            <input id="newImgUrl" type="text" placeholder="Dán URL ảnh..." class="flex-1 px-3 py-1.5 border rounded text-sm" />
            <button onclick="addImageUrl()" class="bg-slate-700 text-white px-3 py-1.5 rounded text-sm">+ URL</button>
            <label class="bg-blue-600 text-white px-3 py-1.5 rounded text-sm cursor-pointer hover:bg-blue-700">
              📤 Upload
              <input type="file" accept="image/*" class="hidden" onchange="uploadImage(this)" />
            </label>
          </div>
          <p class="text-[11px] text-slate-500 mt-1">Upload sẽ commit ảnh vào repo (thư mục /images). Ảnh &lt; 1MB.</p>
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
  if (file.size > 1024 * 1024) { alert('Ảnh quá lớn (>1MB).'); return; }
  const status = document.getElementById('saveStatus');
  status.textContent = '📤 Đang upload ảnh...';
  try {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `images/${Date.now()}-${slugify(file.name.replace(/\.[^.]+$/, ''))}.${ext}`;
    const res = await ghPut(path, b64, null, 'Upload ảnh: ' + file.name);
    const url = res.content.download_url;
    STATE.editing.images = STATE.editing.images || [];
    STATE.editing.images.push(url);
    status.textContent = '✓ Đã upload';
    renderProductEditor(!STATE.data.products.find(p => p.id === STATE.editing.id));
  } catch (e) {
    alert('Lỗi upload: ' + e.message);
    status.textContent = '';
  }
}

async function saveProduct(isNew) {
  const p = STATE.editing;
  if (!p.name || !p.category) { alert('Tên và danh mục bắt buộc.'); return; }
  if (!p.sku) { alert('Mã sản phẩm (SKU) bắt buộc — dùng để tạo URL trang chi tiết.'); return; }
  const dup = STATE.data.products.find(x => x.sku === p.sku && x.id !== p.id);
  if (dup) { alert('Mã sản phẩm "' + p.sku + '" đã tồn tại ở sản phẩm: ' + dup.name); return; }
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
  { key: 'sku',              label: 'Mã SP (SKU) *',            required: true },
  { key: 'category',         label: 'Danh mục (id hoặc tên)',   required: false },
  { key: 'priceMode',        label: 'Kiểu giá (show/contact)',  required: false },
  { key: 'price',            label: 'Giá bán',                  required: false },
  { key: 'originalPrice',    label: 'Giá gốc',                  required: false },
  { key: 'stock',            label: 'Tồn kho',                  required: false },
  { key: 'shortDescription', label: 'Mô tả ngắn',               required: false },
  { key: 'description',      label: 'Mô tả chi tiết',           required: false },
  { key: 'tags',             label: 'Tags (phẩy)',              required: false },
  { key: 'images',           label: 'Ảnh (URL, phẩy)',          required: false },
  { key: 'featured',         label: 'Nổi bật (true/false)',     required: false }
];

const BULK_COL_WIDTH = {
  name: 220, sku: 110, category: 140, priceMode: 110, price: 110, originalPrice: 110,
  stock: 80, shortDescription: 240, description: 280, tags: 170, images: 220, featured: 90
};

function openBulkImport() {
  const catList = STATE.data.categories.map(c => `<span class="font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded text-[11px]">${c.id}</span>`).join(' ');

  document.getElementById('editorContent').innerHTML = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-3">
        <h2 class="text-xl font-bold">📥 Nhập sản phẩm hàng loạt</h2>
        <button onclick="closeEditor()" class="text-2xl text-slate-400 hover:text-slate-700">&times;</button>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-xs flex flex-wrap gap-x-4 gap-y-1">
        <span class="font-semibold text-blue-800">💡 Cách dùng:</span>
        <span>• Nhập trực tiếp vào ô như Google Sheet</span>
        <span>• HOẶC copy từ Excel/Sheets → click ô đầu tiên → Ctrl+V (tự động trải nhiều dòng/cột)</span>
        <span>• Tab/Enter để di chuyển giữa các ô</span>
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

      <div id="bulkGridWrap" class="overflow-auto border border-slate-300 rounded-lg max-h-[55vh] bg-white">
        <table class="border-collapse text-xs w-max">
          <thead class="bg-purple-100 sticky top-0 z-10">
            <tr>
              <th class="bg-slate-200 border border-slate-300 px-1 py-1.5 w-10 text-slate-600 sticky left-0 z-20">#</th>
              ${BULK_COLUMNS.map(c => `<th class="border border-slate-300 px-2 py-1.5 text-left text-brand-700 font-semibold whitespace-nowrap" style="min-width:${BULK_COL_WIDTH[c.key]}px">${c.label}</th>`).join('')}
              <th class="border border-slate-300 px-1 w-8"></th>
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
  bulkAddRow(10);
  document.getElementById('bulkGridWrap').addEventListener('paste', bulkPasteHandler);
  document.getElementById('bulkGridWrap').addEventListener('keydown', bulkKeyNav);
}

function bulkRowHtml(idx) {
  return `<tr data-row="${idx}">
    <td class="bg-slate-50 border border-slate-300 px-1 text-center text-slate-500 text-[11px] sticky left-0">${idx + 1}</td>
    ${BULK_COLUMNS.map((c, ci) => `<td class="border border-slate-200 p-0"><input type="text" data-col="${ci}" data-key="${c.key}" class="w-full px-2 py-1.5 outline-none focus:bg-yellow-50 focus:ring-2 focus:ring-inset focus:ring-brand-400" /></td>`).join('')}
    <td class="border border-slate-200 text-center"><button onclick="bulkRemoveRow(this)" class="text-red-400 hover:text-red-600 px-1" title="Xóa dòng">✕</button></td>
  </tr>`;
}

function bulkAddRow(n = 1) {
  const body = document.getElementById('bulkGridBody');
  for (let i = 0; i < n; i++) {
    const idx = body.children.length;
    body.insertAdjacentHTML('beforeend', bulkRowHtml(idx));
  }
  bulkUpdateRowInfo();
}

function bulkRemoveRow(btn) {
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
    Array.from(tr.querySelectorAll('input[data-col]')).some(i => i.value.trim())
  ).length;
  const el = document.getElementById('bulkRowInfo');
  if (el) el.textContent = `${filled}/${total} dòng có dữ liệu`;
}

function bulkClear() {
  document.querySelectorAll('#bulkGridBody input').forEach(i => i.value = '');
  document.getElementById('bulkPreview').innerHTML = '';
  bulkUpdateRowInfo();
}

function bulkFillSample() {
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
    const inputs = tr.querySelectorAll('input[data-col]');
    row.forEach((val, c) => {
      const target = inputs[startCol + c];
      if (target) target.value = (val || '').toString();
    });
  });
  bulkUpdateRowInfo();
}

function bulkPasteHandler(e) {
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  // Single value (no tabs, no multi-line) → let browser default paste
  if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
  e.preventDefault();
  let startRow = 0, startCol = 0;
  const active = document.activeElement;
  if (active && active.tagName === 'INPUT' && active.dataset.col) {
    const tr = active.closest('tr');
    startRow = +tr.dataset.row;
    startCol = +active.dataset.col;
  }
  const matrix = text.replace(/\r/g, '').split('\n')
    .filter(l => l.length > 0)
    .map(l => l.split('\t').map(c => c.trim()));
  bulkFillGrid(matrix, startRow, startCol);
}

function bulkKeyNav(e) {
  const t = e.target;
  if (t.tagName !== 'INPUT' || !t.dataset.col) return;
  const tr = t.closest('tr');
  const row = +tr.dataset.row;
  const col = +t.dataset.col;
  const body = document.getElementById('bulkGridBody');
  let next = null;
  if (e.key === 'Enter') {
    e.preventDefault();
    const nextTr = body.children[row + 1];
    if (nextTr) next = nextTr.querySelectorAll('input[data-col]')[col];
    else { bulkAddRow(1); next = body.children[row + 1].querySelectorAll('input[data-col]')[col]; }
  } else if (e.key === 'ArrowDown' && !e.shiftKey) {
    const nextTr = body.children[row + 1];
    if (nextTr) { e.preventDefault(); next = nextTr.querySelectorAll('input[data-col]')[col]; }
  } else if (e.key === 'ArrowUp' && !e.shiftKey) {
    const prevTr = body.children[row - 1];
    if (prevTr) { e.preventDefault(); next = prevTr.querySelectorAll('input[data-col]')[col]; }
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
    if (!row.sku) rowErrs.push('thiếu SKU');
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
        sku: row.sku,
        slug: slugify(row.name),
        category: catId,
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
  const lines = [];
  document.querySelectorAll('#bulkGridBody tr').forEach(tr => {
    const vals = Array.from(tr.querySelectorAll('input[data-col]')).map(i => i.value);
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
  STATE.editing = null;
}

// ---------- INIT ----------
if (loadStoredAuth()) {
  enterAdmin();
}
