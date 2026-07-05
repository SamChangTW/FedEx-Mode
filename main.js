// FedEx OCR 商業發票主邏輯 — 版本號單源於 version.js（改版只改那一檔）；PDF 版面沿用「v1.7M 原始制式表格」校準座標
const byId = (id) => document.getElementById(id);

// UI 元件參照
const btnCameraText = byId("btnCameraText");
const btnRunNER = byId("btnRunNER");
const photoInput = byId("photoInput");
const rawText = byId("rawText");
const textExtractStatus = byId("textExtractStatus");

const awb = byId("awb");
const dateEl = byId("date");
const seller = byId("seller");
const sellerAddr = byId("sellerAddr");
const buyer = byId("buyer");
const buyerAddr = byId("buyerAddr");
const desc = byId("desc");
const amount = byId("amount");
const weight = byId("weight");
const pieces = byId("pieces");
const countryEl = byId("country");
const postalCodeEl = byId("postalCode");
const phoneEl = byId("phone");

const btnPdf = byId("btnPdf");
const outStatus = byId("outStatus");
const btnClear = byId("btnClear");
const useFedExTpl = byId("useFedExTpl");
const tplInput = byId("tplInput");
const tplRow = byId("tplRow");

// === Tesseract Worker Singleton（含並發保護，防止重複建立 Worker）===
let _tesseractWorker = null;
let _tesseractWorkerPromise = null;

async function getTesseractWorker() {
  if (_tesseractWorker) return _tesseractWorker;
  if (_tesseractWorkerPromise) return _tesseractWorkerPromise;
  _tesseractWorkerPromise = (async () => {
    setStatus('初始化 Tesseract OCR 引擎中（初次較慢，請稍候）...');
    _tesseractWorker = await Tesseract.createWorker('eng+chi_tra');
    console.debug('[Tesseract] Worker 已建立並快取');
    _tesseractWorkerPromise = null;
    return _tesseractWorker;
  })();
  return _tesseractWorkerPromise;
}

// 切換模板上傳列顯示狀態
if (useFedExTpl && tplRow) {
  const syncTplRow = () => {
    tplRow.style.display = useFedExTpl.checked ? 'flex' : 'none';
  };
  useFedExTpl.addEventListener('change', syncTplRow);
  syncTplRow();
}

// ===== Gemini API Key 設定 UI 邏輯 =====
const GEMINI_KEY_STORAGE = 'fedex_gemini_api_key';
const geminiModeLabel      = byId('geminiModeLabel');
const geminiSettingsPanel  = byId('geminiSettingsPanel');
const geminiApiKeyInput    = byId('geminiApiKeyInput');
const btnToggleGeminiSettings = byId('btnToggleGeminiSettings');
const btnSaveGeminiKey     = byId('btnSaveGeminiKey');
const btnClearGeminiKey    = byId('btnClearGeminiKey');

function getGeminiKey() { return localStorage.getItem(GEMINI_KEY_STORAGE) || ''; }

function updateGeminiModeLabel() {
  if (!geminiModeLabel) return;
  const hasKey = Boolean(getGeminiKey());
  geminiModeLabel.textContent = hasKey ? '✨ Gemini Vision 模式' : '📷 本地 OCR 模式';
  geminiModeLabel.className = `gemini-mode-label ${hasKey ? 'is-active' : 'is-inactive'}`;
}

if (btnToggleGeminiSettings) {
  btnToggleGeminiSettings.addEventListener('click', () => {
    if (!geminiSettingsPanel) return;
    const willOpen = !geminiSettingsPanel.classList.contains('is-open');
    if (willOpen && geminiApiKeyInput) geminiApiKeyInput.value = getGeminiKey();
    geminiSettingsPanel.classList.toggle('is-open');
    btnToggleGeminiSettings.setAttribute('aria-expanded', String(willOpen));
  });
}
if (btnSaveGeminiKey) {
  btnSaveGeminiKey.addEventListener('click', () => {
    const k = geminiApiKeyInput?.value.trim();
    if (!k) { alert('請輸入 API Key'); return; }
    localStorage.setItem(GEMINI_KEY_STORAGE, k);
    geminiSettingsPanel?.classList.remove('is-open');
    updateGeminiModeLabel();
    setStatus('✅ Gemini API Key 已儲存，拍照將使用 Gemini Vision 辨識');
  });
}
if (btnClearGeminiKey) {
  btnClearGeminiKey.addEventListener('click', () => {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
    if (geminiApiKeyInput) geminiApiKeyInput.value = '';
    updateGeminiModeLabel();
    setStatus('已清除 Gemini Key，將改用本地 OCR 模式');
  });
}
updateGeminiModeLabel(); // 頁面載入時初始化模式標示

// ===== 版本顯示單源注入（改版只需改 version.js，標題與副標自動跟上）=====
(function injectVersionLabel() {
  const ver = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '';
  if (!ver) return;
  document.title = `FedEx 模式｜OCR 商業發票 ${ver}`;
  const sub = byId('app-subtitle');
  if (sub) sub.textContent = `${ver} · ${sub.textContent}`;
})();

