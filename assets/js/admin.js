// Learn to Leap Shop — Admin panel (GitHub API based)
const DATA_PATH = 'data/products.json';
const STATE = { auth: null, data: null, sha: null, tab: 'products', editing: null };

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
    return;
  }
  list.innerHTML = STATE.data.products.map(p => {
    const cat = STATE.data.categories.find(c => c.id === p.category);
    const img = (p.images && p.images[0]) || 'https://placehold.co/100x100/e2e8f0/64748b?text=?';
    return `
    <div class="bg-white rounded-lg p-3 flex items-center gap-3 shadow-sm">
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

function openBulkImport() {
  const headerRow = BULK_COLUMNS.map(c => c.key).join('\t');
  const sample = ['Robot ABC123', 'RBT-001', 'robotics', 'show', '1500000', '2000000', '10', 'Robot lập trình cho HS THCS', 'Mô tả chi tiết...', 'robot,stem,thcs', '', 'true'].join('\t');
  const catList = STATE.data.categories.map(c => `<span class="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">${c.id}</span>`).join(' ');

  document.getElementById('editorContent').innerHTML = `
    <div class="p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold">📥 Nhập sản phẩm hàng loạt</h2>
        <button onclick="closeEditor()" class="text-2xl text-slate-400 hover:text-slate-700">&times;</button>
      </div>

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm">
        <p class="font-semibold text-blue-800 mb-1">📋 Hướng dẫn:</p>
        <ol class="list-decimal list-inside text-blue-900 space-y-0.5 text-xs">
          <li>Mở Excel/Google Sheets, tạo các cột theo thứ tự bên dưới.</li>
          <li>Bôi đen vùng dữ liệu (KHÔNG bao gồm dòng tiêu đề), Ctrl+C.</li>
          <li>Ctrl+V vào ô bên dưới. Hệ thống nhận tab (Excel) hoặc dấu phẩy (CSV).</li>
          <li>Bấm "Xem trước" để kiểm tra, rồi "Nhập" để lưu lên GitHub.</li>
        </ol>
      </div>

      <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3">
        <div class="text-xs font-semibold text-slate-700 mb-2">Thứ tự cột (12 cột):</div>
        <div class="grid grid-cols-3 md:grid-cols-4 gap-1 text-[11px]">
          ${BULK_COLUMNS.map((c, i) => `<div class="bg-white border border-slate-200 rounded px-2 py-1"><span class="text-slate-400">${i+1}.</span> ${c.label}</div>`).join('')}
        </div>
        <div class="text-[11px] text-slate-600 mt-2"><span class="font-semibold">Danh mục hợp lệ:</span> ${catList || '<i>chưa có</i>'}</div>
      </div>

      <div class="flex gap-2 mb-2">
        <button onclick="bulkFillSample()" class="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-1 rounded">📝 Điền 1 dòng mẫu</button>
        <button onclick="bulkClear()" class="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-1 rounded">🗑 Xóa</button>
      </div>

      <textarea id="bulkInput" rows="10" class="w-full px-3 py-2 border rounded font-mono text-xs" placeholder="Dán dữ liệu ở đây (mỗi dòng 1 sản phẩm, cột phân cách bằng Tab hoặc phẩy)..."></textarea>

      <div class="flex gap-2 mt-3">
        <button onclick="bulkPreview()" class="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 rounded">👁 Xem trước</button>
        <button onclick="closeEditor()" class="px-6 py-2 border rounded font-semibold">Hủy</button>
      </div>

      <div id="bulkPreview" class="mt-4"></div>
    </div>
  `;
  openEditor();
  // Sample stored for bulkFillSample
  window._bulkSample = sample;
}

function bulkFillSample() {
  document.getElementById('bulkInput').value = window._bulkSample || '';
}
function bulkClear() {
  document.getElementById('bulkInput').value = '';
  document.getElementById('bulkPreview').innerHTML = '';
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
  const text = document.getElementById('bulkInput').value;
  if (!text.trim()) { alert('Chưa có dữ liệu để xem trước.'); return; }
  const rows = parseBulkData(text);
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
