// v1.8-Fix Mobile (ZH-TW) — Uses "v1.7M 原始制式表格" style for PDF layout
const $ = (id) => document.getElementById(id);

// UI 元件參照
const btnCameraText = $("btnCameraText");
const btnRunNER = $("btnRunNER");
const photoInput = $("photoInput");
const rawText = $("rawText");
const textExtractStatus = $("textExtractStatus");

const awb = $("awb");
const dateEl = $("date");
const seller = $("seller");
const sellerAddr = $("sellerAddr");
const buyer = $("buyer");
const buyerAddr = $("buyerAddr");
const desc = $("desc");
const amount = $("amount");
const weight = $("weight");
const pieces = $("pieces");
const countryEl = $("country");
const postalCodeEl = $("postalCode");
const phoneEl = $("phone");

const btnPdf = $("btnPdf");
const outStatus = $("outStatus");
const btnClear = $("btnClear");
const useFedExTpl = $("useFedExTpl");
const tplInput = $("tplInput");
const tplRow = $("tplRow");

// === Tesseract Worker Singleton（避免每次重新建立 Worker，大幅提升重複使用效能）===
let _tesseractWorker = null;
async function getTesseractWorker() {
  if (!_tesseractWorker) {
    setStatus('初始化 Tesseract OCR 引擎中（初次較慢，請稍候）...');
    _tesseractWorker = await Tesseract.createWorker('eng+chi_tra');
    console.log('[Tesseract] Worker 已建立並快取');
  }
  return _tesseractWorker;
}

// 切換模板上傳列顯示狀態
if (useFedExTpl && tplRow) {
  const syncTplRow = () => {
    tplRow.style.display = useFedExTpl.checked ? 'flex' : 'none';
  };
  useFedExTpl.addEventListener('change', syncTplRow);
  syncTplRow();
}

// 處理相片選擇 -> 擷取文字
if (photoInput) {
  photoInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setStatus('讀取圖片中…');
      const { canvas } = await loadImageToCanvas(file);
      setStatus('擷取文字中…');
      const txt = await extractTextFromImage(canvas);
      rawText.value = (txt || '').trim();
      setStatus(txt && txt.trim() ? '已擷取文字，請按「使用文字智能帶入（NER）」' : '未擷取到可用文字，請嘗試較清晰的照片');
    } catch (err) {
      console.error(err);
      setStatus('擷取文字失敗：' + (err?.message || err));
    } finally {
      photoInput.value = '';
    }
  });
}

function setStatus(msg) { if (textExtractStatus) textExtractStatus.textContent = msg || ''; }

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
  } catch (e) { console.log('[TextDetector] 不可用，切換至 Tesseract', e); }

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
  const postalKeyMatch = whole.match(/(?:POSTAL\s*CODE|ZIP|\u90f5\u905e\u5340\u865f)\s*[:\uff1a]?\s*(\d{3,6})\b/i);
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

  // AWB — 優先抓 TRK# 後面的 12 位數字（FedEx 標準格式），其次才用英數字段
  // 避免抓到追蹤碼的英文代碼（如 V8CPQX）
  const awbMatch =
    whole.match(/(?:TRK#?|TRACKING(?:\s*NO\.?)?)\s*([\d\s]{10,16})/) ||
    whole.match(/(?:AWB|WAYBILL|提單|單號)\s*[:：#]?\s*(\d[\d\s-]{8,16}\d)/) ||
    whole.match(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/);
  if (awbMatch) out.awb = (awbMatch[1] || awbMatch[0]).replace(/[\s-]/g, '').trim();

  // Date — 支援 YYYY-MM-DD、YYYYMMDD、以及 FedEx 格式 DDJUN18 / Ship Date:
  const dateMatch =
    whole.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/) ||
    whole.match(/(?:SHIP\s*DATE|DATE|日期)\s*[:：]?\s*(\d{1,2}[A-Z]{3}\d{2,4}|[\dA-Za-z/.-]{6,15})/i);
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

  // Weight (e.g. 5.5 KG, 10 LB)
  const weightMatch = whole.match(/(?:WEIGHT|WT|重量|ACTUAL WGT)\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:KG|KGS|LB|LBS))/i) || whole.match(/\b(\d+(?:\.\d+)?\s*(?:KG|KGS|LB|LBS))\b/i);
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
  // 先嘗試在 TO 區段後的行中尋找國家（優先判斷目的地）
  const toIdx = lines.findIndex(l => /^to\b/i.test(l));
  const searchLines = toIdx >= 0 ? lines.slice(toIdx, Math.min(toIdx + 10, lines.length)) : lines;
  outer:
  for (const pool of [searchLines, lines]) {
    for (const c of countryList) {
      const re = new RegExp(`(^|[^A-Za-z])${c.replace(/\s+/g, '\\s+')}([^A-Za-z]|$)`, 'i');
      if (pool.some(l => re.test(l))) { out.country = c; break outer; }
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
  const idxRecipient = lines.findIndex(l => /^TO\s+[A-Za-z\u4e00-\u9fa5]/i.test(l));

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
    [awb, dateEl, seller, sellerAddr, buyer, buyerAddr, countryEl, postalCodeEl, phoneEl, desc, amount, weight, pieces, rawText].forEach(e => { if (e) e.value = ''; });
    setStatus("");
  });
}