// ===== Gemini Vision API 辨識函式 =====
async function analyzeWithGeminiVision(imageDataUrl) {
  const apiKey = getGeminiKey();
  if (!apiKey) throw new Error('No Gemini API Key');

  // 將 base64 img 重新分離為純 data
  const base64Data = imageDataUrl.split(',')[1];
  const mimeType   = imageDataUrl.split(';')[0].split(':')[1] || 'image/jpeg';

  const prompt = `你是一個 FedEx 提單解析助手。請從這張 FedEx 國際快遞提單圖片中，
精確提取以下欄位。只回傳 JSON，不要任何其他文字。

{
  "awb": "純數孯追蹤碼，12位數字，移除空格(來自 TRK# 欄位)",
  "shipDate": "YYYY-MM-DD 格式(來自 SHIP DATE:)",
  "senderName": "寄件人姓名(來自 SIGN: 欄位最可靠)",
  "senderCompany": "寄件人公司名",
  "senderAddress": "寄件人地址(一行)",
  "receiverName": "收件人姓名(TO 後第一行)",
  "receiverCompany": "收件人公司名",
  "receiverAddress": "收件人完整地址",
  "description": "貨品說明(來自 DESC1:)",
  "weight": "如 0.50 KG(來自 ACTWGT:)",
  "amount": "CUSTOMS VALUE 的純數字",
  "country": "目的地國家名稱",
  "postalCode": "收件人郵遞區號(若有)",
  "phone": "電話號碼含國碼(若有)",
  "pieces": "件數(來自 PKG: X of Y 的 Y，若有)"
}`;

  // 依序嘗試有效模型，直到成功為止
  const MODELS_TO_TRY = [
    'v1beta/models/gemini-3.5-flash:generateContent',
    'v1beta/models/gemini-2.5-flash:generateContent',
    'v1beta/models/gemini-2.0-flash:generateContent',
  ];

  let resp = null;
  let allErrors = [];
  for (const modelPath of MODELS_TO_TRY) {
    const url = `https://generativelanguage.googleapis.com/${modelPath}?key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      resp = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64Data } }
            ]
          }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" }
        })
      });
      clearTimeout(timeoutId);

      if (resp.ok) break;
      const errText = await resp.text();
      let shortErr = errText;
      try { shortErr = JSON.parse(errText).error.message; } catch(e){}
      allErrors.push(`[${modelPath.split('/')[2].split(':')[0]}] ${resp.status}: ${shortErr}`);
    } catch(e) {
      clearTimeout(timeoutId);
      const errMsg = e.name === 'AbortError' ? '請求逾時 (30s)' : e.message;
      allErrors.push(`[${modelPath.split('/')[2].split(':')[0]}] Err: ${errMsg}`);
    }
  }
  if (!resp || !resp.ok) {
    let availableModels = '';
    try {
      const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listResp.ok) {
        const listJson = await listResp.json();
        const models = (listJson.models || [])
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.split('/')[1])
          .join(', ');
        availableModels = `\n\n[系統偵測] 您這個 API Key 有權限調用的模型有：\n${models}`;
      }
    } catch(e) {}
    throw new Error(`所有模型皆失敗:\n` + allErrors.join('\n') + availableModels);
  }

  const json = await resp.json();
  const rawContent = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // 移除 markdown 代碼區塊符號再解析
  const cleanJson = rawContent.replace(/```json\s*/ig, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleanJson);
  } catch (err) {
    console.error("Gemini Raw Output:", rawContent);
    throw new Error(`JSON 解析失敗: ${err.message}\nGemini 回傳內容: ${rawContent.substring(0,100)}...`);
  }
}

function fillFieldsFromGemini(data) {
  if (data.awb)             awb.value         = data.awb;
  if (data.shipDate)        dateEl.value       = data.shipDate;
  if (data.senderName)      seller.value       = data.senderName;
  if (data.senderCompany && !data.senderName)
                            seller.value       = data.senderCompany;
  const sAddr = [data.senderCompany, data.senderAddress].filter(Boolean).join('\n');
  if (sAddr)                sellerAddr.value   = sAddr;
  if (data.receiverName)    buyer.value        = data.receiverName;
  if (data.receiverCompany && !data.receiverName)
                            buyer.value        = data.receiverCompany;
  const rAddr = [data.receiverCompany, data.receiverAddress].filter(Boolean).join('\n');
  if (rAddr)                buyerAddr.value    = rAddr;
  if (data.description)     desc.value         = data.description;
  if (data.weight)          weight.value       = data.weight;
  if (data.amount)          amount.value       = data.amount;
  if (data.country)         countryEl.value    = data.country;
  if (data.postalCode)      postalCodeEl.value = data.postalCode;
  if (data.phone)           phoneEl.value      = data.phone;
  if (data.pieces)          pieces.value       = data.pieces;
}

// ===== 拍照流程：Gemini Vision 優先，降級為 Tesseract =====
if (photoInput) {
  photoInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setStatus('讀取圖片中…');
      const { canvas } = await loadImageToCanvas(file);
      const apiKey = getGeminiKey();

      if (apiKey) {
        // === Gemini Vision 路徑 ===
        setStatus('✨ 使用 Gemini Vision 辨識中，請稍候…');
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const geminiData = await analyzeWithGeminiVision(dataUrl);
        fillFieldsFromGemini(geminiData);
        rawText.value = JSON.stringify(geminiData, null, 2);
        syncNerButtonState();
        setStatus('✅ Gemini Vision 辨識完成！請確認欄位內容');
      } else {
        // === Tesseract OCR 降級路徑 ===
        setStatus('📷 使用本地 OCR 擷取中…');
        const txt = await extractTextFromImage(canvas);
        rawText.value = (txt || '').trim();
        syncNerButtonState();
        setStatus(txt && txt.trim()
          ? '已擷取文字，請按「使用文字智能帶入（NER）」'
          : '未擷取到可用文字，請嘗試較清晰的照片');
      }
    } catch (err) {
      console.error(err);
      setStatus('辨識失敗：' + (err?.message || err));
    } finally {
      photoInput.value = '';
    }
  });
}

