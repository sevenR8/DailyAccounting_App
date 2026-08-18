# 採用 Web-first 的部署與 iOS 路徑

第一版以 Vercel 託管可安裝的 PWA 前端，Supabase 負責 Google 登入、帳本資料與排程；日後若需 App Store 發行，使用 Capacitor 封裝同一套網頁產品為 iOS App。這能先以最低摩擦交付手機使用體驗，同時保留原生 App 的演進路徑。

