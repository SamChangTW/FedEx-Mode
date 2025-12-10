# 商業發票助手 (Commercial Invoice Helper) v2.0

> **v2.0 重大更新：** 移除舊版不穩定的網頁 OCR 模組，改用「系統原生文字辨識 + 智能 NER 解析」流程，準確度與速度大幅提升。

這是一個輕量級的 **Progressive Web App (PWA)**，專為快速生成 **FedEx 風格商業發票 (Commercial Invoice)** 而設計。它完全在瀏覽器端運行（離線可用），協助用戶將文字資料轉換為標準格式的 PDF 文件。

## ✨ 主要功能

* **⚡ 極速 NER 解析**：利用正則表達式 (Regex) 智能分析雜亂文字，自動抓取 AWB、日期、地址、金額、重量等關鍵欄位。
* **📋 剪貼簿模式**：支援從 iOS/Android 原生相簿或 Google Lens 複製文字後直接貼上，準確率高達 99%。
* **📄 PDF 生成**：內建 FedEx 風格底圖，一鍵生成標準 A4 商業發票。
* **📱 PWA 支援**：可安裝至手機桌面，完全離線使用，無需網路。
* **🔒 隱私優先**：所有解析與 PDF 生成皆在**本機 (Local)** 完成，資料不會上傳至任何伺服器。

## 🚀 如何使用 (v2.0 流程)

不再需要使用網頁內建的相機功能，請改用以下更高效的流程：

1.  **複製文字**：
    * 打開手機相簿，長按發票圖片/截圖，選擇「複製文字」。
    * 或是從 Email / LINE 複製相關資訊。
2.  **貼上**：
    * 打開本網頁，將文字貼入上方的輸入框。
3.  **智能解析**：
    * 點擊 **「⚡ 執行智能帶入 (NER)」**。
    * 系統會自動將資料填入對應欄位。
4.  **生成 PDF**：
    * 檢查欄位無誤後，點擊 **「📄 生成 PDF 並下載」**。

## 🛠️ 技術棧

* **Core**: Vanilla JavaScript (原生 JS，無框架)
* **PDF Engine**: [pdf-lib](https://github.com/Hopding/pdf-lib)
* **UI Style**: CSS Variables (Titanium Grey x Champagne Gold Theme)
* **Deployment**: Static HTML (GitHub Pages compatible)

## 📂 專案結構

```text
.
├── index.html      # 主程式介面 (v2.0)
├── main.js         # 核心邏輯 (NER 解析 + PDF 生成)
├── style.css       # 主要樣式表
├── sw.js           # Service Worker (離線快取控制)
├── manifest.json   # PWA 設定檔
├── assets/         # 存放 PDF 模板檔案
└── ui/             # 介面主題 Token 與載入器