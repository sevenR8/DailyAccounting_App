# 個人帳本基礎驗收

這份流程驗證已部署的 Supabase 專案，而不是只驗證本機的記憶體測試。請使用兩個不同的 Google 帳號（帳號 A、帳號 B），並在無痕視窗或不同瀏覽器設定檔中分別登入。

## 前置條件

1. 在 Supabase SQL Editor 執行 `supabase-0001-personal-ledger.sql`。
2. 在 Supabase Auth 開啟 Google 登入，並把網站網址加入 redirect URL。
3. 在部署網站的 `config.js` 填好 Project URL 和公開匿名金鑰。

## 帳本建立與重複登入

1. 以帳號 A 登入網站。預期會看到一個個人帳本、擁有者身分，以及飲食、娛樂、醫療、交通、生活、訂閱六個分類。
2. 登出後以帳號 A 再登入。預期仍是同一個帳本，六個分類沒有重複。
3. 在兩個帳號 A 視窗同時完成第一次登入。預期兩邊都能進入同一個帳本，不會出現建立失敗訊息或第二個帳本。
4. 以帳號 B 登入。預期看到 B 自己的帳本與六個分類，不能看到 A 的帳本名稱或分類。

## 帳本隔離與寫入權限

這段使用瀏覽器開發者工具或 API 用戶端執行；所有請求都使用公開匿名金鑰和對應帳號登入後的 access token。

1. 使用帳號 B 的 token 對 `/rest/v1/ledgers?id=eq.<帳號A的帳本ID>` 發出 `GET`。預期回傳空陣列。
2. 使用帳號 B 的 token 對 `/rest/v1/expense_entries` 發出 `POST`，內容中的 `ledger_id` 與 `category_id` 指向帳號 A 的資料，並填入 B 的 `recorder_member_id`。預期被資料列權限拒絕。
3. 使用帳號 A 的 token 以 A 自己的帳本、分類與 `recorder_member_id` 新增一筆開銷。預期新增成功；`payer_member_id` 可省略。
4. 未來新增家庭帳本成員後，使用非擁有者 token 修改另一位成員建立的開銷。預期被拒絕；帳本擁有者可修改。

完成後可在 Supabase Table Editor 確認每筆 `expense_entries` 的 `recorder_member_id` 都是建立該筆資料的帳本成員，而 `payer_member_id` 為空或同帳本成員。

