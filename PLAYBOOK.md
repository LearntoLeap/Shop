# 📘 STATIC-CRUD PLAYBOOK
### Mẫu kiến trúc: Web tĩnh public + Admin CRUD qua GitHub API, deploy bằng GitHub Pages

> **Mục đích**: Cho phép một người không-lập-trình tự thêm/sửa/xóa dữ liệu (sản phẩm, bài viết, hồ sơ, sự kiện...) trên một website công khai, **không cần server, không cần database, không tốn phí**.
>
> Paste file này vào một session Claude mới + nói rõ "domain" mới (vd: "Tôi muốn dựng web hồ sơ học viên thay vì shop") là Claude có đủ knowhow để build lại.

---

## 1. KIẾN TRÚC TỔNG QUAN

```
┌────────────────────────────────────────────────────────────────┐
│  GITHUB REPO (Public)                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  data/items.json       ← Database (JSON tĩnh)            │  │
│  │  images/               ← Ảnh upload qua admin            │  │
│  │  index.html            ← Storefront (ai cũng xem được)   │  │
│  │  admin.html            ← Trang admin (cần PAT mới vào)   │  │
│  │  assets/js/app.js      ← Render dữ liệu từ JSON          │  │
│  │  assets/js/admin.js    ← CRUD qua GitHub API             │  │
│  │  .github/workflows/    ← Auto-deploy GitHub Pages        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────┬──────────────────────────────────────────┘
                      │ Mỗi commit
                      ▼
       ┌─────────────────────────────┐
       │  GitHub Pages CDN           │
       │  https://<org>.github.io/<repo>/  │
       └─────────────────────────────┘

  Người xem (public)  ─────►  fetch data/items.json  ─────► render UI
  Admin               ─────►  GitHub Contents API (PAT)  ─► commit
                                                        ─► trigger Pages
                                                        ─► site update sau ~1 phút
```

### Tại sao chọn kiến trúc này

| Vấn đề | Giải pháp truyền thống | Giải pháp này |
|--------|------------------------|---------------|
| Database | MySQL, MongoDB | File JSON trong repo |
| Backend | Node/Python server | Không có |
| Auth admin | JWT, session, OAuth | GitHub PAT (token cá nhân) |
| Upload ảnh | S3, Cloudinary | Commit base64 vào repo |
| Hosting | VPS, Heroku | GitHub Pages (miễn phí) |
| Versioning | Snapshot DB | Git history mặc định |
| Rollback | Restore backup | `git revert` |
| Chi phí | $5–50/tháng | **0đ** |

### Điều kiện áp dụng

- ✅ Dữ liệu **< 5MB JSON** (vài trăm đến vài nghìn record)
- ✅ Lượng truy cập **< 100GB bandwidth/tháng** (GitHub Pages free tier)
- ✅ Số admin **ít** (< 5 người, mỗi người 1 PAT)
- ✅ Không cần real-time sync, không cần search server-side phức tạp
- ❌ KHÔNG hợp cho: e-commerce thật (giỏ hàng, thanh toán), social network, dữ liệu nhạy cảm cần bảo mật cao

---

## 2. FILE STRUCTURE CHUẨN

```
project-root/
├── index.html              # Trang public chính
├── admin.html              # Trang admin (PAT login)
├── assets/
│   ├── js/
│   │   ├── app.js          # Logic render public
│   │   └── admin.js        # Logic CRUD admin
│   └── css/                # (optional, dùng Tailwind CDN)
├── data/
│   └── items.json          # File dữ liệu chính
├── images/                 # Upload ảnh
├── .github/
│   └── workflows/
│       └── pages.yml       # Auto-deploy
├── .gitignore
└── README.md
```

**Schema `items.json` chuẩn:**
```json
{
  "categories": [
    { "id": "cat-slug", "name": "Tên hiển thị", "icon": "🤖", "description": "..." }
  ],
  "items": [
    {
      "id": "x001",
      "name": "Tên item",
      "slug": "ten-item",
      "category": "cat-slug",
      "fields": { /* tự định nghĩa theo domain */ },
      "images": ["url1", "url2"],
      "tags": ["tag1", "tag2"],
      "featured": false,
      "createdAt": "2026-05-19"
    }
  ]
}
```

---

## 3. NHỮNG CODE PATTERN CỐT LÕI (PHẢI GIỮ NGUYÊN)

### 3.1. Đăng nhập admin bằng GitHub PAT

