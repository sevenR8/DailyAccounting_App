# 每日帳本

每日帳本是可加入手機主畫面的個人記帳 PWA。第一個版本提供 Email 登入連結與 Google 登入、個人帳本、預設分類與資料列權限基礎。

## 啟動方式

1. 在 Supabase SQL Editor 依序執行 `supabase-0001-personal-ledger.sql`、`supabase-0002-financial-overview.sql`、`supabase-0003-fixed-expense-scheduling.sql`、`supabase-0004-expense-analysis.sql`、`supabase-0005-expense-advances.sql`。第二份升級會加入本期收入、上期信用卡帳單、其他收入、固定開銷規則與週期設定；第三份升級會加入固定開銷拖曳排序與每年指定月份排程；第四份升級會加入支出性質、店家分析群組與別名；第五份升級會加入待收代墊與分次收回紀錄。升級不會刪除既有開銷，原有固定開銷會維持每月排程。
2. 在 Supabase Auth 的 `Sign In / Providers` 確認 Email 已啟用。使用者輸入 Email 後會收到一次性的登入連結。
3. Google 登入需要另行啟用 Google Provider；若尚未完成 Google Cloud OAuth 設定，Email 登入連結仍可正常使用。
4. 在 `config.js` 填入 Supabase Project URL 與 **公開匿名金鑰**。服務角色金鑰絕不可放入這個檔案。
5. 使用任何靜態網站伺服器開啟專案根目錄；部署時可直接交給 Vercel。

## 驗證

使用工作區提供的 Node.js 執行：

```text
node --test *.test.js
```

這組測試驗證首次登入佈建、重複登入、分析計算、資料庫連線契約，以及資料模型的權限契約。每次部署 Supabase 後，另依照 [個人帳本基礎驗收](docs/acceptance/foundation.md) 驗證 Google 登入與真實資料列權限。
