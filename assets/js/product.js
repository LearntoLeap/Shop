// Learn to Leap Shop — Product detail page
const fmtVND = (n) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

async function loadProduct() {
  const id = getParam('id');
  const main = document.getElementById('productMain');
  if (!id) {
    main.innerHTML = '<div class="text-center text-red-500 py-20">Thiếu mã sản phẩm.</div>';
    return;
  }
  try {
    const res = await fetch('data/products.json?t=' + Date.now());
    const data = await res.json();
    const p = data.products.find(x => x.id === id);
    if (!p) {
      main.innerHTML = `<div class="text-center py-20">
        <div class="text-5xl mb-3">🔍</div>
        <div class="text-slate-600 mb-4">Không tìm thấy sản phẩm.</div>
        <a href="index.html" class="text-brand-700 font-semibold hover:underline">← Về trang chủ</a>
      </div>`;
      return;
    }
    render(p, data);
  } catch (e) {
    console.error(e);
    main.innerHTML = '<div class="text-center text-red-500 py-20">Không tải được dữ liệu.</div>';
  }
}

function render(p, data) {
  const cat = data.categories.find(c => c.id === p.category);
  const img = (p.images && p.images[0]) || 'https://placehold.co/800x800/e2e8f0/64748b?text=No+Image';
  const isContact = p.priceMode === 'contact';
  const discount = !isContact && p.originalPrice && p.originalPrice > p.price
    ? Math.round((1 - p.price / p.originalPrice) * 100) : 0;

  document.title = p.name + ' — Learn to Leap Shop';

  const priceHtml = isContact
    ? `<span class="text-3xl font-extrabold text-brand-700">Liên hệ</span>`
    : `<span class="text-3xl font-extrabold text-brand-700">${fmtVND(p.price)}</span>
       ${p.originalPrice && p.originalPrice > p.price ? `<span class="text-base text-slate-400 line-through">${fmtVND(p.originalPrice)}</span>` : ''}
       ${discount > 0 ? `<span class="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded">-${discount}%</span>` : ''}`;

  document.getElementById('productMain').innerHTML = `
    <!-- Breadcrumb -->
    <nav class="text-sm text-slate-500 mb-5 flex items-center gap-2">
      <a href="index.html" class="hover:text-brand-700">Trang chủ</a>
      <span>›</span>
      ${cat ? `<a href="index.html#products" onclick="sessionStorage.setItem('ltl_filter','${cat.id}')" class="hover:text-brand-700">${cat.icon || ''} ${cat.name}</a><span>›</span>` : ''}
      <span class="text-slate-700 truncate">${p.name}</span>
    </nav>

    <div class="grid md:grid-cols-2 gap-8">
      <!-- Gallery -->
      <div>
        <div class="bg-slate-100 rounded-xl overflow-hidden border border-purple-100">
          <img id="mainImg" src="${img}" alt="${p.name}" class="w-full aspect-square object-cover" />
        </div>
        ${p.images && p.images.length > 1 ? `
          <div class="flex gap-2 mt-3 overflow-x-auto">
            ${p.images.map((i, idx) => `
              <img src="${i}" onclick="document.getElementById('mainImg').src='${i}'"
                class="w-20 h-20 object-cover rounded-lg border-2 ${idx === 0 ? 'border-brand-500' : 'border-slate-200'} cursor-pointer hover:border-brand-400" />
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- Info -->
      <div>
        ${cat ? `<div class="text-sm text-brand-600 font-semibold mb-2">${cat.icon || ''} ${cat.name}</div>` : ''}
        <h1 class="text-2xl md:text-3xl font-extrabold mb-3 text-slate-800">${p.name}</h1>
        ${p.shortDescription ? `<p class="text-slate-600 mb-4">${p.shortDescription}</p>` : ''}

        <div class="flex items-center gap-3 flex-wrap mb-5 pb-5 border-b border-slate-200">${priceHtml}</div>

        <div class="space-y-2 mb-5 text-sm">
          <div class="flex items-center gap-2">
            <span class="text-slate-500 w-24">Tình trạng:</span>
            ${p.stock > 0
              ? `<span class="text-emerald-600 font-semibold">● Còn hàng (${p.stock})</span>`
              : `<span class="text-amber-600 font-semibold">● Liên hệ để đặt</span>`}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-slate-500 w-24">Mã sản phẩm:</span>
            <span class="font-mono text-slate-700">${p.id}</span>
          </div>
        </div>

        ${(p.tags && p.tags.length) ? `
          <div class="flex flex-wrap gap-1.5 mb-5">
            ${p.tags.map(t => `<span class="text-xs bg-purple-50 text-brand-700 border border-purple-200 px-2 py-1 rounded-full">#${t}</span>`).join('')}
          </div>
        ` : ''}

        <a href="mailto:contact@learntoleap.vn?subject=${encodeURIComponent('Liên hệ đặt sản phẩm: ' + p.name)}&body=${encodeURIComponent('Tôi quan tâm đến sản phẩm: ' + p.name + '\nMã: ' + p.id)}"
          class="block text-center bg-gradient-to-r from-accent-500 to-brand-600 hover:opacity-90 text-white font-semibold py-3.5 rounded-lg shadow-lg shadow-purple-200 mb-3">
          📧 Liên hệ đặt sản phẩm
        </a>
        <a href="index.html" class="block text-center border-2 border-brand-200 text-brand-700 font-semibold py-2.5 rounded-lg hover:bg-purple-50">← Xem sản phẩm khác</a>
      </div>
    </div>

    ${p.description ? `
      <div class="mt-10 bg-white border border-purple-100 rounded-xl p-6 shadow-sm">
        <h2 class="text-xl font-bold mb-4 text-slate-800 flex items-center gap-2">📋 Mô tả chi tiết</h2>
        <div class="prose prose-sm max-w-none text-slate-700 whitespace-pre-line leading-relaxed">${p.description}</div>
      </div>
    ` : ''}

    <!-- Related -->
    ${relatedHtml(p, data)}
  `;
}

function relatedHtml(current, data) {
  const related = data.products
    .filter(p => p.id !== current.id && p.category === current.category)
    .slice(0, 4);
  if (!related.length) return '';
  return `
    <div class="mt-10">
      <h2 class="text-xl font-bold mb-4 text-slate-800">Sản phẩm cùng danh mục</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        ${related.map(p => {
          const img = (p.images && p.images[0]) || 'https://placehold.co/400x400/e2e8f0/64748b?text=No+Image';
          const priceTxt = p.priceMode === 'contact' ? 'Liên hệ' : fmtVND(p.price);
          return `
            <a href="product.html?id=${encodeURIComponent(p.id)}" class="block bg-white rounded-lg border border-slate-100 hover:shadow-md transition overflow-hidden">
              <img src="${img}" class="w-full aspect-square object-cover" loading="lazy" />
              <div class="p-3">
                <div class="text-sm font-semibold text-slate-800 line-clamp-2 min-h-[2.5rem]">${p.name}</div>
                <div class="text-sm font-bold text-brand-700 mt-1">${priceTxt}</div>
              </div>
            </a>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

loadProduct();