```javascript
const STATE = { auth: null, data: null, sha: null };

async function login() {
  const auth = {
    owner: document.getElementById('ghOwner').value.trim(),
    repo: document.getElementById('ghRepo').value.trim(),
    branch: document.getElementById('ghBranch').value.trim() || 'main',
    token: document.getElementById('ghToken').value.trim()
  };

  // Verify token bằng cách gọi repo endpoint
  const r = await fetch(`https://api.github.com/repos/${auth.owner}/${auth.repo}`, {
    headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/vnd.github+json' }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  STATE.auth = auth;
  // Lưu token: sessionStorage (mặc định) hoặc localStorage (nếu user tick "remember")
  const storage = remember ? localStorage : sessionStorage;
  storage.setItem('admin_auth', JSON.stringify(auth));
}
```

### 3.2. GET file từ GitHub

```javascript
async function ghGet(path) {
  const { owner, repo, branch, token } = STATE.auth;
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );
  if (r.status === 404) return null;        // File chưa tồn tại
  if (!r.ok) throw new Error('GET fail ' + r.status);
  return r.json();                          // Có .content (base64) và .sha
}
```

### 3.3. PUT (create/update) file qua GitHub

```javascript
async function ghPut(path, contentBase64, sha, message) {
  const { owner, repo, branch, token } = STATE.auth;
  const body = { message, content: contentBase64, branch };
  if (sha) body.sha = sha;                  // Có SHA = update, không SHA = create mới
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('PUT fail ' + r.status + ' ' + await r.text());
  return r.json();
}
```

### 3.4. ⚠️ Base64 cho UTF-8 (tiếng Việt)

```javascript
// JSON tiếng Việt phải dùng cách này, không dùng btoa(str) thẳng
const toBase64   = (str) => btoa(unescape(encodeURIComponent(str)));
const fromBase64 = (b64) => decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
```

### 3.5. ⚠️ Xử lý 409 Conflict (rất quan trọng — sẽ gặp khi nhiều admin hoặc edit nhanh)

Khi PUT thất bại với 409, SHA local đã cũ. Phải refresh SHA rồi quyết định:
- Nếu remote giống local → retry ngay
- Nếu remote khác local → hỏi user: ghi đè hay load bản remote

```javascript
async function saveDataFile(message) {
  const content = JSON.stringify(STATE.data, null, 2);
  try {
    const res = await ghPut(DATA_PATH, toBase64(content), STATE.sha, message);
    STATE.sha = res.content.sha;
  } catch (e) {
    if (/\b409\b/.test(e.message)) {
      const file = await ghGet(DATA_PATH);
      const remote = JSON.parse(fromBase64(file.content));
      STATE.sha = file.sha;
      const remoteStr = JSON.stringify(remote);
      if (remoteStr !== content) {
        if (!confirm('File trên GitHub đã thay đổi. Ghi đè?')) {
          STATE.data = remote;
          render();
          return;
        }
      }
      const res = await ghPut(DATA_PATH, toBase64(content), STATE.sha, message + ' (force)');
      STATE.sha = res.content.sha;
    } else throw e;
  }
}
```

### 3.6. Upload ảnh (binary) qua GitHub

```javascript
async function uploadImage(file) {
  if (file.size > 1024 * 1024) throw new Error('Ảnh >1MB');  // GitHub Contents API limit
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);   // Bỏ "data:image/...;base64,"
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const path = `images/${Date.now()}-${slugify(file.name)}`;
  const res = await ghPut(path, b64, null, 'Upload: ' + file.name);
  return res.content.download_url;                   // URL trả về để gắn vào item
}
```

### 3.7. Load dữ liệu cho trang public

```javascript
async function loadData() {
  const res = await fetch('data/items.json?t=' + Date.now());  // ?t= để bust cache
  return await res.json();
}
```

### 3.8. Slugify tiếng Việt

```javascript
const slugify = (s) => s.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // Bỏ dấu
  .replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
```

---

## 4. GITHUB ACTIONS — AUTO DEPLOY

File `.github/workflows/pages.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: "pages"
  cancel-in-progress: false
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - id: deployment
        uses: actions/deploy-pages@v4
```

⚠️ **Bắt buộc**: Vào repo Settings → Pages → Source: **GitHub Actions** (không phải "Deploy from a branch"). Quên bước này thì workflow fail ở step "Setup Pages".

---

## 5. BẢO MẬT — 2 CẤP

### Cấp 1 (mặc định)
- Admin URL public nhưng cần PAT mới vào được.
- Tạo PAT fine-grained: github.com/settings/personal-access-tokens/new
  - Resource owner: organization/user
  - Repo access: chỉ repo này
  - Permissions: `Contents: Read & Write`, `Metadata: Read`
- Token lưu trong sessionStorage (xóa khi đóng tab) hoặc localStorage (giữ lâu, có checkbox cho user chọn).

### Cấp 2 (review-before-publish)
- Admin commit vào branch `staging` thay vì `main`.
- Người duyệt merge `staging → main` thủ công.
- Workflow Pages chỉ chạy trên `main` → người ngoài không thấy nháp.

---

## 6. UI STACK KHUYẾN NGHỊ

- **Tailwind CSS qua CDN** (`<script src="https://cdn.tailwindcss.com">`) — không cần build pipeline.
- **Font Việt**: Be Vietnam Pro từ Google Fonts.
- **Tone màu**: cấu hình trong `tailwind.config` ngay trong `index.html`, dễ đổi theo brand.
- **Vanilla JS** thay vì framework — load nhanh, không build, dễ sửa.

Template tối thiểu của `index.html`:
```html
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>...</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    theme: { extend: { colors: { brand: { 500: '#a855f7', 600: '#9333ea', 700: '#7e22ce' } } } }
  }