// =========================================================
// PDF 生成邏輯 (含紅框除錯 + 中文警告)
// =========================================================
btnPdf.addEventListener("click", async () => {
  const data = {
    awb: awb.value.trim(),
    date: (dateEl.value.trim() || new Date().toISOString().slice(0, 10)),
    seller: seller.value.trim(),
    sellerAddr: sellerAddr.value.trim(),
    buyer: buyer.value.trim(),
    buyerAddr: buyerAddr.value.trim(),
    desc: desc.value.trim(),
    amount: amount.value,
    weight: weight.value.trim(),
    pieces: pieces.value.trim()
  };

  outStatus.textContent = "準備生成 PDF...";
  outStatus.style.color = "blue";

  const allText = Object.values(data).join('');
  const hasChinese = /[\u4e00-\u9fa5]/.test(allText);
  if (hasChinese) {
    // 使用非阻塞的狀態列警告，避免 alert 阻塞 UI
    outStatus.textContent = '⚠️ 偵測到中文字元！PDF 字型僅支援英文/數字，請將欄位改成英文後再生成，否則中文將顯示為「??」。';
    outStatus.style.color = '#D9B44A';
    // 給用戶 3 秒確認再繼續
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  try {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    let pdf = await PDFDocument.create();
    let page;
    const wantTpl = useFedExTpl && useFedExTpl.checked;
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const size = 10;
    const DEBUG_BOX = false; // 正式版關閉紅框除錯

    if (wantTpl) {
      let tplBytes = null;
      let mime = "application/pdf";

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
        outStatus.textContent = "已套用 FedEx 模板";
      }
    } else {
      page = pdf.addPage([595.28, 841.89]);
    }

    if (!page) page = pdf.addPage([595.28, 841.89]);

    const drawField = (text, x, y) => {
      if (!text) return;
      const safeText = String(text).replace(/[\u4e00-\u9fa5]/g, '??');
      if (DEBUG_BOX) {
        const textWidth = helv.widthOfTextAtSize(safeText, size);
        page.drawRectangle({ x, y: y - 2, width: textWidth + 4, height: 12, borderColor: rgb(1, 0, 0), borderWidth: 1 });
      }
      page.drawText(safeText, { x, y, size, font: helv, color: rgb(0, 0, 0) });
    };

    // wrapText: 改用 pdf-lib 精確計算字元像素寬度，避免以字元數估算造成偏移
    const wrapText = (text, x, y, maxWidth) => {
      const words = String(text || '').split(/\s+/);
      let line = '';
      let currentY = y;
      for (const w of words) {
        const candidate = line ? line + ' ' + w : w;
        const candidateWidth = helv.widthOfTextAtSize(candidate, size);
        if (line && candidateWidth > maxWidth) {
          drawField(line.trim(), x, currentY);
          line = w;
          currentY -= 13; // 行距 13pt
        } else {
          line = candidate;
        }
      }
      if (line.trim()) drawField(line.trim(), x, currentY);
    };

    // 1. AWB (上方標題右側/中間框)
    drawField(data.awb, 280, 785);

    // 2. 出口日期 (AWB 下方)
    drawField(data.date, 150, 762);

    // 3. 寄件人區塊 (左側)
    drawField(data.seller, 40, 725);
    wrapText(data.sellerAddr, 40, 710, 250);

    // 4. 收件人區塊 (右側)
    drawField(data.buyer, 310, 725);
    wrapText(data.buyerAddr, 310, 710, 250);

    // 5. 貨品描述 (中間寬欄)
    drawField(data.desc, 190, 520);

    // 6. 表格數據
    drawField(data.pieces, 120, 520); // 件數
    drawField(data.pieces, 420, 520); // 數量
    drawField(data.weight, 455, 520); // 重量
    drawField(data.amount, 500, 520); // 單價
    drawField(data.amount, 550, 520); // 總價

    // 7. 底部總計區
    drawField(data.pieces, 120, 150);
    drawField(data.weight, 455, 150);
    drawField(data.amount, 550, 150);

    // 8. 簽名欄上方
    drawField(data.seller, 40, 60);
    drawField(data.date, 300, 60);

    const pdfBytes = await pdf.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FedEx_Invoice_TW_${Date.now()}.pdf`;
    link.click();

    outStatus.textContent = "PDF 下載成功！(含紅框除錯)";
    setTimeout(() => outStatus.textContent = "", 5000);

  } catch (e) {
    console.error(e);
    alert("生成失敗：" + e.message);
    outStatus.textContent = "生成錯誤";
    outStatus.style.color = "red";
  }
});