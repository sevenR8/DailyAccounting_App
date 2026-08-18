# 每日帳本

每日帳本是可加入手機主畫面的個人記帳 PWA。第一個版本提供 Google 登入、個人帳本、預設分類與資料列權限基礎。

## 啟動方式

1. 在 Supabase SQL Editor 執行 `supabase-0001-personal-ledger.sql`。
2. 在 Supabase Auth 啟用 Google Provider，並把網站網址加入允許的 redirect URL。
3. 在 `config.js` 填入 Supabase Project URL 與 **公開匿名金鑰**。服務角色金鑰絕不可放入這個檔案。
4. 使用任何靜態網站伺服器開啟專案根目錄；部署時可直接交給 Vercel。

## 驗證

使用工作區提供的 Node.js 執行：

```text
node --test ledger-module.test.js
```

這個測試透過帳本模組的公開介面驗證首次登入佈建與重複登入的行為。