</script>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{font-family:'Be Vietnam Pro',system-ui,sans-serif}</style>
</head>
<body class="bg-white text-slate-800">
  <!-- ... -->
  <script src="assets/js/app.js"></script>
</body>
</html>
```

---

## 7. CHECKLIST DỰNG MỘT INSTANCE MỚI

- [ ] Định nghĩa schema `items.json` theo domain (vd: học sinh, sự kiện, bài viết...).
- [ ] Copy 6 file core: `index.html`, `admin.html`, `app.js`, `admin.js`, `pages.yml`, `items.json` mẫu.
- [ ] Đổi `DATA_PATH` trong admin.js (nếu đổi tên file JSON).
- [ ] Đổi tên field hiển thị, tone màu, logo.
- [ ] Tạo repo Public trên GitHub.
- [ ] Push code: `git init && git remote add origin ... && git push`.
- [ ] Settings → Pages → Source: **GitHub Actions**.
- [ ] Tạo PAT fine-grained scope `Contents: write`.
- [ ] Truy cập `admin.html`, đăng nhập, test thêm/sửa/xóa.
- [ ] Test ảnh upload < 1MB.

---

## 8. NHỮNG BIẾN THỂ DOMAIN ĐÃ NGHĨ ĐẾN

| Domain | Schema đề xuất |
|--------|----------------|
| **Hồ sơ học sinh** | `{id, name, class, dob, parent, photo, achievements[], notes}` |
| **Sự kiện trường** | `{id, title, date, location, poster, agenda, registerLink}` |
| **Bài viết/blog** | `{id, title, slug, author, content, cover, tags, publishedAt}` |
| **Danh bạ đối tác** | `{id, orgName, logo, contactPerson, phone, email, address, tier}` |
| **Catalog khóa học** | `{id, name, level, duration, price, instructor, syllabus, image}` |
| **Lịch tuyển sinh** | `{id, schoolName, type, deadline, requirements, link}` |
| **Thư viện đề thi** | `{id, subject, grade, type, year, fileUrl, tags}` |
| **Tin tuyển dụng** | `{id, position, location, salary, jd, deadline}` |

Tất cả chỉ cần đổi schema + label, giữ nguyên kiến trúc CRUD/Pages/PAT.

---

## 9. NHỮNG LỖI ĐÃ GẶP & FIX

| Lỗi | Nguyên nhân | Fix |
|-----|-------------|-----|
| Workflow fail step "Setup Pages" | Pages chưa bật trong Settings | Settings → Pages → Source: GitHub Actions |
| `PUT failed 409` | SHA local cũ hơn remote | Refresh SHA + hỏi user ghi đè (xem 3.5) |
| `btoa` lỗi với tiếng Việt | Btoa chỉ nhận Latin-1 | Dùng `unescape(encodeURIComponent(str))` (xem 3.4) |
| Ảnh upload > 1MB fail | Contents API giới hạn | Cảnh báo trước khi upload + khuyến nghị dùng Cloudinary |
| Site không update sau commit | Cache trình duyệt hoặc CDN | Thêm `?t=` + `Date.now()` khi fetch JSON; F5 cứng (Ctrl+Shift+R) |
| Push bị reject | Local sau remote | `git pull --rebase` rồi push lại |
| Admin tab khác đang sửa → conflict | 2 admin cùng lúc | Code đã xử lý 409 confirm; nếu muốn nghiêm túc → đổi sang branch `staging` |

---

## 10. CÁCH DÙNG FILE NÀY

Mở session Claude mới, paste hoặc upload file này, sau đó nói:

> "Đây là playbook static-CRUD tôi đã chạy thành công. Tôi muốn dựng một instance mới cho [DOMAIN] với schema [FIELDS]. Dùng đúng kiến trúc này, đổi schema theo domain mới."

Claude sẽ có đủ context để dựng nhanh trong 1 session, không phải debug lại các vấn đề đã giải quyết (409, base64 UTF-8, Pages setup).

---

**Bản gốc**: Learn to Leap Shop — github.com/LearntoLeap/Shop
**Version**: 1.0 — 2026-05-19
