# Learn to Leap Shop

Website shop công khai trưng bày sản phẩm/giải pháp STEM, Robotics, AI của Learn to Leap, kèm trang quản trị riêng để chỉnh sửa danh mục/sản phẩm/giá/ảnh — toàn bộ deploy trên **GitHub Pages**, không cần server.

## Kiến trúc

```
learn-to-leap-shop/
├── index.html              # Storefront công khai (ai cũng xem được)
├── admin.html              # Trang quản trị (yêu cầu GitHub PAT để vào)
├── assets/
│   ├── js/app.js           # Logic storefront
│   └── js/admin.js         # Logic admin (CRUD qua GitHub API)
├── data/products.json      # Toàn bộ dữ liệu sản phẩm + danh mục
├── images/                 # Ảnh sản phẩm upload qua admin
└── .github/workflows/
    └── pages.yml           # Auto-deploy lên GitHub Pages
```

**Cơ chế bảo mật admin:**
- Trang `admin.html` công khai về URL nhưng vô dụng nếu không có **GitHub Personal Access Token (PAT)** với quyền `repo` của owner.
- Token chỉ lưu trong `sessionStorage`/`localStorage` của trình duyệt admin, không được gửi đi đâu khác ngoài API GitHub.
- Mọi chỉnh sửa = commit thật vào branch `main` → GitHub Actions tự deploy lại Pages trong ~1 phút.

## Hướng dẫn deploy lần đầu

### 1. Push code lên repo

Repo: **https://github.com/LearntoLeap/Shop**

```bash
cd C:\Users\HP\learn-to-leap-shop
git init
git add .
git commit -m "Initial commit — Learn to Leap Shop"
git branch -M main
git remote add origin https://github.com/LearntoLeap/Shop.git
git push -u origin main
```

### 2. Bật GitHub Pages

Vào repo trên GitHub → **Settings** → **Pages** → mục **Build and deployment** → chọn **Source: GitHub Actions**.

Push lần đầu sẽ tự kích hoạt workflow `pages.yml`. Sau ~1 phút, site có tại:
```
https://learntoleap.github.io/Shop/
```

### 3. Tạo Personal Access Token (PAT) cho admin

1. Vào https://github.com/settings/tokens?type=beta
2. **Generate new token (fine-grained)**
3. Chọn:
   - Resource owner: **LearntoLeap** (nếu là org) hoặc tài khoản cá nhân có quyền
   - Repository access: **Only select repositories** → chọn `Shop`
   - Permissions:
     - **Contents**: Read and write
     - **Metadata**: Read-only (mặc định)
4. Tạo token, copy lưu lại (chỉ hiển thị 1 lần).

### 4. Đăng nhập trang admin

Truy cập `https://learntoleap.github.io/Shop/admin.html`, nhập:
- Owner: `LearntoLeap`
- Repo: `Shop`
- Branch: `main`
- Token: dán PAT ở bước 3

Từ đây có thể:
- ✏️ Thêm/sửa/xóa sản phẩm (tên, giá, mô tả, tags, kho)
- 🖼 Upload ảnh trực tiếp (commit vào `/images`) hoặc dán URL ảnh ngoài
- 📁 Quản lý danh mục
- ⭐ Đánh dấu sản phẩm nổi bật

Mọi thay đổi → commit thật vào repo → Pages tự deploy lại trong ~1 phút.

## Bảo mật: Cấp 2 — Tách branch (tùy chọn nâng cao)

Nếu muốn admin chỉ chỉnh được file ở branch riêng (vd: `staging`), sau đó merge sang `main`:

1. Tạo branch `staging`: `git checkout -b staging && git push -u origin staging`
2. Khi đăng nhập admin, nhập Branch = `staging`
3. Khi review xong, vào GitHub tạo PR `staging → main`

Cách này giúp:
- Người ngoài không bao giờ thấy bản nháp.
- Anh có thể review trước khi đẩy bản công khai.

## Tùy biến

- **Đổi màu thương hiệu**: sửa `tailwind.config` trong `index.html` (key `colors.brand`).
- **Đổi logo / tên công ty**: tìm "Learn to Leap" trong `index.html` và `admin.html`.
- **Thêm trang phụ** (about, liên hệ chi tiết): tạo file `.html` mới ở root.
- **Custom domain**: Settings → Pages → Custom domain, thêm file `CNAME`.

## Lưu ý kỹ thuật

- Repo phải **Public** mới dùng được GitHub Pages free. Nếu cần Private → cần GitHub Pro hoặc deploy lên Netlify/Vercel.
- Ảnh upload qua admin bị giới hạn 1MB/file (GitHub Contents API có giới hạn). Ảnh lớn nên dùng Cloudinary và dán URL.
- API GitHub có rate limit 5000 req/giờ với PAT — quá đủ cho admin.

---

© 2026 Learn to Leap.
