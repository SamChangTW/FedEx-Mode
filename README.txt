FedEx Mode v1.7M-F-W — Web OCR Invoice (PWA)
=================================================
用途：在瀏覽器內完成 拍照/上傳 → OCR → 生成 FedEx 商業發票 PDF（公版、無 Logo/簽名）。

快速使用（本機開啟）
1) 將整個資料夾上傳到 GitHub Pages 或使用任何靜態伺服器（例如 Netlify、Vercel）。
2) 首次開啟允許 Service Worker 安裝後，頁面可離線使用（PWA）。
3) [匯入影像] → [開始 OCR] → [確認/修正欄位] → [生成 PDF or 下載 JSON]

部署到 GitHub Pages
- 建立 repo 後，將這個資料夾內容放到根目錄（或 /docs），開啟 Pages。
- 建議分支：main，資料夾：/ (root) 或 /docs，Build: 靜態頁面。
- 網址開啟後，會自動快取資源（第二次起可離線）。

欄位規格（公版）
- FedEx AWB No. / Date / Seller / Seller Address / Buyer / Buyer Address / Incoterms / Currency
- Items（每行一筆：描述 | HSCode(選填) | Qty | UOM | Unit Price）
- Totals：Sub-Total + Freight + Insurance + Grand Total（自動計）
- Notes：可留空

技術
- OCR：Tesseract.js（純前端）
- PDF：pdf-lib
- PWA：Service Worker 快取 App Shell

注意
- 由於是前端 OCR，清晰度會影響辨識效果；可人工修正欄位後再輸出。
- 生成的 PDF 與 JSON 由瀏覽器直接下載，不會上傳到伺服器。