// 鍵盤無障礙：相機按鈕為 label[role=button]，補上 Enter/Space 觸發
if (btnCameraText && photoInput) {
  btnCameraText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); photoInput.click(); }
  });
}

function setStatus(msg) { if (textExtractStatus) textExtractStatus.textContent = msg || ''; }

function setOutStatus(msg, type = '') {
  if (!outStatus) return;
  outStatus.textContent = msg || '';
  outStatus.className = type ? `status-${type}` : '';
}

// Canvas 載入工具
async function loadImageToCanvas(src) {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => {
        const maxW = 1600;
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ canvas, ctx, width: w, height: h });
      };
      img.onerror = () => reject(new Error('無法載入圖片'));
      if (src instanceof File) {
        const fr = new FileReader();
        fr.onload = () => { img.src = fr.result; };
        fr.readAsDataURL(src);
      } else if (typeof src === 'string') {
        img.src = src;
      } else {
        reject(new Error('不支援的圖片來源'));
      }
    } catch (e) { reject(e); }
  });
}

// 改用 Tesseract.js 進行 OCR (支援英文與繁體中文，準確度大幅提升)
// Worker 已由頂層 getTesseractWorker() 管理為 Singleton，避免重複初始化
async function extractTextFromImage(canvas) {
  // 優先嘗試瀏覽器原生 TextDetector（離線、快速）
  try {
    const TD = window.TextDetector;
    if (TD) {
      const detector = new TD();
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.92));
      const bmp = await createImageBitmap(blob);
      const results = await detector.detect(bmp);
      if (Array.isArray(results) && results.length) {
        return results.map(r => r.rawValue || r.text || '').filter(Boolean).join('\n');
      }
    }
  } catch (e) { console.debug('[TextDetector] 不可用，切換至 Tesseract', e); }

  // 退回 Tesseract（使用 Singleton Worker，重複使用不重建）
  try {
    if (typeof window.Tesseract !== 'undefined') {
      const worker = await getTesseractWorker();
      setStatus('OCR 辨識中，請稍候...');
      const dataUrl = canvas.toDataURL('image/png');
      const ret = await worker.recognize(dataUrl);
      return ret.data.text || '';
    }
  } catch (e) {
    console.error('[Tesseract] OCR 辨識失敗:', e);
  }
  return '';
}

// ==========================================
// 恢復完整的 NER 智能解析邏輯 (Full Version)
// ==========================================
function parseTextWithNER(text) {
  const out = {
    senderName: '', senderCompany: '', senderAddress: '',
    recipientName: '', recipientCompany: '', recipientAddress: '',
    phone: '', postalCode: '', country: '',
    description: '', descriptionConfidence: 0,
    awb: '', date: '', amount: '', weight: '', pieces: ''
  };
  if (!text) return out;
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const whole = lines.join('\n');

  // Phone (intl, allow spaces/dashes)
  const phoneMatch = whole.match(/(?:TEL|PHONE|聯絡電話|電話)\s*[:：]?\s*([+]?\d[\d\s\-()]{6,}\d)/i) || whole.match(/\b\+?\d[\d\s\-()]{6,}\d\b/);
  if (phoneMatch) out.phone = phoneMatch[1] ? phoneMatch[1].trim() : phoneMatch[0].trim();

  // DESC1/DESC2 直接提取（FedEx 標籤格式，最高優先，早於語義分析）
  for (const ln of lines) {
    const dp = ln.match(/^DESC\d+\s*[:：]?\s*(.+)/i);
    if (dp) {
      let dv = dp[1].replace(/\s*\([^)]*\)\s*/g, '').trim(); // 移除括號說明
      if (dv.length >= 3) { out.description = dv; out.descriptionConfidence = 5; break; }
    }
  }

  // Postal code — 優先從收件地區段把取，避免誤抓地址門號數字
  // 策略：1. 明確關鍵字 2. 從 TO 行後 8 行內找 5 6 位數 3. 全文最後出現的连續數字組
  let postalCode = '';
  // 明確關鍵字挑取
  const postalKeyMatch = whole.match(/(?:POSTAL\s*CODE|ZIP|郵遞區號)\s*[:：]?\s*(\d{3,6})\b/i);
  if (postalKeyMatch) {
    postalCode = postalKeyMatch[1];
  } else {
    // 從收件區段抓取：從 TO 行後找 5-6 位郵遞區號
    const toIdxP = lines.findIndex(l => /^TO\s+/i.test(l));
    if (toIdxP >= 0) {
      const nearLines = lines.slice(toIdxP, Math.min(toIdxP + 8, lines.length)).join(' ');
      const zipNear = nearLines.match(/\b(\d{5,6})\b/);
      if (zipNear) postalCode = zipNear[1];
    }
  }
  if (postalCode) out.postalCode = postalCode;

  // AWB — 優先抓 TRK# 或 OCR 誤讀版本（TK!/TK#）後面的 12 位數字
  const awbMatch =
    whole.match(/T[RK][K#!]?\s*[#!]?\s*([\d\s]{10,18})/) ||
    whole.match(/(?:AWB|WAYBILL|提單|單號)\s*[:：#]?\s*(\d[\d\s-]{8,16}\d)/) ||
    whole.match(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/);
  if (awbMatch) out.awb = (awbMatch[1] || awbMatch[0]).replace(/[\s-]/g, '').trim();

  // Date — SHIP DATE 最優先（FedEx 專屬），再試 ISO 格式
  const dateMatch =
    whole.match(/SHIP\s*DATE\s*[:：]?\s*(\d{1,2}[A-Z]{3}\d{2,4})/i) ||
    whole.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/) ||
    whole.match(/(?:DATE|日期)\s*[:：]?\s*(\d{1,2}[A-Z]{3}\d{2,4}|[\dA-Za-z/.-]{6,15})/i);
  if (dateMatch) {
    let dStr = (dateMatch[1] || dateMatch[0]).trim();
    // 轉換 FedEx 簡短月份格式如 25JUN18 → 2018-06-25
    const fedexDate = dStr.match(/^(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2,4})$/i);
    if (fedexDate) {
      const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
      const yr = fedexDate[3].length === 2 ? '20' + fedexDate[3] : fedexDate[3];
      dStr = `${yr}-${MONTHS[fedexDate[2].toUpperCase()]}-${fedexDate[1].padStart(2, '0')}`;
    } else {
      dStr = dStr.replace(/^[^\d]+/, '');
    }
    out.date = dStr.trim();
  }

  // SIGN: 欄位 — FedEx 提單的 SIGN: 直接就是寄件人姓名（最高可靠度）
  const signMatch = whole.match(/SIGN\s*[:：]\s*([A-Za-z一-龥][A-Za-z一-龥\s.'-]{1,40})/i);
  if (signMatch) out.senderName = signMatch[1].trim();

  // Weight (e.g. 5.5 KG, 10 LB)
  // Weight — 優先抓 ACTWGT（FedEx 實際重量標籤，最可靠），其次才是通用關鍵字
  const weightMatch =
    whole.match(/ACTWGT\s*[:：]?\s*([\d.]+\s*(?:KG|KGS|LB|LBS))/i) ||
    whole.match(/(?:ACTUAL\s*WGT|WEIGHT|WT|重量)\s*[:：]?\s*([\d.]+\s*(?:KG|KGS|LB|LBS))/i) ||
    whole.match(/\b([\d.]+\s*(?:KG|KGS|LB|LBS))\b/i);
  if (weightMatch) out.weight = (weightMatch[1] || weightMatch[0]).toUpperCase().trim();

  // Pieces (Qty)
  const pcMatch = whole.match(/(?:PIECES|PCS|QTY|件數|數量)\s*[:：]?\s*(\d+)/i);
  if (pcMatch) out.pieces = pcMatch[1].trim();

  // Amount — 優先取 CUSTOMS VALUE（核銷用申報價值），避免誤取 CARRIAGE VALUE: 0.00
  const amtMatch =
    whole.match(/CUSTOMS\s*VALUE\s*[:：]?\s*(?:USD|TWD|\$)?\s*(\d+(?:\.\d+)?)/i) ||
    whole.match(/(?:TOTAL|AMOUNT|VALUE|金額|總金額|總價)\s*[:：]?\s*(?:USD|TWD|\$)?\s*(\d+(?:\.\d+)?)/i) ||
    whole.match(/\b(?:USD|\$)\s*(\d+(?:\.\d+)?)\b/i);
  if (amtMatch) out.amount = amtMatch[1].trim();

  // Country detection — 優先搜尋 TO/收件人區段附近的國家，避免抓寄件地
  // 策略：先找 TO 後的行，找到國家後記錄；全文掃描只當備援
  const countryList = [
    'Brazil', 'United States', 'USA', 'US', 'America',
    'Taiwan', 'Republic of China', 'ROC', 'Taipei',
    'United Kingdom', 'UK', 'GB', 'Great Britain',
    'China', 'PRC', 'Japan', 'JP', 'Korea', 'KR', 'South Korea',
    'Canada', 'CA', 'Australia', 'AU', 'Germany', 'DE', 'France', 'FR',
    'Italy', 'IT', 'Spain', 'ES', 'Netherlands', 'NL',
    'Singapore', 'SG', 'Hong Kong', 'HK', 'Macao', 'Macau', 'MO',
    'Mexico', 'MX', 'India', 'IN', 'Thailand', 'TH', 'Vietnam', 'VN',
    'Indonesia', 'ID', 'Philippines', 'PH', 'Malaysia', 'MY'
  ];
  // 預編譯國家名稱正則，避免每行重複建立（T-1 效能優化）
  const countryPatterns = countryList.map(c => ({
    name: c,
    re: new RegExp(`(^|[^A-Za-z])${c.replace(/\s+/g, '\\s+')}([^A-Za-z]|$)`, 'i')
  }));
  // 先嘗試在 TO 區段後的行中尋找國家（優先判斷目的地）
  const toIdx = lines.findIndex(l => /^to\b/i.test(l));
  const searchLines = toIdx >= 0 ? lines.slice(toIdx, Math.min(toIdx + 10, lines.length)) : lines;
  outer:
  for (const pool of [searchLines, lines]) {
    for (const { name, re } of countryPatterns) {
      if (pool.some(l => re.test(l))) { out.country = name; break outer; }
    }
  }
  if (!out.country) {
    // ISO 代碼備援：優先從 TO 區段抓取
    const isoTarget = searchLines.join('\n');
    const iso = isoTarget.match(/\b(BR|TW|US|UK|GB|CN|JP|KR|CA|AU|DE|FR|IT|ES|NL|SG|HK|MO|MX|IN|TH|VN|ID|PH|MY)\b/) ||
      whole.match(/\b(BR|TW|US|UK|GB|CN|JP|KR|CA|AU|DE|FR|IT|ES|NL|SG|HK|MO|MX|IN|TH|VN|ID|PH|MY)\b/);
    if (iso) out.country = iso[1];
  }

  // Identify sender block: 尋找 ORIGIN ID 或寄件人關鍵字
  // idxSender: 優先找 ORIGIN ID 行，其後為 sender 資訊
  let idxSender = lines.findIndex(l => /(?:ORIGIN\s*ID|寄件人|發件人|Sender|From|Shipper|Consignor)/i.test(l));

  // idxRecipient: 找「TO 姓名」開頭的行（如 "TO Thaismara Costa"），避免匹配到 BILL RECIPIENT/EIN/VAT 等標籤行
  const idxRecipient = lines.findIndex(l => /^TO\s+[A-Za-z一-龥]/i.test(l));

  const sliceBlock = (startIdx) => {
    if (startIdx < 0) return [];
    const out = [];
    for (let i = startIdx + 1; i < Math.min(lines.length, startIdx + 10); i++) {
      const s = lines[i];
      // 遇到區段分隔關鍵字或標籤列時停止
      if (/(寄件人|發件人|Sender|From|Shipper|Consignor|收件人|收貨人|Recipient|Ship\s*-?\s*To|Consignee|Invoice|Description|Amount|重量|Weight|Pieces|件數|BILL|EIN|VAT|SIGN:|T\/C:|D\/T:|TRK#|AWB|PKG|INTL|PRIORITY|COUNTRY\s*MFG)/i.test(s)) break;
      // 跳過純標籤行（結尾為冒號且無實質內容，如 "EIN/VAT:"）
      if (/^[A-Z\/]+\s*:$/.test(s)) continue;
      if (s) out.push(s);
    }
    return out;
  };

  const senderBlock = sliceBlock(idxSender);
  const recipientBlock = sliceBlock(idxRecipient);

  // Heuristics: first line likely name/company; subsequent lines address
  const parseNameAddr = (block) => {
    if (!block || !block.length) return { name: '', company: '', address: '' };
    const first = block[0];
    const second = block[1] || '';
    // If first line contains Co., Ltd., Inc., 公司, 股份, 有限, treat as company
    const isCompany = /(CO\.?|INC\.?|LTD\.?|LLC|有限公司|股份|公司|集團|CORP\.?)/i.test(first);
    const name = isCompany ? second : first;
    const company = isCompany ? first : '';
    const rest = isCompany ? block.slice(2) : block.slice(1);
    const address = rest.join('\n');
    return { name: (name || '').trim(), company: (company || '').trim(), address: address.trim() };
  };

  const sNA = parseNameAddr(senderBlock);
  const rNA = parseNameAddr(recipientBlock);
  out.senderName = sNA.name; out.senderCompany = sNA.company; out.senderAddress = sNA.address;
  out.recipientName = rNA.name; out.recipientCompany = rNA.company; out.recipientAddress = rNA.address;

  // 補充：若收件人區塊已識別，從中直接提取 recipientName（抓 TO 所在行的其餘部分）
  if (idxRecipient >= 0) {
    const toLine = lines[idxRecipient];
    const inlineName = toLine.replace(/^TO\s+/i, '').trim();
    if (inlineName && !out.recipientName) out.recipientName = inlineName;
    else if (inlineName && out.recipientName !== inlineName) {
      // TO 行直接帶名字時，以 TO 行為優先（更可靠）
      out.recipientName = inlineName;
    }
  }

  // If still missing, try generic address/name heuristics
  if (!out.recipientAddress) {
    const cityZipLine = lines.find(l => /(CITY|TOWNSHIP|COUNTY|DISTRICT|VILLAGE|TOWN|CITY\s*\d{2}|[A-Z]{2,})\s+\d{3,6}(?:\s+[A-Z]{2})?$/i.test(l));
    if (cityZipLine) {
      const idx = lines.indexOf(cityZipLine);
      const addrLines = [];
      if (lines[idx - 1]) addrLines.unshift(lines[idx - 1]);
      if (lines[idx - 2]) addrLines.unshift(lines[idx - 2]);
      out.recipientAddress = [...addrLines, cityZipLine].join('\n');
      const nm = lines[idx - 3] || lines[idx - 2];
      if (nm && /[\p{L}A-Za-z]/u.test(nm)) out.recipientName = out.recipientName || nm;
    }
  }

  // Semantic item description extraction (goods/commodity)
  try {
    const descEnt = extractShipmentDescriptionSemantic({
      text: whole,
      lines,
      excludeBlocks: {
        sender: senderBlock,
        recipient: recipientBlock
      }
    });
    if (descEnt && descEnt.value && descEnt.confidence >= 3) {
      out.description = descEnt.value;
      out.descriptionConfidence = descEnt.confidence;
    }
  } catch (e) { /* best-effort; ignore */ }

  return out;
}

// --- Semantic shipment description extractor (Full Logic Restored) ---
function extractShipmentDescriptionSemantic(ctx) {
  const text = (ctx?.text || '').trim();
  const lines = Array.isArray(ctx?.lines) ? ctx.lines : text.split(/\r?\n/).map(s => s.trim());
  if (!text) return { value: '', confidence: 0 };

  // DESC1/DESC2 前綴直接提取（FedEx 標籤格式），無需透過語義評分，信心度直接設為 5
  for (const ln of lines) {
    const descPrefixMatch = ln.match(/^DESC\d+\s*[:：]?\s*(.+)/i);
    if (descPrefixMatch) {
      let val = descPrefixMatch[1].trim();
      // 清除括號說明（如 (a Non-DG, Not restricted as per IATA)）
      val = val.replace(/\s*\([^)]*\)\s*/g, '').trim();
      if (val.length >= 3) return { value: val, confidence: 5 };
    }
  }

  const GOODS_LEXICON = [
    // 化工/工業品
    'photoinitiator', 'brightener', 'chemical', 'reagent', 'solvent', 'resin', 'pigment', 'adhesive',
    // 一般貨品
    'paperboard box', 'carton', 'box', 'documents', 'document', 'papers', 'commercial goods',
    'merchandise', 'goods', 'electronics', 'electronic', 'device', 'devices',
    'clothing sample', 'sample', 'samples', 'garment', 'clothing',
    'accessories', 'accessory', 'parts', 'spare parts',
    'gift', 'return', 'parcel', 'package', 'packages',
    'watch', 'bag', 'bags', 'shoes', 'book', 'books',
    'stationery', 'toy', 'toys', 'component', 'components'
  ];
  const QTY_CUES_RE = /\b(?:\d+[\d.,]*\s*)?(?:pcs?|pieces?|units?|unit|boxes|box|cartons?|ctn|pkg|packages?|set|sets|kg|g|lb|lbs)\b/i;
  const ADDRESS_CUES_RE = /(street|st\.?|road|rd\.?|avenue|ave\.?|blvd\.?|lane|ln\.?|drive|dr\.?|district|city|county|state|province|zip|postal|floor|fl\.|suite|ste\.|號|路|街|巷|弄|樓|市|區|鄉|鎮)/i;
  const NAME_CUES_RE = /(Mr\.?|Ms\.?|Mrs\.?|先生|小姐|公司|股份|有限公司|CO\.?|INC\.?|LTD\.?|LLC|CORP\.?)/i;
  const PHONE_RE = /\+?\d[\d\s\-()]{6,}\d/;
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

  const excludeSet = new Set();
  const addToExclude = (arr) => { (arr || []).forEach(s => { if (s) excludeSet.add(s.trim()); }); };
  if (ctx?.excludeBlocks) { addToExclude(ctx.excludeBlocks.sender); addToExclude(ctx.excludeBlocks.recipient); }

  const candList = [];
  const pushCand = (value, lineIdx, origin) => {
    const v = (value || '').trim().replace(/^[-:•·*\s]+/, '').replace(/\s{2,}/g, ' ');
    if (!v) return;
    if (v.length < 2 || v.length > 80) return;
    if (PHONE_RE.test(v) || EMAIL_RE.test(v)) return;
    if (/^(sender|from|shipper|to|recipient|consignee|address|addr|invoice|amount|weight|pieces|awb|tracking|trk)/i.test(v)) return;
    candList.push({ value: v, lineIdx, origin });
  };

  lines.forEach((ln, i) => {
    const raw = (ln || '').trim();
    if (!raw) return;
    if (excludeSet.has(raw)) return;
    if (PHONE_RE.test(raw) || EMAIL_RE.test(raw)) return;
    if (/^\d{3,}$/.test(raw)) return;
    const cleaned = raw.replace(/\b(description|contents?|商品|品名|物品|貨品|內容)\b\s*[:：]/i, ' ');
    const parts = cleaned.split(/[\|,/;]+|\s{2,}/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return;

    const qtyHit = QTY_CUES_RE.test(raw);
    if (qtyHit) {
      const m1 = raw.match(/\b(\d+[\d.,]*)\s*(pcs?|pieces?|units?|boxes?|cartons?|kg|g|lb|lbs)\b\s*([A-Za-z][\w \-]{1,60})/i);
      if (m1) pushCand(m1[3], i, 'qty-tail');
      const m2 = raw.match(/([A-Za-z][\w \-]{1,60})\s*\b(\d+[\d.,]*)\s*(pcs?|pieces?|units?|boxes?|cartons?|kg|g|lb|lbs)\b/i);
      if (m2) pushCand(m2[1], i, 'qty-head');
    }

    parts.forEach(p => {
      const words = p.split(/\s+/).filter(Boolean);
      if (words.length === 0 || words.length > 6) return;
      if (!/[A-Za-z\p{L}]/u.test(p)) return;
      pushCand(p, i, 'part');
    });
  });

  const lowerText = text.toLowerCase();
  const scoreCand = (c) => {
    let s = 1;
    const vLow = c.value.toLowerCase();
    if (GOODS_LEXICON.some(g => vLow.includes(g))) s += 2;
    for (let d = -2; d <= 2; d++) {
      const li = c.lineIdx + d;
      if (li >= 0 && li < lines.length && QTY_CUES_RE.test(lines[li] || '')) { s += (d === 0 ? 2 : 1); break; }
    }
    if (ADDRESS_CUES_RE.test(c.value)) s -= 2;
    if (NAME_CUES_RE.test(c.value)) s -= 1;
    if (c.value.length >= 3 && c.value.length <= 30) s += 1;
    if (c.value.length > 12 && c.value === c.value.toUpperCase()) s -= 1;
    return s;
  };

  let best = null;
  for (const c of candList) {
    const sc = scoreCand(c);
    if (!best || sc > best.score) best = { ...c, score: sc };
  }
  if (!best || best.score < 3) return { value: '', confidence: best ? best.score : 0 };

  let val = best.value.replace(/^(contents?|description|desc|品名|貨品|內容)\s*[:：\-]\s*/i, '').trim();
  val = val.replace(/\b(kg|g|lb|lbs|pcs?|pieces?|units?)\b/ig, '').replace(/\s{2,}/g, ' ').trim();
  const title = val.split(' ').map(w => {
    if (/^[A-Z0-9]{2,}$/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
  return { value: title || val, confidence: best.score };
}

function fillFieldsFromEntities(ent) {
  if (!ent) return;
  if (seller && (ent.senderCompany || ent.senderName)) seller.value = (ent.senderCompany || ent.senderName || '').trim();
  if (sellerAddr && ent.senderAddress) sellerAddr.value = ent.senderAddress;
  if (buyer && (ent.recipientCompany || ent.recipientName)) buyer.value = (ent.recipientCompany || ent.recipientName || '').trim();
  if (buyerAddr && ent.recipientAddress) buyerAddr.value = ent.recipientAddress;
  if (countryEl && ent.country) countryEl.value = ent.country;
  if (postalCodeEl && ent.postalCode) postalCodeEl.value = ent.postalCode;
  if (phoneEl && ent.phone) phoneEl.value = ent.phone;
  if (desc && ent.description && (desc.value || '').trim() === '' && (ent.descriptionConfidence || 0) >= 3) {
    desc.value = ent.description;
  }
  if (awb && ent.awb) awb.value = ent.awb;
  if (dateEl && ent.date) dateEl.value = ent.date;
  if (amount && ent.amount) amount.value = ent.amount;
  if (weight && ent.weight) weight.value = ent.weight;
  if (pieces && ent.pieces) pieces.value = ent.pieces;
}

// NER 按鈕禁用狀態同步（有文字才可按）
function syncNerButtonState() {
  if (!btnRunNER) return;
  btnRunNER.disabled = !(rawText?.value || '').trim();
}
if (rawText) rawText.addEventListener('input', syncNerButtonState);
syncNerButtonState();

if (btnRunNER && rawText) {
  btnRunNER.addEventListener('click', () => {
    const val = (rawText.value || '').trim();
    if (!val) { setStatus('請先拍照'); return; }
    const ent = parseTextWithNER(val);
    fillFieldsFromEntities(ent);
    setStatus('已完成智能帶入。');
  });
}

if (btnClear) {
  btnClear.addEventListener('click', () => {
    [awb, dateEl, seller, sellerAddr, buyer, buyerAddr, countryEl, postalCodeEl, phoneEl, desc, amount, weight, pieces, rawText]
      .forEach(e => { if (e) e.value = ''; });
    setStatus('');
    syncNerButtonState();
  });
}

// =========================================================
// PDF 生成邏輯
// =========================================================

// 防抖守衛：防止重複點擊觸發多次並行生成
let _pdfGenerating = false;

btnPdf.addEventListener('click', async () => {
  if (_pdfGenerating) return;
  _pdfGenerating = true;
  btnPdf.disabled = true;

  // 補全收件人地址：合併郵遞區號與目的地國家（若尚未包含於地址中）
  const postalVal  = (postalCodeEl?.value || '').trim();
  const countryVal = (countryEl?.value || '').trim();
  const phoneVal   = (phoneEl?.value || '').trim();

  let fullBuyerAddr = (buyerAddr?.value || '').trim();
  if (postalVal && !fullBuyerAddr.includes(postalVal)) {
    fullBuyerAddr = fullBuyerAddr ? `${fullBuyerAddr} ${postalVal}` : postalVal;
  }
  if (countryVal && !fullBuyerAddr.toLowerCase().includes(countryVal.toLowerCase())) {
    fullBuyerAddr = fullBuyerAddr ? `${fullBuyerAddr}\n${countryVal}` : countryVal;
  }

  // 補全寄件人地址：將電話號碼附加至地址末行（若尚未包含）
  let fullSellerAddr = (sellerAddr?.value || '').trim();
  if (phoneVal && !fullSellerAddr.includes(phoneVal)) {
    fullSellerAddr = fullSellerAddr ? `${fullSellerAddr}\nTEL: ${phoneVal}` : `TEL: ${phoneVal}`;
  }

  const data = {
    awb:        awb.value.trim(),
    date:       (dateEl.value.trim() || new Date().toISOString().slice(0, 10)),
    seller:     seller.value.trim(),
    sellerAddr: fullSellerAddr,
    buyer:      buyer.value.trim(),
    buyerAddr:  fullBuyerAddr,
    desc:       desc.value.trim(),
    amount:     amount.value,
    weight:     weight.value.trim(),
    pieces:     pieces.value.trim(),
  };

  setOutStatus('準備生成 PDF...', 'info');

  const allText = Object.values(data).join('');
  const hasChinese = /[一-龥]/.test(allText);
  if (hasChinese) {
    const proceed = confirm('⚠️ 偵測到中文字元！\n\nPDF 字型僅支援英文/數字，中文將顯示為「??」。\n\n是否仍要繼續生成？');
    if (!proceed) {
      setOutStatus('已取消生成', 'info');
      _pdfGenerating = false;
      btnPdf.disabled = false;
      return;
    }
  }

  try {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    let pdf = await PDFDocument.create();
    let page;
    const wantTpl  = useFedExTpl && useFedExTpl.checked;
    // 使用粗體字型，提升發票可讀性
    const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
    const size     = 10;
    const DEBUG_BOX = false;

    if (wantTpl) {
      let tplBytes = null;
      let mime = 'application/pdf';

      if (tplInput && tplInput.files && tplInput.files[0]) {
        tplBytes = await tplInput.files[0].arrayBuffer();
        mime = tplInput.files[0].type;
      } else {
        const targetFile = 'assets/fedex-commercial-invoice-form-tw.pdf';
        try {
          const resp = await fetch(targetFile);
          if (resp.ok) {
            tplBytes = await resp.arrayBuffer();
          } else {
            throw new Error(`找不到檔案: ${targetFile}`);
          }
        } catch (e) {
          console.error(e);
          alert(`錯誤：無法讀取模板檔案 (${targetFile})。\n\n請確認檔案已放入 assets 資料夾中。`);
          page = pdf.addPage([595.28, 841.89]);
        }
      }

      if (tplBytes) {
        if (mime.includes('pdf')) {
          const tplPdf = await PDFDocument.load(tplBytes);
          const [tplPage] = await pdf.copyPages(tplPdf, [0]);
          page = pdf.addPage(tplPage);
        } else {
          const A4 = [595.28, 841.89];
          page = pdf.addPage(A4);
          const img = mime.includes('png') ? await pdf.embedPng(tplBytes) : await pdf.embedJpg(tplBytes);
          page.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
        }
        setOutStatus('已套用 FedEx 模板', 'info');
      }
    } else {
      page = pdf.addPage([595.28, 841.89]);
    }

    if (!page) page = pdf.addPage([595.28, 841.89]);

    // 自動讀取頁面實際尺寸（適配任意 PDF 模板）
    const { width: pgW, height: pgH } = page.getSize();
    console.debug(`[PDF] 頁面尺寸: ${pgW.toFixed(1)} × ${pgH.toFixed(1)} pt`);

    // 繪製單行文字（粗體，自動過濾中文為 ??）
    const drawField = (text, x, y) => {
      if (!text) return;
      const safeText = String(text).replace(/[一-龥]/g, '??');
      if (DEBUG_BOX) {
        const textWidth = boldFont.widthOfTextAtSize(safeText, size);
        page.drawRectangle({ x, y: y - 2, width: textWidth + 4, height: 12, borderColor: rgb(1, 0, 0), borderWidth: 1 });
      }
      page.drawText(safeText, { x, y, size, font: boldFont, color: rgb(0, 0, 0) });
    };

    // 分段換行：先以 \n 切成硬換行段落，再對每段以字元寬度軟換行
    // 確保 TEL/郵遞區號/國家 等附加行不會橫向溢出至其他欄位
    const wrapText = (text, x, y, maxWidth) => {
      let currentY = y;
      const segments = String(text || '').split('\n');
      for (const segment of segments) {
        const words = segment.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) continue; // 跳過空行，不推進 Y 軸
        let line = '';
        for (const w of words) {
          const candidate = line ? `${line} ${w}` : w;
          const candidateWidth = boldFont.widthOfTextAtSize(candidate, size);
          if (line && candidateWidth > maxWidth) {
            drawField(line.trim(), x, currentY);
            line = w;
            currentY -= 13; // 軟換行行距 13pt
          } else {
            line = candidate;
          }
        }
        if (line.trim()) {
          drawField(line.trim(), x, currentY);
          currentY -= 13; // 硬換行：段落結束後下移一行
        }
      }
    };

    // ===== 精確座標（由校準工具測量）=====
    drawField(data.awb,    pgW * 0.1732, pgH * 0.9103); // #1 AWB 編號
    drawField(data.date,   pgW * 0.2254, pgH * 0.8759); // #2 出口日期
    drawField(data.seller, pgW * 0.0166, pgH * 0.8181); // #3 寄件人名稱
    wrapText(data.sellerAddr, pgW * 0.0166, pgH * 0.8039, pgW * 0.44); // #3 寄件人地址（含電話）
    drawField(data.buyer,  pgW * 0.6809, pgH * 0.8315); // #4 收件人名稱
    wrapText(data.buyerAddr,  pgW * 0.4531, pgH * 0.8139, pgW * 0.44); // #4 收件人地址（含郵遞區號/國家）
    drawField(data.pieces, pgW * 0.1791, pgH * 0.5499); // #5 件數
    drawField(data.desc,   pgW * 0.4045, pgH * 0.5516); // #6 貨品描述
    drawField(data.weight, pgW * 0.7189, pgH * 0.5566); // #7 重量
    drawField(data.amount, pgW * 0.79,   pgH * 0.5583); // #8 單價
    drawField(data.amount, pgW * 0.8707, pgH * 0.5566); // #8 總價
    drawField(data.pieces, pgW * 0.1684, pgH * 0.2355); // 底部合計件數
    drawField(data.weight, pgW * 0.7177, pgH * 0.2372); // 底部合計重量
    drawField(data.amount, pgW * 0.8553, pgH * 0.2372); // 底部合計金額
    drawField(data.seller, pgW * 0.2028, pgH * 0.1199); // 簽名欄-名稱
    drawField(data.date,   pgW * 0.7141, pgH * 0.1182); // 簽名欄-日期

    const pdfBytes = await pdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `FedEx_Invoice_TW_${Date.now()}.pdf`;
    link.click();
    // 延遲釋放 Object URL，確保下載啟動後清理記憶體
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

    setOutStatus(`✅ PDF 下載成功！(${pgW.toFixed(0)}×${pgH.toFixed(0)}pt)`, 'success');
    setTimeout(() => setOutStatus(''), 5000);

  } catch (e) {
    console.error(e);
    alert('生成失敗：' + e.message);
    setOutStatus('⛔ 生成錯誤，請查看控制台', 'error');
  } finally {
    _pdfGenerating = false;
    btnPdf.disabled = false;
  }
});

// T-2: 頁面關閉時清理 Tesseract Worker，釋放 WebWorker 資源
window.addEventListener('pagehide', () => {
  if (_tesseractWorker) {
    _tesseractWorker.terminate().catch(() => {});
    _tesseractWorker = null;
  }
});