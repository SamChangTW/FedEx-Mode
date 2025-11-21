// v1.7M-F-W-R2 Mobile (ZH-TW) — Uses "v1.7M 原始制式表格" style for PDF layout
const $ = (id) => document.getElementById(id);

// Legacy OCR/preview controls are removed in the new flow
const fileInput = null;
const btnCamera = null;
const btnOcr = null;
const ocrProgress = null;
const ocrStatus = null;
const ocrText = null;
const preview = null;
// New Camera + Text + NER UI
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
const btnRemap = $("btnRemap");
const btnClear = $("btnClear");
const btnEnhance = $("btnEnhance");
const btnRotate = $("btnRotate");
const useFedExTpl = $("useFedExTpl");
const tplInput = $("tplInput");
const tplRow = $("tplRow");

// Dummies for removed legacy scanning/HID UI to avoid reference errors in legacy blocks
const btnScanStart = null;
const btnScanStop = null;
const barcodeVideo = null;
const barcodeStatus = null;
const btnSwitchCamera = null;
const btnDecodeImage = null;
const imgDecodeInput = null;
const btnHidToggle = null;

// New: Camera capture → text extraction
if (btnCameraText && photoInput) {
  btnCameraText.addEventListener("click", () => {
    try {
      photoInput.setAttribute("capture", "environment");
      photoInput.click();
      setTimeout(() => photoInput.removeAttribute("capture"), 800);
    } catch {}
  });
}

// Toggle template row visibility based on checkbox
if (useFedExTpl && tplRow) {
  const syncTplRow = () => {
    tplRow.style.display = useFedExTpl.checked ? 'flex' : 'none';
  };
  useFedExTpl.addEventListener('change', syncTplRow);
  // initialize on load
  syncTplRow();
}

// Handle photo selection → extract text → put into textarea
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

// ===== 已移除條碼/二維碼掃描與 HID 掃碼器邏輯（改為相機拍照 + 文字擷取 + NER） =====

// Utility: status helper
function setStatus(msg){ if (textExtractStatus) textExtractStatus.textContent = msg || ''; }

// Utility: load image/file/URL to canvas
async function loadImageToCanvas(src){
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.onload = () => {
        const maxW = 1600; // downscale for speed
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ canvas, ctx, width:w, height:h });
      };
      img.onerror = () => reject(new Error('無法載入圖片'));
      if (src instanceof File) {
        const fr = new FileReader();
        fr.onload = () => { img.src = fr.result; };
        fr.onerror = () => reject(fr.error||new Error('讀取圖片失敗'));
        fr.readAsDataURL(src);
      } else if (typeof src === 'string') {
        img.src = src;
      } else if (src && src.toDataURL) {
        img.src = src.toDataURL('image/png');
      } else {
        reject(new Error('不支援的圖片來源'));
      }
    } catch (e){ reject(e); }
  });
}

// Text extraction: prefer Shape Detection API TextDetector → fallback to OCRAD (lightweight OCR)
async function extractTextFromImage(canvas){
  // Try TextDetector if available
  try {
    // Some browsers implement as window.TextDetector; if not, skip
    const TD = window.TextDetector;
    if (TD) {
      const detector = new TD();
      // Convert canvas to bitmap
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.92));
      const bmp = await createImageBitmap(blob);
      const results = await detector.detect(bmp);
      if (Array.isArray(results) && results.length){
        const texts = results.map(r => r.rawValue || r.text || '').filter(Boolean);
        if (texts.length) return texts.join('\n');
      }
    }
  } catch(e){ /* ignore and fallback */ }

  // Fallback OCR: OCRAD on the canvas
  try {
    if (typeof OCRAD === 'function'){
      return await new Promise((resolve) => {
        try { resolve(OCRAD(canvas) || ''); } catch { resolve(''); }
      });
    }
  } catch {}
  return '';
}

// NER parsing: extract sender/recipient, addresses, phone, postal, country
function parseTextWithNER(text){
  const out = {
    senderName:'', senderCompany:'', senderAddress:'',
    recipientName:'', recipientCompany:'', recipientAddress:'',
    phone:'', postalCode:'', country:'',
    description:'', descriptionConfidence:0
  };
  if (!text) return out;
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const whole = lines.join('\n');

  // Phone (intl, allow spaces/dashes)
  const phoneMatch = whole.match(/(?:TEL|PHONE|聯絡電話|電話)\s*[:：]?\s*([+]?\d[\d\s\-()]{6,}\d)/i) || whole.match(/\b\+?\d[\d\s\-()]{6,}\d\b/);
  if (phoneMatch) out.phone = phoneMatch[1] ? phoneMatch[1].trim() : phoneMatch[0].trim();

  // Postal code (3–6 digits; TW often 3 or 5, US 5, etc.)
  const postalMatch = whole.match(/(?:POSTAL\s*CODE|ZIP|郵遞區號)\s*[:：]?\s*(\d{3,6})\b/i) || whole.match(/\b(\d{3,6})\b(?!.*\b(\d{3,6})\b)/);
  if (postalMatch) out.postalCode = postalMatch[1] || postalMatch[0];

  // Country detection (simple dictionary + ISO)
  const countryList = [
    'Taiwan','Republic of China','ROC','Taipei','Taiwan, Province of China','United States','USA','US','America','United Kingdom','UK','GB','Great Britain','China','PRC','Japan','JP','Korea','KR','South Korea','Republic of Korea','Canada','CA','Australia','AU','Germany','DE','France','FR','Italy','IT','Spain','ES','Netherlands','NL','Singapore','SG','Hong Kong','HK','Macao','Macau','MO'
  ];
  for (const c of countryList){
    const re = new RegExp(`(^|[^A-Za-z])${c.replace(/\s+/g,'\\s+')}([^A-Za-z]|$)`, 'i');
    if (re.test(whole)) { out.country = c; break; }
  }
  if (!out.country){
    const iso = whole.match(/\b(TW|US|UK|GB|CN|JP|KR|CA|AU|DE|FR|IT|ES|NL|SG|HK|MO)\b/);
    if (iso) out.country = iso[1];
  }

  // Identify sender/recipient blocks by cues (EN/ZH)
  const idxSender = lines.findIndex(l=>/(寄件人|發件人|Sender|From|Shipper|Consignor)/i.test(l));
  const idxRecipient = lines.findIndex(l=>/(收件人|收貨人|Recipient|To|Ship\s*-?\s*To|Consignee)/i.test(l));

  const sliceBlock = (startIdx) => {
    if (startIdx < 0) return [];
    const out = [];
    for (let i=startIdx+1;i<Math.min(lines.length, startIdx+8);i++){
      const s = lines[i];
      if (/(寄件人|發件人|Sender|From|Shipper|Consignor|收件人|收貨人|Recipient|To|Ship\s*-?\s*To|Consignee|Invoice|Description|Amount|重量|Weight|Pieces|件數)/i.test(s)) break;
      out.push(s);
    }
    return out;
  };

  const senderBlock = sliceBlock(idxSender);
  const recipientBlock = sliceBlock(idxRecipient);

  // Heuristics: first line likely name/company; subsequent lines address
  const parseNameAddr = (block) => {
    if (!block || !block.length) return { name:'', company:'', address:'' };
    const first = block[0];
    const second = block[1] || '';
    // If first line contains Co., Ltd., Inc., 公司, 股份, 有限, treat as company
    const isCompany = /(CO\.?|INC\.?|LTD\.?|LLC|有限公司|股份|公司|集團|CORP\.?)/i.test(first);
    const name = isCompany ? second : first;
    const company = isCompany ? first : '';
    const rest = isCompany ? block.slice(2) : block.slice(1);
    const address = rest.join('\n');
    return { name: (name||'').trim(), company: (company||'').trim(), address: address.trim() };
  };

  const sNA = parseNameAddr(senderBlock);
  const rNA = parseNameAddr(recipientBlock);
  out.senderName = sNA.name; out.senderCompany = sNA.company; out.senderAddress = sNA.address;
  out.recipientName = rNA.name; out.recipientCompany = rNA.company; out.recipientAddress = rNA.address;

  // If still missing, try generic address/name heuristics
  if (!out.recipientAddress){
    const cityZipLine = lines.find(l => /(CITY|TOWNSHIP|COUNTY|DISTRICT|VILLAGE|TOWN|CITY\s*\d{2}|[A-Z]{2,})\s+\d{3,6}(?:\s+[A-Z]{2})?$/i.test(l));
    if (cityZipLine){
      const idx = lines.indexOf(cityZipLine);
      const addrLines = [];
      if (lines[idx-1]) addrLines.unshift(lines[idx-1]);
      if (lines[idx-2]) addrLines.unshift(lines[idx-2]);
      out.recipientAddress = [...addrLines, cityZipLine].join('\n');
      const nm = lines[idx-3] || lines[idx-2];
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
  } catch(e){ /* best-effort; ignore */ }

  return out;
}

// --- Semantic shipment description extractor ---
// Best-effort, rule-based NP detection with scoring and safety threshold
function extractShipmentDescriptionSemantic(ctx){
  const text = (ctx?.text || '').trim();
  const lines = Array.isArray(ctx?.lines) ? ctx.lines : text.split(/\r?\n/).map(s=>s.trim());
  if (!text) return { value:'', confidence:0 };

  // Utility lexicons and helpers
  const GOODS_LEXICON = [
    'paperboard box','carton','box','documents','document','papers','commercial goods','merchandise','goods','electronics','electronic','device','devices','clothing sample','sample','samples','garment','clothing','accessories','accessory','parts','spare parts','gift','return','parcel','package','packages','watch','bag','bags','shoes','book','books','stationery','toy','toys','component','components'
  ];
  const QTY_CUES_RE = /\b(?:\d+[\d.,]*\s*)?(?:pcs?|pieces?|units?|unit|boxes|box|cartons?|ctn|pkg|packages?|set|sets|kg|g|lb|lbs)\b/i;
  const ADDRESS_CUES_RE = /(street|st\.?|road|rd\.?|avenue|ave\.?|blvd\.?|lane|ln\.?|drive|dr\.?|district|city|county|state|province|zip|postal|floor|fl\.|suite|ste\.|號|路|街|巷|弄|樓|市|區|鄉|鎮)/i;
  const NAME_CUES_RE = /(Mr\.?|Ms\.?|Mrs\.?|先生|小姐|公司|股份|有限公司|CO\.?|INC\.?|LTD\.?|LLC|CORP\.?)/i;
  const PHONE_RE = /\+?\d[\d\s\-()]{6,}\d/;
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

  // Build an exclude set of lines from sender/recipient blocks
  const excludeSet = new Set();
  const addToExclude = (arr)=>{ (arr||[]).forEach(s=>{ if (s) excludeSet.add(s.trim()); }); };
  if (ctx?.excludeBlocks){ addToExclude(ctx.excludeBlocks.sender); addToExclude(ctx.excludeBlocks.recipient); }

  // Generate candidates from lines by splitting at obvious labels and punctuation
  const candList = [];
  const pushCand = (value, lineIdx, origin) => {
    const v = (value||'').trim().replace(/^[-:•·*\s]+/, '').replace(/\s{2,}/g,' ');
    if (!v) return;
    // Very short (1 char) or extremely long (>80) are unlikely item names
    if (v.length < 2 || v.length > 80) return;
    // Filter out address-like, phone/email, and fields labels
    if (PHONE_RE.test(v) || EMAIL_RE.test(v)) return;
    if (/^(sender|from|shipper|to|recipient|consignee|address|addr|invoice|amount|weight|pieces|awb|tracking|trk)/i.test(v)) return;
    candList.push({ value: v, lineIdx, origin });
  };

  lines.forEach((ln, i)=>{
    const raw = (ln||'').trim();
    if (!raw) return;
    if (excludeSet.has(raw)) return;
    if (PHONE_RE.test(raw) || EMAIL_RE.test(raw)) return;
    // Ignore pure numeric or address-like lines
    if (/^\d{3,}$/.test(raw)) return;
    // Split by common delimiters or labels
    const cleaned = raw.replace(/\b(description|contents?|商品|品名|物品|貨品|內容)\b\s*[:：]/i, ' ');
    const parts = cleaned.split(/[\|,/;]+|\s{2,}/).map(s=>s.trim()).filter(Boolean);
    if (parts.length === 0) return;

    // If a part contains quantity cue, treat adjacent words as candidates first
    const qtyHit = QTY_CUES_RE.test(raw);
    if (qtyHit){
      // Try pattern like "2 pcs electronics" or "electronics 2 pcs"
      const m1 = raw.match(/\b(\d+[\d.,]*)\s*(pcs?|pieces?|units?|boxes?|cartons?|kg|g|lb|lbs)\b\s*([A-Za-z][\w \-]{1,60})/i);
      if (m1) pushCand(m1[3], i, 'qty-tail');
      const m2 = raw.match(/([A-Za-z][\w \-]{1,60})\s*\b(\d+[\d.,]*)\s*(pcs?|pieces?|units?|boxes?|cartons?|kg|g|lb|lbs)\b/i);
      if (m2) pushCand(m2[1], i, 'qty-head');
    }

    // General NP-like chunks: prefer 1–5 words, alphabetic or mixed
    parts.forEach(p=>{
      const words = p.split(/\s+/).filter(Boolean);
      if (words.length === 0 || words.length > 6) return;
      // Must contain at least one letter
      if (!/[A-Za-z\p{L}]/u.test(p)) return;
      pushCand(p, i, 'part');
    });
  });

  // Scoring
  const lowerText = text.toLowerCase();
  const scoreCand = (c)=>{
    let s = 1; // base
    const vLow = c.value.toLowerCase();
    // Lexicon boost
    if (GOODS_LEXICON.some(g => vLow.includes(g))) s += 2;
    // Quantity proximity boost: check current, previous, next two lines
    for (let d=-2; d<=2; d++){
      const li = c.lineIdx + d;
      if (li>=0 && li<lines.length && QTY_CUES_RE.test(lines[li]||'')) { s += (d===0?2:1); break; }
    }
    // Penalize address-like tokens
    if (ADDRESS_CUES_RE.test(c.value)) s -= 2;
    // Penalize name/company-like tokens
    if (NAME_CUES_RE.test(c.value)) s -= 1;
    // Prefer reasonable length 3–30
    if (c.value.length >= 3 && c.value.length <= 30) s += 1;
    // Avoid all-caps long strings (likely headings)
    if (c.value.length > 12 && c.value === c.value.toUpperCase()) s -= 1;
    return s;
  };

  let best = null;
  for (const c of candList){
    const sc = scoreCand(c);
    if (!best || sc > best.score) best = { ...c, score: sc };
  }
  if (!best || best.score < 3) return { value:'', confidence: best ? best.score : 0 };

  // Clean leading labels and units artifacts again
  let val = best.value.replace(/^(contents?|description|desc|品名|貨品|內容)\s*[:：\-]\s*/i, '').trim();
  val = val.replace(/\b(kg|g|lb|lbs|pcs?|pieces?|units?)\b/ig, '').replace(/\s{2,}/g,' ').trim();
  // Title-case mild normalization while preserving acronyms
  const title = val.split(' ').map(w=>{
    if (/^[A-Z0-9]{2,}$/.test(w)) return w; // keep acronyms
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
  return { value: title || val, confidence: best.score };
}

function fillFieldsFromEntities(ent){
  if (!ent) return;
  // Only auto-fill the allowed fields
  if (seller && (ent.senderCompany || ent.senderName)) seller.value = (ent.senderCompany || ent.senderName || '').trim();
  if (sellerAddr && ent.senderAddress) sellerAddr.value = ent.senderAddress;
  if (buyer && (ent.recipientCompany || ent.recipientName)) buyer.value = (ent.recipientCompany || ent.recipientName || '').trim();
  if (buyerAddr && ent.recipientAddress) buyerAddr.value = ent.recipientAddress;
  if (countryEl && ent.country) countryEl.value = ent.country;
  if (postalCodeEl && ent.postalCode) postalCodeEl.value = ent.postalCode;
  if (phoneEl && ent.phone) phoneEl.value = ent.phone;
  // Description: only fill when confident; do not overwrite non-empty user input
  if (desc && ent.description && (desc.value || '').trim() === '' && (ent.descriptionConfidence||0) >= 3) {
    desc.value = ent.description;
  }
}

// Wire NER button
if (btnRunNER && rawText){
  btnRunNER.addEventListener('click', () => {
    const text = (rawText.value||'').trim();
    if (!text){ setStatus('請先拍照或貼上文字，再執行 NER'); return; }
    const ent = parseTextWithNER(text);
    fillFieldsFromEntities(ent);
    setStatus('已完成智能帶入。請檢查欄位。');
  });
}

function _hidFlush(){
  if (!_hidBuffer) return;
  const text = _hidBuffer.trim();
  _hidBuffer = '';
  if (!text) return;
  try{
    if (barcodeStatus) barcodeStatus.textContent = `鍵盤掃碼：${text.slice(0,80)}${text.length>80?'…':''}`;
    applyDecodedResult(text);
  }catch(e){ console.error(e); }
}

function _hidOnKeydown(ev){
  if (!_hidActive) return;
  const k = ev.key;
  // 允許 Esc 清除緩衝
  if (k === 'Escape'){
    _hidBuffer = '';
    if (barcodeStatus) barcodeStatus.textContent = '鍵盤掃碼器：已清除';
    ev.preventDefault();
    return;
  }
  // Enter/Tab 作為掃碼結束
  if (k === 'Enter' || k === 'Tab'){
    ev.preventDefault();
    clearTimeout(_hidTimer); _hidTimer = null;
    _hidFlush();
    return;
  }
  // 忽略組合鍵與非可列印鍵
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  if (k.length !== 1) return;
  // 累積字元並阻止輸入到欄位
  ev.preventDefault();
  _hidBuffer += k;
  clearTimeout(_hidTimer);
  _hidTimer = setTimeout(_hidFlush, 220);
}

function setHidActive(on){
  const wantOn = !!on;
  if (wantOn === _hidActive) return;
  _hidActive = wantOn;
  try{
    if (_hidActive){
      window.addEventListener('keydown', _hidOnKeydown, { capture: true });
      if (barcodeStatus) barcodeStatus.textContent = '鍵盤掃碼器：已啟用（請在此頁直接掃碼）';
      if (btnHidToggle) btnHidToggle.textContent = '停用鍵盤掃碼器';
    } else {
      window.removeEventListener('keydown', _hidOnKeydown, { capture: true });
      if (barcodeStatus) barcodeStatus.textContent = '鍵盤掃碼器：已停用';
      if (btnHidToggle) btnHidToggle.textContent = '啟用鍵盤掃碼器';
      clearTimeout(_hidTimer); _hidTimer = null; _hidBuffer = '';
    }
  }catch(e){ console.error(e); }
}

// Some ZXing UMD builds may not include the static helper
// BrowserMultiFormatReader.listVideoInputDevices(). To avoid
// runtime errors, we rely on the Web MediaDevices API directly.
async function listVideoInputDevicesCompat(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  }catch{
    return [];
  }
}

function stopBarcodeScan(){
  try{
    _scanActive = false;
    if (_codeReader && _codeReader.reset) _codeReader.reset();
  }catch{}
  try{
    if (barcodeVideo) {
      const stream = barcodeVideo.srcObject;
      if (stream && stream.getTracks) stream.getTracks().forEach(t=>t.stop());
      barcodeVideo.srcObject = null;
      barcodeVideo.style.display = 'none';
    }
  }catch{}
  if (barcodeStatus) barcodeStatus.textContent = '';
}

function parseBarcodePayload(text){
  const out = {};
  if (!text) return out;
  // 1) 先嘗試 AWB（12–14 位數字）
  const awbMatch = (text.replace(/\D/g,'').match(/\d{12,14}/)||[])[0];
  if (awbMatch) out.awb = awbMatch;
  // 2) 嘗試簡單鍵值對（適用部分 2D 條碼）
  // 例：TO:..., FROM:..., DESC:..., VALUE:..., WT:...
  const lines = text.split(/\r?\n|\|/).map(s=>s.trim()).filter(Boolean);
  for (const ln of lines){
    const m = ln.match(/^([A-Z]{2,10})\s*[:=]\s*(.+)$/i);
    if (!m) continue;
    const k = m[1].toUpperCase();
    const v = m[2].trim();
    if (k==='TRK' || k==='AWB' || k==='TRACK' || k==='TRACKING') out.awb = v.replace(/\D/g,'');
    if (k==='TO' || k==='RCPT' || k==='RECIPIENT') out.buyer = v;
    if (k==='TOADDR' || k==='TO_ADDRESS' || k==='ADDR' || k==='ADDRESS') out.buyerAddr = v;
    if (k==='FROM' || k==='SENDER') out.seller = v;
    if (k==='FROMADDR' || k==='SENDERADDR') out.sellerAddr = v;
    if (k==='DESC' || k==='DESCRIPTION') out.desc = v;
    if (k==='VALUE' || k==='AMOUNT') out.amount = (v.match(/[\d,.]+/)||[''])[0].replace(/,/g,'');
    if (k==='WT' || k==='WEIGHT') out.weight = v;
    if (k==='DATE' || k==='SHIPDATE') {
      // 允許各式日期，交由 normalizeDateLike 處理
      const norm = normalizeDateLike(v);
      if (norm) out.date = norm;
    }
  }
  return out;
}

// 嘗試解析 FedEx PDF417（或 DataMatrix）常見內容（含 raw bytes）
// 目標：盡力取出 TRK/AWB 與 收/寄件人姓名與地址（城市/郵遞區號/國別）
function parseFedExPdf417(rawBytes, text){
  const out = {};
  try{
    // 1) 以文字層快速抓 AWB
    const txt = text || '';
    const awb = (txt.replace(/\D/g,'').match(/\d{12,14}/)||[])[0];
    if (awb) out.awb = awb;

    // 2) 將 raw bytes 轉換為「可見字串」，以 GS/RS 作為分隔符
    let parts = [];
    if (rawBytes && rawBytes.length){
      let s = '';
      for (let i=0;i<rawBytes.length;i++){
        const b = rawBytes[i];
        if (b===0x1D || b===0x1E || b===10 || b===13){ // GS/RS/LF/CR → 區段斷行
          s += '\n';
        } else if (b>=32 && b<=126){
          s += String.fromCharCode(b);
        } else {
          // 其他控制字元以空白代替
          s += ' ';
        }
      }
      parts = s.split(/\n+/).map(v=>v.trim()).filter(Boolean);
    } else {
      // fallback：用可見文字切片
      parts = (txt||'').split(/\r?\n|\|/).map(v=>v.trim()).filter(Boolean);
    }

    // 3) 從所有片段再找 12–14 位數字（補捉 AWB）
    if (!out.awb){
      for (const p of parts){
        const m = (p.replace(/\D/g,'').match(/\d{12,14}/)||[])[0];
        if (m){ out.awb = m; break; }
      }
    }

    // 4) 嘗試找「收件人（TO）」與地址：
    //    以「城市 + 郵遞區號 + 國別（可選）」樣式作為錨點，往前 1–3 行當地址/姓名
    const cityZipIdx = parts.findIndex(p=>/(?:CITY|TOWNSHIP|COUNTY|DISTRICT|VILLAGE|TOWN|CITY\s*\d{2}|[A-Z]{2,})\s+\d{3,6}(?:\s+[A-Z]{2})?$/.test(p));
    if (cityZipIdx>=0){
      // 城市/郵遞區號行
      const cz = parts[cityZipIdx];
      const addrLines = [];
      if (parts[cityZipIdx-1]) addrLines.unshift(parts[cityZipIdx-1]);
      if (parts[cityZipIdx-2]) addrLines.unshift(parts[cityZipIdx-2]);
      out.buyerAddr = [...addrLines, cz].join('\n');
      // 嘗試把更靠前的一行當作姓名/機構
      const nameLine = parts[cityZipIdx-3] || parts[cityZipIdx-2];
      if (nameLine && /[A-Za-z]/.test(nameLine)) out.buyer = nameLine;
    }

    // 5) 嘗試找寄件人（ORIGIN/SENDER）區塊：
    //    以常見關鍵詞 ORIGIN/SHIPPER/SENDER/FRM 標記的前後片段推測
    const idxSender = parts.findIndex(p=>/ORIGIN|SHIPPER|SENDER|FROM/i.test(p));
    if (idxSender>=0){
      const slice = parts.slice(Math.max(0, idxSender), Math.min(parts.length, idxSender+5));
      // 取切片中前 1–3 行作為姓名/地址
      if (!out.seller && slice[1]) out.seller = slice[1];
      if (!out.sellerAddr){
        const addrCand = slice.slice(2).join('\n');
        if (addrCand) out.sellerAddr = addrCand;
      }
    }

    return out;
  }catch(e){
    return out;
  }
}

async function startBarcodeScan(deviceIdOverride){
  // 基本環境檢查（HTTPS/localhost + 相機 API）
  const secure = (window.isSecureContext === true) || /^https:/i.test(location.protocol) || /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
  if (!secure){
    const msg = '此功能需要在 https 或 localhost 環境執行，請改以 https 網址開啟本頁（或使用 GitHub Pages 連結）。';
    if (barcodeStatus) barcodeStatus.textContent = msg;
    alert(msg);
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    const msg = '此瀏覽器不支援相機 API（getUserMedia）。請改用 Chrome / Edge / Safari 最新版，或檢查網站相機權限。';
    if (barcodeStatus) barcodeStatus.textContent = msg;
    alert(msg);
    return;
  }

  if (!window.ZXing || !ZXing.BrowserMultiFormatReader) {
    alert('尚未載入條碼掃描元件，請檢查網路或稍後再試。');
    return;
  }
  if (_scanActive) return;
  _scanActive = true;
  if (barcodeStatus) barcodeStatus.textContent = '啟用相機中…';
  if (barcodeVideo) barcodeVideo.style.display = 'block';
  if (!_codeReader) _codeReader = new ZXing.BrowserMultiFormatReader();

  try {
    // 先請求一次權限（可提早觸發權限提示）
    try { await navigator.mediaDevices.getUserMedia({ video: true }); } catch(_e) { /* 若使用者拒絕，後續會在 decode 流程顯示錯誤 */ }

    // Prefer native enumerateDevices for compatibility across ZXing builds
    // 重新列舉裝置（授權後 label 會出現）
    _videoDevices = await listVideoInputDevicesCompat();
    if (!_videoDevices || _videoDevices.length===0){
      const msg = '找不到可用的相機裝置（可能被其他 App 佔用，或此裝置無相機）。';
      if (barcodeStatus) barcodeStatus.textContent = msg;
      alert(msg);
      _scanActive = false;
      return;
    }
    // 嘗試選擇後鏡頭（label 含 back/environment），或沿用 override/已選擇裝置
    let deviceId = deviceIdOverride || _selectedDeviceId;
    if (!deviceId){
      const back = _videoDevices.find(d=>/back|environment/i.test(d.label||''));
      deviceId = back ? back.deviceId : _videoDevices[0]?.deviceId;
      _deviceIndex = Math.max(0, _videoDevices.findIndex(d=>d.deviceId===deviceId));
    } else {
      const idx = _videoDevices.findIndex(d=>d.deviceId===deviceId);
      _deviceIndex = idx >= 0 ? idx : 0;
    }
    _selectedDeviceId = deviceId;
    if (barcodeStatus){
      const label = _videoDevices[_deviceIndex]?.label || `camera#${_deviceIndex+1}`;
      barcodeStatus.textContent = `啟用相機中…（${label}，共 ${_videoDevices.length} 台）`;
    }

    // 限定常見格式，降低誤判與提升速度
    const hints = new Map();
    const formats = [
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.ITF,
      ZXing.BarcodeFormat.QR_CODE,
      ZXing.BarcodeFormat.DATA_MATRIX,
      ZXing.BarcodeFormat.PDF_417,
    ];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
    _codeReader = new ZXing.BrowserMultiFormatReader(hints);

    _codeReader.decodeFromVideoDevice(deviceId, barcodeVideo, (result, err) => {
      if (!_scanActive) return;
      if (result) {
        const text = result.getText();
        if (barcodeStatus) barcodeStatus.textContent = `解碼成功：${text.slice(0,80)}${text.length>80?'…':''}`;
        applyDecodedResult(result);
      } else if (err && !(err instanceof ZXing.NotFoundException)) {
        if (barcodeStatus) barcodeStatus.textContent = `解碼中…（${err?.name||'等待'}）`;
      } else {
        if (barcodeStatus) barcodeStatus.textContent = '對準條碼/二維碼…';
      }
    });
  } catch (e){
    console.error(e);
    if (barcodeStatus) barcodeStatus.textContent = `掃描初始化失敗：${e?.message||e}`;
    stopBarcodeScan();
  }
}

if (btnScanStart) btnScanStart.addEventListener('click', startBarcodeScan);
if (btnScanStop) btnScanStop.addEventListener('click', stopBarcodeScan);
if (btnSwitchCamera) {
  btnSwitchCamera.addEventListener('click', async () => {
    try{
      // 停止目前串流
      stopBarcodeScan();
      // 循環下一個裝置
      if (!_videoDevices || _videoDevices.length===0) _videoDevices = await listVideoInputDevicesCompat();
      if (!_videoDevices || _videoDevices.length===0){
        alert('尚未取得相機裝置清單');
        return;
      }
      _deviceIndex = (_deviceIndex + 1) % _videoDevices.length;
      _selectedDeviceId = _videoDevices[_deviceIndex].deviceId;
      if (barcodeStatus){
        const label = _videoDevices[_deviceIndex].label || `camera#${_deviceIndex+1}`;
        barcodeStatus.textContent = `切換鏡頭：${label}`;
      }
      await startBarcodeScan(_selectedDeviceId);
    }catch(e){
      console.error(e);
      if (barcodeStatus) barcodeStatus.textContent = `切換鏡頭失敗：${e?.message||e}`;
    }
  });
}

// 通用的解碼結果處理：解析欄位並帶入
function applyDecodedResult(result){
  try{
    const text = typeof result === 'string' ? result : (result?.getText ? result.getText() : '');
    const raw = (result && typeof result.getRawBytes==='function') ? result.getRawBytes() : null;
    // 先用一般鍵值/數字規則，再用 FedEx PDF417 解析器補強
    const parsed = Object.assign({}, parseBarcodePayload(text), parseFedExPdf417(raw, text));
    if (parsed.awb) awb.value = parsed.awb;
    if (parsed.date) dateEl.value = parsed.date;
    if (parsed.seller) seller.value = parsed.seller;
    if (parsed.sellerAddr) sellerAddr.value = parsed.sellerAddr;
    if (parsed.buyer) buyer.value = parsed.buyer;
    if (parsed.buyerAddr) buyerAddr.value = parsed.buyerAddr;
    if (parsed.desc) desc.value = parsed.desc.replace(/^\d+\s*[:\-]\s*/,'');
    if (parsed.amount) amount.value = parsed.amount;
    if (parsed.weight) weight.value = parsed.weight;
    if (_scanDebug && barcodeStatus){
      const hex = raw && raw.length ? Array.from(raw).slice(0,64).map(b=>b.toString(16).padStart(2,'0')).join(' ') : 'n/a';
      barcodeStatus.textContent += `\n[debug] bytes: ${raw?raw.length:0}, hex(64): ${hex}`;
      barcodeStatus.textContent += `\n[parsed] AWB=${parsed.awb||''} | buyer=${parsed.buyer||''} | buyerAddr=${(parsed.buyerAddr||'').replace(/\n/g,' / ')} | seller=${parsed.seller||''}`;
    }
    if (parsed.awb && barcodeStatus){
      barcodeStatus.textContent = `已帶入 AWB：${parsed.awb}`;
    }
    return parsed;
  }catch(e){
    console.error(e);
    if (barcodeStatus) barcodeStatus.textContent = `結果處理失敗：${e?.message||e}`;
  }
}

// 從相片解碼（單張圖）
async function decodeFromImageFile(file){
  if (!file) return;
  if (!window.ZXing || !ZXing.BrowserMultiFormatReader){
    alert('尚未載入條碼掃描元件，請檢查網路或稍後再試。');
    return;
  }
  try{
    const reader = new FileReader();
    const dataUrl = await new Promise((res, rej)=>{
      reader.onerror = () => rej(reader.error||new Error('讀取圖片失敗'));
      reader.onload = () => res(reader.result);
      reader.readAsDataURL(file);
    });
    const img = new Image();
    await new Promise((res, rej)=>{
      img.onload = () => res(true);
      img.onerror = () => rej(new Error('載入圖片失敗'));
      img.src = dataUrl;
    });
    if (barcodeStatus) barcodeStatus.textContent = '從相片解碼中…';
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.ITF,
      ZXing.BarcodeFormat.QR_CODE,
      ZXing.BarcodeFormat.DATA_MATRIX,
      ZXing.BarcodeFormat.PDF_417,
    ]);
    const reader2 = new ZXing.BrowserMultiFormatReader(hints);
    const result = await reader2.decodeFromImage(img);
    if (result){
      if (barcodeStatus) barcodeStatus.textContent = `從相片解碼成功：${result.getText().slice(0,80)}${result.getText().length>80?'…':''}`;
      applyDecodedResult(result);
    } else {
      if (barcodeStatus) barcodeStatus.textContent = '未能從相片解出條碼';
    }
  }catch(e){
    console.error(e);
    if (barcodeStatus) barcodeStatus.textContent = `從相片解碼失敗：${e?.message||e}`;
  }
}

if (btnDecodeImage && imgDecodeInput){
  btnDecodeImage.addEventListener('click', ()=>{
    try{ imgDecodeInput.click(); }catch{}
  });
  imgDecodeInput.addEventListener('change', (ev)=>{
    const f = ev.target?.files?.[0];
    if (f) decodeFromImageFile(f);
    imgDecodeInput.value = '';
  });
}

// HID 掃碼器開關
if (btnHidToggle){
  btnHidToggle.addEventListener('click', ()=>{
    setHidActive(!_hidActive);
  });
}

// 已取消 OCR：僅在舊連結仍帶有按鈕時避免報錯
if (btnOcr) {
  btnOcr.addEventListener("click", () => {
    alert('已取消 OCR。請改用「條碼/二維碼掃描」或手動輸入欄位。');
  });
}

// Core OCR runner with robust worker initialization and diagnostics
async function runOcr(source, opts={}){
  // 自訂語言（預設 eng；可用 ?lang=eng+chi_tra 覆寫）
  const qsLang = new URLSearchParams(location.search);
  const LANGS = (qsLang.get('lang') || 'eng').trim();
  // 明確指定 Tesseract 各組件路徑，避免在 PWA/行動裝置上載入失敗
  const t5 = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist';
  // 多鏡像來源（主用 jsDelivr → 次用 unpkg；語言包提供 jsDelivr 的 naptha/tessdata 鏡像）
  const MIRRORS = {
    workerPath: [
      `${t5}/worker.min.js`,
      'https://unpkg.com/tesseract.js@5/dist/worker.min.js'
    ],
    corePath: [
      'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
      'https://unpkg.com/tesseract.js-core@5.0.0/tesseract-core.wasm.js'
    ],
    langPath: [
      // 優先選擇提供 .traineddata.gz 的來源（符合 tesseract.js v5 預期）
      'https://tessdata.projectnaptha.com/4.0.0',
      'https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0',
      // 次選（GitHub raw 多為未壓縮 .traineddata，通常不適用於 v5 預設的 .gz 下載）
      'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.0.0',
      'https://raw.githubusercontent.com/tesseract-ocr/tessdata/4.0.0',
      'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/4.0.0'
    ]
  };

  // 目前選用的路徑（可被鏡像切換覆寫）
  const paths = {
    workerPath: MIRRORS.workerPath[0],
    corePath: MIRRORS.corePath[0],
    langPath: MIRRORS.langPath[0],
  };

  // 小工具：加上逾時保護，避免永久卡住
  const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 逾時（>${ms}ms）`)), ms))
  ]);

  // 小工具：快速探測某 URL 可否連通（先 HEAD，不行再 GET，並加入重試）
  const probe = async (url, ms = 6000, attempts = 2) => {
    const tryOnce = async (timeoutMs) => {
      // 1) HEAD（較省流量，但某些 CDN/防火牆會擋）
      try {
        const ctrl = new AbortController();
        const id = setTimeout(()=>ctrl.abort(), timeoutMs);
        const resp = await fetch(url, { method: 'HEAD', mode: 'cors', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
        clearTimeout(id);
        if (resp.ok) return true;
      } catch {}
      // 2) GET（允許 3xx → 200，並快速中止）
      try {
        const ctrl2 = new AbortController();
        const id2 = setTimeout(()=>ctrl2.abort(), Math.max(2000, Math.floor(timeoutMs*0.8)));
        const resp2 = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store', redirect: 'follow', signal: ctrl2.signal });
        clearTimeout(id2);
        return resp2.ok;
      } catch {}
      return false;
    };
    for (let i=0;i<attempts;i++){
      const ok = await tryOnce(ms + i*1500); // 簡單 backoff
      if (ok) return true;
    }
    return false;
  };

  // 於初始化前先測試可用性，失敗則嘗試鏡像
  const ensureAccessible = async () => {
    const qs = new URLSearchParams(location.search);
    const localLang = qs.get('localLang') === '1';
    const explicitLangPath = qs.get('langPath'); // 允許直接指定完整 base URL

    // 將任意（相對/絕對）路徑正規化為相對當前頁面的「絕對 URL」，避免在 Worker 內被當作相對 worker 的路徑
    const makeAbs = (u) => {
      try {
        // 若已是絕對 URL，new URL 會直接回傳；若是相對，會以 location.href 作為 base
        return new URL(u, location.href).toString().replace(/\/$/, '');
      } catch {
        try { return new URL(String(u||''), location.href).toString().replace(/\/$/, ''); } catch { return String(u||''); }
      }
    };

    // 測 core wasm
    let ok = await probe(paths.corePath);
    if (!ok){
      for (const alt of MIRRORS.corePath){
        if (alt === paths.corePath) continue;
        ocrStatus.textContent = `OCR 核心連線不穩，切換鏡像來源（core）…\n→ 嘗試：${alt}`;
        if (await probe(alt)) { paths.corePath = alt; ocrStatus.textContent = `已切換核心來源：${alt}`; break; }
      }
    }
    // 測 worker
    ok = await probe(paths.workerPath);
    if (!ok){
      for (const alt of MIRRORS.workerPath){
        if (alt === paths.workerPath) continue;
        ocrStatus.textContent = `OCR 元件連線不穩，切換鏡像來源（worker）…\n→ 嘗試：${alt}`;
        if (await probe(alt)) { paths.workerPath = alt; ocrStatus.textContent = `已切換 worker 來源：${alt}`; break; }
      }
    }
    // 準備語言包候選清單
    const langCandidates = [];
    if (explicitLangPath) langCandidates.push(makeAbs(explicitLangPath));
    if (localLang) langCandidates.push(makeAbs('./assets/tessdata'));
    // 既有路徑先檢查（正規化為絕對 URL）
    langCandidates.push(makeAbs(paths.langPath));
    for (const m of MIRRORS.langPath){
      const abs = makeAbs(m);
      if (!langCandidates.includes(abs)) langCandidates.push(abs);
    }

    // 逐一探測語言包（eng）並切換
    // 規則：同源（您的站台）優先嘗試未壓縮 raw，再嘗試 .gz；跨網域則維持先 .gz 後 raw 的策略
    let chosen = null;
    let useGz = true;
    for (const base of langCandidates){
      const baseTrim = base.replace(/\/$/, '');
      let isLocal = false;
      try { isLocal = new URL(baseTrim).origin === location.origin; } catch { isLocal = false; }

      if (isLocal){
        // 同源：先試 raw，再試 gz（某些環境對 .gz 有特殊處理會導致卡住）
        const rawUrl = `${baseTrim}/eng.traineddata`;
        ocrStatus.textContent = `語言資料來源測試（raw，同源優先）…\n→ 嘗試：${rawUrl}`;
        ok = await probe(rawUrl, 7000, 2);
        if (ok){ chosen = baseTrim; useGz = false; break; }

        const gzUrl = `${baseTrim}/eng.traineddata.gz`;
        ocrStatus.textContent = `語言資料來源測試（gz）…\n→ 嘗試：${gzUrl}`;
        ok = await probe(gzUrl, 7000, 2);
        if (ok){ chosen = baseTrim; useGz = true; break; }
      } else {
        // 跨網域：先試 gz，再退 raw
        const gzUrl = `${baseTrim}/eng.traineddata.gz`;
        ocrStatus.textContent = `語言資料來源測試（gz）…\n→ 嘗試：${gzUrl}`;
        ok = await probe(gzUrl, 7000, 2);
        if (ok){ chosen = baseTrim; useGz = true; break; }

        const rawUrl = `${baseTrim}/eng.traineddata`;
        ocrStatus.textContent = `語言資料來源測試（raw）…\n→ 嘗試：${rawUrl}`;
        ok = await probe(rawUrl, 7000, 2);
        if (ok){ chosen = baseTrim; useGz = false; break; }
      }
    }
    if (chosen){
      // 重要：傳入 worker 的 langPath 一律使用絕對 URL，避免在 worker 端被誤解為相對於 worker 的路徑
      paths.langPath = chosen;
      paths.langGz = useGz;
      const suffix = useGz ? 'eng.traineddata.gz' : 'eng.traineddata';
      ocrStatus.textContent = `語言資料來源：${chosen}\n將下載：${chosen}/${suffix}`;

      // 預抓取語言檔（短逾時），若失敗且為同源且目前是 .gz，則改為 raw
      const preflight = async (url)=>{
        try{
          const ctrl = new AbortController();
          const id = setTimeout(()=>ctrl.abort(), 10000);
          const r = await fetch(url, { method:'GET', cache:'no-store', redirect:'follow', signal: ctrl.signal });
          clearTimeout(id);
          return r.ok;
        }catch{ return false; }
      };
      let okPre = await preflight(`${chosen}/${suffix}`);
      let isLocalOrigin=false; try{ isLocalOrigin = new URL(chosen).origin===location.origin; }catch{}
      if (!okPre && isLocalOrigin && useGz){
        const alt = `${chosen}/eng.traineddata`;
        ocrStatus.textContent = `語言資料（.gz）預抓取失敗，嘗試未壓縮：${alt}`;
        okPre = await preflight(alt);
        if (okPre){
          paths.langGz = false;
          ocrStatus.textContent = `語言資料來源：${chosen}\n將下載：${chosen}/eng.traineddata`;
        }
      }
    } else {
      // 所有鏡像皆不可達
      ocrStatus.textContent = '語言資料（eng）所有鏡像皆不可達，請確認網路或改用同源方案：在網址加上 ?localLang=1 並將 eng.traineddata.gz（或 eng.traineddata）置於 /assets/tessdata/';
    }
  };

  // 兼容不同打包輸出（部分環境 Tesseract 掛在 default）
  const T = (window.Tesseract && (window.Tesseract.default || window.Tesseract)) || undefined;
  const ver = (T && (T.version || T.default?.version)) || (window.Tesseract && window.Tesseract.version) || '';
  ocrStatus.textContent = `載入 OCR 元件…${ver ? ` (tesseract.js ${ver})` : ''}`;

  // 若用戶要求跳過 worker，改用快速路徑（非持久 worker）
  const qs2 = new URLSearchParams(location.search);
  const forceNoWorker = qs2.get('noWorker') === '1';
  if (forceNoWorker){
    const T = (window.Tesseract && (window.Tesseract.default || window.Tesseract)) || undefined;
    if (!T) throw new Error('找不到 Tesseract 物件');
    await ensureAccessible();
    const recognize = (T.recognize || T.default?.recognize).bind(T);
    ocrStatus.textContent = '使用快速路徑（無 worker）…';
    const { data } = await withTimeout(recognize(source, LANGS, {
      workerPath: paths.workerPath,
      corePath: paths.corePath,
      langPath: paths.langPath,
      gzip: paths.langGz!==false,
      logger: m => {
        if (m.status === 'recognizing text') {
          ocrProgress.value = m.progress || 0;
          ocrStatus.textContent = `辨識中… ${(m.progress*100).toFixed(0)}%`;
        }
      }
    }), 45000, '快速辨識');
    return { text: data.text || '', confidence: data.confidence };
  }

  // 嘗試以 worker 模式執行（效能較佳）
  try {
    // 預檢可連性，避免後續無限等待
    await ensureAccessible();
    const createWorker = T && (T.createWorker || T.default?.createWorker);
    if (!createWorker) throw new Error('Tesseract.createWorker 不存在');

    // 以探測結果決定是否停用 gzip（同源且只提供未壓縮檔時）
    const isLocalOrigin = (()=>{ try{ return new URL(paths.langPath).origin === location.origin; }catch{ return false; } })();
    const workerOptsBase = {
      workerPath: paths.workerPath,
      corePath: paths.corePath,
      langPath: paths.langPath,
      // 傳遞 logger 以更新進度條（可選）
      logger: (m)=>{
        try{
          if (m && m.progress!=null) ocrProgress.value = m.progress;
        }catch{}
      }
    };

    const buildWorkerOpts = (useGzip)=> ({
      ...workerOptsBase,
      ...(useGzip===false ? { gzip: false } : {})
    });

    let worker = createWorker.call(T, buildWorkerOpts(paths.langGz!==false));
    // 某些版本會回傳 Promise
    if (worker && typeof worker.then === 'function') worker = await worker;
    if (!worker || typeof worker.load !== 'function') {
      throw new Error('worker.load 不是函式，可能載入了不匹配的 tesseract.min.js（快取未更新）');
    }

    await withTimeout(worker.load(), 15000, '載入 OCR Worker');
    const tryLoadLanguage = async (gzipMode) => {
      const suffix = gzipMode===false ? 'eng.traineddata' : 'eng.traineddata.gz';
      ocrStatus.textContent = `下載語言資料（${LANGS}）…\n來源：${paths.langPath.replace(/\/$/, '')}/${suffix}\n提示：best 模型較大，首次可能需 30–60 秒`;
      const langTimeout = (isLocalOrigin && gzipMode===false) ? 60000 : 30000;
      await withTimeout(worker.loadLanguage(LANGS), langTimeout, '下載語言資料');
    };

    try {
      await tryLoadLanguage(paths.langGz!==false);
    } catch (e) {
      // 若同源且目前為 .gz 模式，嘗試改用未壓縮檔（gzip:false）重試一次
      const msg = (e && (e.message||e.toString()))||'';
      const canFallbackToRaw = isLocalOrigin && (paths.langGz!==false);
      if (canFallbackToRaw){
        ocrStatus.textContent = `下載語言資料（.gz）失敗，改用未壓縮檔重試…\n原因：${msg}`;
        try { if (worker && worker.terminate) await worker.terminate(); } catch {}
        worker = createWorker.call(T, buildWorkerOpts(false));
        if (worker && typeof worker.then === 'function') worker = await worker;
        await withTimeout(worker.load(), 15000, '載入 OCR Worker（raw）');
        await tryLoadLanguage(false);
      } else {
        throw e;
      }
    }
    await withTimeout(worker.initialize(LANGS), 10000, `初始化語言（${LANGS}）`);
    // OCR 參數微調：
    // - tessedit_pageseg_mode（PSM）：可由各欄位覆寫
    // - preserve_interword_spaces：保留單字間空白，避免黏字導致錯置
    // - user_defined_dpi：提升低解析度相片的內部 DPI 假設
    // - tessedit_char_whitelist/blacklist：針對欄位限定字元，降低誤辨
    if (opts.psm) await worker.setParameters({ tessedit_pageseg_mode: String(opts.psm) });
    await worker.setParameters({ preserve_interword_spaces: '1' });
    await worker.setParameters({ user_defined_dpi: '300' });
    if (opts.whitelist) await worker.setParameters({ tessedit_char_whitelist: opts.whitelist });
    if (opts.blacklist) await worker.setParameters({ tessedit_char_blacklist: opts.blacklist });

    const { data } = await worker.recognize(source, {
      logger: m => {
        if (m.status === 'recognizing text') {
          ocrProgress.value = m.progress || 0;
          ocrStatus.textContent = `辨識中… ${(m.progress*100).toFixed(0)}%`;
        }
      }
    });
    await worker.terminate();
    return { text: data.text || '', confidence: data.confidence };
  } catch (initErr) {
    // 記錄並嘗試降級為單次 recognize（非持久 worker），以提升容錯率
    console.warn('[OCR] Worker 初始化失敗，改用單次 recognize：', initErr);
    ocrStatus.textContent = 'OCR Worker 初始化失敗，改用快速路徑…';
    if (!T || typeof (T.recognize || T.default?.recognize) !== 'function') {
      throw initErr; // 無法降級，只能把錯拋出給上層處理
    }
    const recognize = (T.recognize || T.default?.recognize).bind(T);
    // 再次確保鏡像切換已完成
    await ensureAccessible();
    const { data } = await withTimeout(
      recognize(source, LANGS, {
        ...paths,
        logger: m => {
          if (m.status === 'recognizing text') {
            ocrProgress.value = m.progress || 0;
            ocrStatus.textContent = `辨識中… ${(m.progress*100).toFixed(0)}%`;
          }
        }
      }),
      40000,
      '快速辨識'
    );
    return { text: data.text || '', confidence: data.confidence };
  }
}

// Canvas helpers: load image to canvas
function loadImageToCanvas(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // scale to target max side for better OCR
      const maxSide = 2200;
      let { width, height } = img;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ canvas, ctx });
    };
    img.onerror = reject;
    img.crossOrigin = 'anonymous';
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
}

function enhanceCanvas(canvas){
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0,0,canvas.width, canvas.height);
  const d = imgData.data;
  // grayscale + contrast + simple threshold
  // contrast factor: 1.25
  const contrast = 1.25;
  for (let i=0;i<d.length;i+=4){
    let r=d[i], g=d[i+1], b=d[i+2];
    let y = 0.299*r + 0.587*g + 0.114*b; // luma
    // simple contrast adjustment around 128
    y = (y-128)*contrast + 128;
    // normalize
    if (y<0) y=0; if (y>255) y=255;
    d[i]=d[i+1]=d[i+2]=y;
  }
  // Otsu-like simple threshold by sampling histogram
  const hist = new Array(256).fill(0);
  for (let i=0;i<d.length;i+=4){ hist[d[i]]++; }
  let total = canvas.width * canvas.height;
  let sum = 0; for (let t=0;t<256;t++) sum += t*hist[t];
  let sumB=0, wB=0, wF=0, mB=0, mF=0, maxVar=0, threshold=128;
  for (let t=0;t<256;t++){
    wB += hist[t]; if (wB===0) continue;
    wF = total - wB; if (wF===0) break;
    sumB += t*hist[t];
    mB = sumB / wB; mF = (sum - sumB) / wF;
    const between = wB*wF*(mB-mF)*(mB-mF);
    if (between > maxVar){ maxVar = between; threshold = t; }
  }
  for (let i=0;i<d.length;i+=4){
    const v = d[i] >= threshold ? 255 : 0;
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(imgData,0,0);
  return canvas;
}

function rotateCanvas(canvas, deg){
  const rad = deg * Math.PI/180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const w = canvas.width, h=canvas.height;
  const newW = Math.round(w*cos + h*sin);
  const newH = Math.round(w*sin + h*cos);
  const out = document.createElement('canvas');
  out.width = newW; out.height = newH;
  const ctx = out.getContext('2d');
  ctx.translate(newW/2, newH/2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -w/2, -h/2);
  return out;
}

// ==== 分區（Zonal）OCR 支援：依固定 ROI 擷取關鍵欄位 ====
// ROI 以百分比定義（相對整張圖）：{ x, y, w, h }，單位 0–100
const ZONAL_ROIS = {
  // 高可靠
  awb:   { x: 7,  y: 54, w: 60, h: 6,  psm: 7, whitelist: '0123456789 ' },
  ship:  { x: 62, y: 6,  w: 30, h: 8,  psm: 7 }, // SHIP DATE / ACT WGT 同框
  toBlk: { x: 6,  y: 19, w: 70, h: 22, psm: 6 },
  desc1: { x: 7,  y: 63, w: 50, h: 14, psm: 6 },
  customs:{x: 7,  y: 79, w: 46, h: 7,  psm: 6 },
  // 低可靠（寄件人）
  origin:{ x: 5,  y: 5,  w: 46, h: 14, psm: 6 }
};

// 將百分比 ROI 轉為實際像素並裁切
async function cropRoiToDataURL(src, roi){
  const { canvas } = await loadImageToCanvas(src);
  const w = canvas.width, h = canvas.height;
  const rx = Math.round((roi.x/100) * w);
  const ry = Math.round((roi.y/100) * h);
  const rw = Math.round((roi.w/100) * w);
  const rh = Math.round((roi.h/100) * h);
  const out = document.createElement('canvas');
  out.width = rw; out.height = rh;
  const ctx = out.getContext('2d');
  ctx.drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);
  return { url: out.toDataURL('image/png'), rect: { x: rx, y: ry, w: rw, h: rh }, base: { w, h } };
}

function normalizeDateLike(s){
  if (!s) return '';
  // YYYY-MM-DD / YYYY/MM/DD
  let m = s.match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
  if (m){ const pad=n=>String(n).padStart(2,'0'); return `${m[1]}-${pad(m[2])}-${pad(m[3])}`; }
  // DD-MMM-YY / 13NOV25
  m = s.match(/\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(\d{2,4})\b/i);
  if (m){
    const d = parseInt(m[1],10);
    const mon = m[2].toUpperCase().slice(0,3);
    const months = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
    const mm = months[mon]||1; let yy = parseInt(m[3],10); if (yy<100) yy = yy<=50?2000+yy:1900+yy;
    const pad=n=>String(n).padStart(2,'0'); return `${yy}-${pad(mm)}-${pad(d)}`;
  }
  return '';
}

function extractAmountUSD(s){
  // 常見樣式：
  //  - CUSTOMS VALUE: $123.45
  //  - USD 123.45 / 123.45 USD
  //  - TOTAL / AMOUNT 欄位內的數字
  let m = s.match(/CUSTOMS\s*VALUE[:\s]*\$?\s*([\d,]+(?:\.[\d]{1,2})?)/i)
       || s.match(/USD\s*\$?\s*([\d,]+(?:\.[\d]{1,2})?)/i)
       || s.match(/\$\s*([\d,]+(?:\.[\d]{1,2})?)/)
       || s.match(/([\d,]+(?:\.[\d]{1,2})?)\s*USD/i)
       || s.match(/(?:TOTAL|AMOUNT|VALUE)[^\d]*([\d,]+(?:\.[\d]{1,2})?)/i);
  return m ? m[1].replace(/,/g,'') : '';
}

function extractWeight(s){
  // 修正常見 OCR 誤辨：K6->KG, L8->LB
  const fixUnit = (u)=> u
    .toUpperCase()
    .replace(/K6/g, 'KG')
    .replace(/L8/g, 'LB')
    .replace(/S$/,'');
  const m = s.match(/(?:ACT\s*WGT|ACT\.?\s*WT|WT|WEIGHT)\s*[:\-]?\s*([\d.,]+)\s*([A-Z]{1,3})\b/i);
  if (!m) return '';
  const num = m[1].replace(/,/g,'');
  const unit = fixUnit(m[2]);
  return `${num} ${unit}`;
}

function awbPostprocess(s){
  if (!s) return '';
  const digits = s.replace(/\D/g,'');
  const m = digits.match(/\d{12,14}/);
  return m ? m[0] : (digits.length?digits.slice(0,14):'');
}

async function zonalOcr(src){
  const qs = new URLSearchParams(location.search);
  const showRoi = qs.get('showRoi') === '1';
  let debugParts = [];

  // 1) AWB
  let r = await cropRoiToDataURL(src, ZONAL_ROIS.awb);
  let o = await runOcr(r.url, { psm: ZONAL_ROIS.awb.psm, whitelist: ZONAL_ROIS.awb.whitelist });
  debugParts.push(`[AWB]\n${o.text}`);
  awb.value = awbPostprocess(o.text||'');

  // 2) SHIP/WT 框
  r = await cropRoiToDataURL(src, ZONAL_ROIS.ship);
  o = await runOcr(r.url, { psm: ZONAL_ROIS.ship.psm });
  debugParts.push(`\n[SHIP/WT]\n${o.text}`);
  const dateNorm = normalizeDateLike(o.text||'');
  if (dateNorm) dateEl.value = dateNorm;
  const wt = extractWeight(o.text||'');
  if (wt) weight.value = wt;

  // 3) TO 區塊（收件人）
  r = await cropRoiToDataURL(src, ZONAL_ROIS.toBlk);
  o = await runOcr(r.url, { psm: ZONAL_ROIS.toBlk.psm });
  debugParts.push(`\n[TO]\n${o.text}`);
  const toLines = (o.text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (toLines.length){
    buyer.value = toLines.slice(0,2).join(' ').trim();
    buyerAddr.value = toLines.slice(2).join('\n');
  }

  // 4) DESC1
  r = await cropRoiToDataURL(src, ZONAL_ROIS.desc1);
  o = await runOcr(r.url, { psm: ZONAL_ROIS.desc1.psm });
  debugParts.push(`\n[DESC]\n${o.text}`);
  const mDesc = (o.text||'').match(/^[A-Z ]*:?\s*(.+)$/i);
  if (mDesc) desc.value = mDesc[1].trim();

  // 5) CUSTOMS VALUE → 金額
  r = await cropRoiToDataURL(src, ZONAL_ROIS.customs);
  o = await runOcr(r.url, { psm: ZONAL_ROIS.customs.psm });
  debugParts.push(`\n[CUSTOMS]\n${o.text}`);
  const amt = extractAmountUSD(o.text||'');
  if (amt) amount.value = amt;

  // 6) ORIGIN（寄件人）
  r = await cropRoiToDataURL(src, ZONAL_ROIS.origin);
  o = await runOcr(r.url, { psm: ZONAL_ROIS.origin.psm });
  debugParts.push(`\n[ORIGIN]\n${o.text}`);
  const orgLines = (o.text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (orgLines.length){
    seller.value = orgLines.slice(0,2).join(' ').trim();
    sellerAddr.value = orgLines.slice(2).join('\n');
  }

  // Optional: ROI 覆蓋示意
  if (showRoi){
    const { canvas } = await loadImageToCanvas(src);
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(255,0,0,0.9)';
    ctx.lineWidth = 3;
    ctx.fillStyle = 'rgba(255,0,0,0.15)';
    Object.values(ZONAL_ROIS).forEach(roi=>{
      const x = (roi.x/100)*canvas.width;
      const y = (roi.y/100)*canvas.height;
      const w = (roi.w/100)*canvas.width;
      const h = (roi.h/100)*canvas.height;
      ctx.fillRect(x,y,w,h); ctx.strokeRect(x,y,w,h);
    });
    try { preview.src = canvas.toDataURL('image/jpeg', 0.92); } catch {}
  }

  // 彙整狀態
  const dbg = debugParts.join('\n');
  const statusText = '完成（分區 OCR）';
  return { debugText: dbg, statusText };
}

// Enhance button: preprocess + multi-rotation OCR, choose best
if (btnEnhance){
  btnEnhance.addEventListener('click', async () => {
    try{
      const file = fileInput.files?.[0];
      const src = file ? file : (preview.src || null);
      if (!src){ alert('請先拍照或選擇一張圖片。'); return; }
      ocrStatus.textContent = '影像增強與多方向辨識…';
      ocrProgress.value = 0;
      const { canvas } = await loadImageToCanvas(src);
      const enhanced = enhanceCanvas(canvas);
      // try 0/90/180/270
      const angles = [0,90,180,270];
      let best = { text:"", confidence:-1 };
      for (const a of angles){
        const c = a===0 ? enhanced : rotateCanvas(enhanced, a);
        const dataUrl = c.toDataURL('image/png');
        const res = await runOcr(dataUrl);
        if ((res.confidence||0) > (best.confidence||0)) best = res;
        // update status progressively
        ocrStatus.textContent = `嘗試 ${a}°（信心 ${Number(res.confidence||0).toFixed(1)}）`;
      }
      ocrText.value = best.text || '';
      autoMap(ocrText.value||'');
      ocrStatus.textContent = `完成（最佳信心 ${Number(best.confidence||0).toFixed(1)}）`;
    } catch(e){
      console.error(e);
      ocrStatus.textContent = '辨識失敗，請嘗試較清晰的圖片。';
    }
  });
}

// Rotate button: rotate preview 90° clockwise
if (btnRotate){
  btnRotate.addEventListener('click', async () => {
    try{
      const file = fileInput.files?.[0];
      const src = file ? file : (preview.src || null);
      if (!src){ alert('請先拍照或選擇一張圖片。'); return; }
      const { canvas } = await loadImageToCanvas(src);
      const rotated = rotateCanvas(canvas, 90);
      const url = rotated.toDataURL('image/jpeg', 0.92);
      preview.src = url;
      ocrStatus.textContent = '已旋轉 90°，請再按「開始辨識」。';
    } catch(e){
      console.error(e);
      ocrStatus.textContent = '旋轉失敗。';
    }
  });
}

function autoMap(text){
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map(s=>s.trim()).filter(Boolean);

  // 1) AWB — prefer labeled, support spaces/dashes; fallback to first 12–14 digits
  // Try explicit TRK# first (FedEx label often shows this)
  let awbMatch = text.match(/(?:TRK#|TRK|TRACKING|TRACK\s*#)\s*:?\s*(\d[\d\-\s]{8,20}\d)/i)
               || text.match(/(?:AWB|Air\s*Waybill|Waybill)[^\d]*(\d[\d\-\s]{8,20}\d)/i);
  if (!awbMatch) awbMatch = text.match(/\b(\d[\d\-\s]{10,18}\d)\b/); // grouped number fallback
  if (awbMatch){
    const digits = (awbMatch[1]||"").replace(/\D/g,"");
    // prefer length 12–14 if available
    const pref = digits.match(/\d{12,14}/);
    awb.value = (pref ? pref[0] : digits.slice(0,14));
  }

  // 2) Date — support YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, DD-MMM-YY, and DD-MM-YYYY or MM-DD-YYYY
  let dateMatch = text.match(/\b(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/);
  if (!dateMatch){
    const m2 = text.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})\b/);
    if (m2){
      const d1 = parseInt(m2[1],10), d2 = parseInt(m2[2],10), y = m2[3];
      // Heuristic: if second part > 12 then it's DD-MM-YYYY; else assume MM-DD-YYYY
      let mm = d2 <= 12 ? d1 : d2;
      let dd = d2 <= 12 ? d2 : d1;
      const pad = (n)=>String(n).padStart(2,'0');
      dateEl.value = `${y}-${pad(mm)}-${pad(dd)}`;
    }
    else {
      // FedEx label style: 13NOV25 / 3-letter month
      const m3 = text.match(/\b(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(\d{2,4})\b/i);
      if (m3){
        const d = parseInt(m3[1],10);
        const mon = m3[2].toUpperCase().slice(0,3);
        const months = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
        const mm = months[mon]||1;
        let yy = parseInt(m3[3],10);
        if (yy < 100) yy = yy <= 50 ? 2000+yy : 1900+yy; // simple 2-digit year rule
        const pad = (n)=>String(n).padStart(2,'0');
        dateEl.value = `${yy}-${pad(mm)}-${pad(d)}`;
      }
    }
  } else {
    dateEl.value = dateMatch[1].replace(/[\.\/]/g,"-");
  }

  // 3) Seller/Buyer names — expanded English keywords
  const sellerKW = /(Seller|Exporter|From|Shipper|Consignor)/i;
  const buyerKW  = /(Buyer|Consignee|To|Ship\s*-?\s*To|Receiver|Recipient|Deliver\s*To)/i;
  const pickNext = (kw) => {
    const idx = lines.findIndex(l => kw.test(l));
    return idx>=0 ? (lines[idx+1]||"") : "";
  };
  if (!seller.value) seller.value = pickNext(sellerKW);
  if (!buyer.value)  buyer.value  = pickNext(buyerKW);

  // 4) Address detection (English): capture up to 1–4 lines after the name, stop at blank or next label
  const addrCue = /(\d|,|Street|St\.|Road|Rd\.|Ave\.?|Avenue|Blvd\.?|Drive|Dr\.|Lane|Ln\.|Court|Ct\.|City|ZIP|Postal|Postcode|USA|United\s*States|UK|United\s*Kingdom|England|Scotland|Wales|Northern\s*Ireland|Canada|CA|Australia|AU|Taiwan|TW|Japan|JP|Korea|KR|District|County|State|Province|Suite|Ste\.|Floor|Fl\.|Bldg\.|Room|Rm\.)/i;
  const isLabel = (s)=> sellerKW.test(s) || buyerKW.test(s) || /Description|Amount|Invoice|Total/i.test(s);
  const collectAddrAfter = (name) => {
    const idx = lines.findIndex(l => l===name);
    if (idx<0) return "";
    const parts = [];
    for (let i=idx+1;i<Math.min(lines.length, idx+5);i++){
      const l = lines[i];
      if (!l || isLabel(l)) break;
      if (addrCue.test(l)) parts.push(l);
      // if line contains only a country name without digits, still allow
      else if (/\b(USA|United\s*States|UK|United\s*Kingdom|Taiwan|Japan|Korea|Canada|Australia)\b/i.test(l)) parts.push(l);
    }
    return parts.join("\n");
  };
  if (!sellerAddr.value && seller.value) sellerAddr.value = collectAddrAfter(seller.value);
  if (!buyerAddr.value && buyer.value) buyerAddr.value = collectAddrAfter(buyer.value);

  // 5) Description & Amount — handle FedEx AWB keywords first
  // Customs value (amount)
  const custVal = text.match(/CUSTOMS\s*VALUE[:\s]*\$?\s*([\d,]+(?:\.\d{1,2})?)/i)
               || text.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)\s*USD\b[^\n]*CUSTOMS/i);
  if (custVal && !amount.value) amount.value = custVal[1].replace(/,/g,"");

  // Weight (e.g., ACT WT: 0.50 KG, WT 1 LB)
  const wtMatch = text.match(/(?:ACT\s*WT|WT|WEIGHT)\s*[:\-]?\s*([\d.,]+)\s*(KG|KGS?|G|GRAMS?|LB|LBS?)\b/i);
  if (wtMatch && !weight.value){
    const num = wtMatch[1].replace(/,/g,"");
    const unit = wtMatch[2].toUpperCase().replace(/S$/,'');
    weight.value = `${num} ${unit}`;
  }

  // Pieces (e.g., PIECES: 1, PKGS: 2)
  const pcsMatch = text.match(/(?:PIECES|PCS|PKGS?|QTY)\s*[:\-]?\s*(\d{1,3})\b/i);
  if (pcsMatch && !pieces.value){
    pieces.value = pcsMatch[1];
  }

  // Description may appear as DESC / DESC1 on labels
  const descLine = lines.find(l => /^DESC\d*\s*[:\-]/i.test(l))
                  || lines.find(l => /Description/i.test(l));
  if (descLine && !desc.value){
    const m = descLine.match(/^[A-Z\s]*:?\s*(.+)$/i);
    if (m) desc.value = m[1].trim();
  }

  // Fallback to currency-like lines
  let priceLine = lines.find(l => /(USD|\$)\s*\d+[\,\d]*\.\d{1,2}/i.test(l))
                || lines.find(l => /\d+[\,\d]*\.\d{1,2}\s*USD/i.test(l))
                || lines.find(l => /\d+[\,\d]*\.\d{1,2}/.test(l))
                || "";
  if (!desc.value) desc.value = priceLine.replace(/\$?\s?\d+[\,\d]*(\.\d{1,2})?/g,"").replace(/USD/i,"").trim() || (lines[0]||"");
  const priceMatch = amount.value ? null : priceLine.match(/\d+[\,\d]*\.\d{1,2}/);
  if (priceMatch && !amount.value) amount.value = priceMatch[0].replace(/,/g,"");
}

// Remap and Clear buttons
if (btnRemap){
  btnRemap.addEventListener('click', () => autoMap(ocrText.value||""));
}
  if (btnClear){
    btnClear.addEventListener('click', () => {
      for (const el of [awb, dateEl, seller, sellerAddr, buyer, buyerAddr, countryEl, postalCodeEl, phoneEl, desc, amount, weight, pieces]){
        if (el) el.value = "";
      }
      if (rawText) rawText.value = "";
      setStatus("");
    });
  }

btnPdf.addEventListener("click", async () => {
  const data = {
    awb: awb.value.trim() || "—",
    date: (dateEl.value.trim() || new Date().toISOString().slice(0,10)),
    seller: seller.value.trim() || "—",
    sellerAddr: sellerAddr.value.trim() || "—",
    buyer: buyer.value.trim() || "—",
    buyerAddr: buyerAddr.value.trim() || "—",
    desc: desc.value.trim() || "—",
    amount: Number(amount.value || "0"),
    weight: weight.value.trim() || "—",
    pieces: pieces.value.trim() || "—"
  };

  outStatus.textContent = "生成 PDF 中…";
  try {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    let pdf = await PDFDocument.create();
    let page;
    const A4 = [595.28, 841.89];

    // If user opts to use the FedEx template as background
    const wantTpl = useFedExTpl && useFedExTpl.checked;

    // Fonts (prepare upfront)
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Try to load template (image) and draw as background if requested
    if (wantTpl) {
      // Helper to draw background image (PNG/JPG)
      const drawBackgroundImage = async (bytes, mime) => {
        const pageLocal = pdf.addPage(A4);
        let img;
        if (/png/i.test(mime)) img = await pdf.embedPng(bytes); else img = await pdf.embedJpg(bytes);
        const pageWidth = A4[0], pageHeight = A4[1];
        const imgW = img.width, imgH = img.height;
        const scale = Math.min(pageWidth / imgW, pageHeight / imgH);
        const drawW = imgW * scale;
        const drawH = imgH * scale;
        const offsetX = (pageWidth - drawW) / 2;
        const offsetY = (pageHeight - drawH) / 2;
        pageLocal.drawImage(img, { x: offsetX, y: offsetY, width: drawW, height: drawH });
        return pageLocal;
      };

      // Source priority:
      // 1) User uploaded file
      // 2) New official template: assets/fedex-commercial-invoice-form-tw.pdf
      // 3) Legacy fallbacks: assets/ci_template.(pdf|png|jpg)
      let tplBytes = null;
      let mime = "";
      if (tplInput && tplInput.files && tplInput.files[0]) {
        tplBytes = await tplInput.files[0].arrayBuffer();
        mime = tplInput.files[0].type || "image/png";
      } else {
        try {
          const respPdfNew = await fetch('assets/fedex-commercial-invoice-form-tw.pdf');
          if (respPdfNew.ok) { tplBytes = await respPdfNew.arrayBuffer(); mime = 'application/pdf'; }
        } catch {}
        if (!tplBytes) {
          try {
            const respPdf = await fetch('assets/ci_template.pdf');
            if (respPdf.ok) { tplBytes = await respPdf.arrayBuffer(); mime = 'application/pdf'; }
          } catch {}
        }
        if (!tplBytes) {
          try {
            const respPng = await fetch('assets/ci_template.png');
            if (respPng.ok) { tplBytes = await respPng.arrayBuffer(); mime = 'image/png'; }
          } catch {}
        }
        if (!tplBytes) {
          try {
            const respJpg = await fetch('assets/ci_template.jpg');
            if (respJpg.ok) { tplBytes = await respJpg.arrayBuffer(); mime = 'image/jpeg'; }
          } catch {}
        }
      }

      if (tplBytes) {
        if (/application\/pdf/i.test(mime)) {
          // If template is a PDF, copy its first page directly into our document
          const tplPdf = await PDFDocument.load(tplBytes);
          const [tplPage] = await pdf.copyPages(tplPdf, [0]);
          page = pdf.addPage(tplPage);
        } else {
          page = await drawBackgroundImage(tplBytes, mime);
        }
      } else {
        // Fallback to a blank A4 if no template could be loaded
        page = pdf.addPage(A4);
      }
    } else {
      page = pdf.addPage(A4); // legacy layout branch will draw its own boxes
    }

    // Helper
    const left = 40, right = 555;
    let y = 810;
    const txt = (t,x,y,f=helv,s=10)=>page.drawText(String(t||""),{x,y,size:s,font:f,color:rgb(0,0,0)});
    const line = (x1,y1,x2,y2)=>page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:0.8,color:rgb(0,0,0)});
    const rect = (x,y,w,h)=>page.drawRectangle({x,y,width:w,height:h,borderColor:rgb(0,0,0),borderWidth:0.8,color:rgb(1,1,1)});

    const wrapText = (text, maxWidth, font, size) => {
      const words = String(text||"").replace(/\r/g,"").split(/\s+/);
      const lines = [];
      let current = "";
      const widthOf = (s)=>font.widthOfTextAtSize(s, size);
      for (const w of words){
        const test = current ? current+" "+w : w;
        if (widthOf(test) <= maxWidth){
          current = test;
        } else {
          if (current) lines.push(current);
          // if single word longer than max, hard cut
          if (widthOf(w) > maxWidth){
            let chunk = "";
            for (const ch of w){
              const t2 = chunk+ch;
              if (widthOf(t2) <= maxWidth) chunk = t2; else { lines.push(chunk); chunk = ch; }
            }
            current = chunk;
          } else {
            current = w;
          }
        }
      }
      if (current) lines.push(current);
      // Also respect manual newlines
      const final = [];
      for (const l of lines.join("\n").split("\n")){
        if (l.trim()==="") final.push(""); else final.push(l);
      }
      return final;
    };

    // If using FedEx template, we skip drawing our legacy boxes and only place text at mapped positions.
    const usingTemplate = !!(wantTpl);
    if (usingTemplate) {
      // === New official FedEx TW invoice template vector mapping ===
      // A4 baseline coordinates measured approximately on the provided assets/fedex-commercial-invoice-form-tw.pdf
      // Provide quick fine-tune offsets via query string: ?dx=..&dy=..&debugTpl=1
      const qs = new URLSearchParams(location.search);
      const dx = Number(qs.get('dx')||0);
      const dy = Number(qs.get('dy')||0);
      const debugTpl = /(^|&)debugTpl=1(&|$)/.test(location.search);
      // font size baseline
      const size = 10;

      // Map A4-based coordinates to actual page coordinates (in case template PDF is not exactly A4)
      let pw = A4[0], ph = A4[1];
      try {
        const sz = page.getSize ? page.getSize() : null;
        if (sz) { pw = sz.width || pw; ph = sz.height || ph; }
      } catch {}
      const sx = pw / A4[0];
      const sy = ph / A4[1];
      const mx = (x)=> (x + dx) * sx;
      const my = (y)=> (y + dy) * sy;

      const drawTextM = (t, x, y, s=size, f=helv) => page.drawText(String(t||''), { x: mx(x), y: my(y), size: s, font: f, color: rgb(0,0,0) });
      const rightAlign = (t, xr, yy, f=helv, s=size)=>{
        const w = f.widthOfTextAtSize(String(t||''), s);
        page.drawText(String(t||''), { x: mx(xr) - w, y: my(yy), size: s, font: f, color: rgb(0,0,0) });
      };

      // Header fields
      // AWB (Air Waybill No.) — left part top row
      drawTextM(String(data.awb||''), 155, 785, size, helv);
      // Date of Exportation — below AWB
      drawTextM(String(data.date||''), 155, 751, size, helv);
      // Weight / Pieces — top right corner small boxes
      drawTextM(String(data.weight||''), 475, 785, size, helv);
      drawTextM(String(data.pieces||''), 520, 785, size, helv);

      // Parties
      drawTextM(String(data.seller||''), 55, 716, size, helv);
      let yy = 700;
      for (const [i, line] of wrapText(data.sellerAddr, 300, helv, size).entries()) drawTextM(line, 55, yy - i*12, size, helv);
      drawTextM(String(data.buyer||''), 360, 716, size, helv);
      yy = 700;
      for (const [i, line] of wrapText(data.buyerAddr, 300, helv, size).entries()) drawTextM(line, 360, yy - i*12, size, helv);

      // Items table (single row)
      // Description column wide text
      drawTextM(String(data.desc||''), 200, 404, size, helv);
      // QTY (right aligned)
      rightAlign(String(data.pieces||''), 420, 404, helv, size);
      // Weight (right aligned)
      rightAlign(String(data.weight||''), 480, 404, helv, size);
      // Unit Value (USD) right aligned numeric
      rightAlign(Number.isFinite(data.amount)?data.amount.toFixed(2):String(data.amount||''), 540, 404, helv, size);
      // Total Value (same as amount for 1 line)
      rightAlign(Number.isFinite(data.amount)?data.amount.toFixed(2):String(data.amount||''), 585, 404, helv, size);

      // Totals block at lower right
      rightAlign(Number.isFinite(data.amount)?data.amount.toFixed(2):String(data.amount||''), 585, 150, helv, size+1);

      // Footer fields (optional prefill)
      drawTextM(String(data.seller||''), 55, 95, size, helv);
      drawTextM(String(data.date||''), 360, 95, size, helv);

      // Optional debug guides for alignment
      if (debugTpl) {
        const guide = (x,y,w=4,h=4)=>page.drawRectangle({x:mx(x)-w/2,y:my(y)-h/2,width:w,height:h,color:rgb(1,0,0)});
        // drop small markers at key anchors
        [
          [155,785],[155,751],[475,785],[520,785],
          [55,716],[55,700],[360,716],[360,700],
          [200,404],[420,404],[480,404],[540,404],[585,404],
          [585,150],[55,95],[360,95]
        ].forEach(([x0,y0])=>guide(x0,y0));
      }

      const bytes = await pdf.save();
      const blob = new Blob([bytes], {type:"application/pdf"});
      const fname = `INV_FedEx_${new Date().toISOString().slice(0,10).replace(/-/g,"")}.pdf`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
      outStatus.textContent = "PDF 已下載（FedEx 官方新版樣板）。";
      return;
    }

    // ===== Legacy layout below (kept as fallback) =====
    // Header title
    txt("COMMERCIAL INVOICE", left, y, bold, 14); y -= 18;

    // Box: AWB + Date + Shipment details
    rect(left, y-54, right-left, 54);
    line(left + 220, y, left + 220, y-54);
    line(left + 390, y, left + 390, y-54);
    txt("FedEx AWB No.", left+8, y-12, bold);
    txt(data.awb, left+120, y-12, helv);
    txt("Date (YYYY-MM-DD)", left+228, y-12, bold);
    txt(data.date, left+360, y-12, helv);
    txt("Weight / Pieces", left+398, y-12, bold);
    txt(`${data.weight} / ${data.pieces}`, left+510, y-12, helv);
    y -= 68;

    // Box: Seller / Buyer (Name & Address)
    const labelX = left+8;
    const valueX = left+140;
    const innerWidth = right - valueX - 8;
    const nameSize = 10;
    const addrSize = 10;
    const addrLineH = 12;
    const sellerAddrLines = wrapText(data.sellerAddr, innerWidth, helv, addrSize);
    const buyerAddrLines  = wrapText(data.buyerAddr, innerWidth, helv, addrSize);
    const sellerBlockH = 18 + sellerAddrLines.length * addrLineH + 4;
    const buyerBlockH  = 18 + buyerAddrLines.length * addrLineH + 4;
    const totalH = sellerBlockH + buyerBlockH + 4;

    rect(left, y - totalH, right-left, totalH);
    // Seller row
    txt("Seller / Exporter", labelX, y-16, bold);
    txt(data.seller, valueX, y-16, helv, nameSize);
    let yy = y - 32;
    for (const l of sellerAddrLines){
      txt(l, valueX, yy, helv, addrSize);
      yy -= addrLineH;
    }
    line(left, y - sellerBlockH, right, y - sellerBlockH);
    // Buyer row
    const y2 = y - sellerBlockH;
    txt("Buyer / Consignee", labelX, y2 - 16, bold);
    txt(data.buyer, valueX, y2 - 16, helv, nameSize);
    yy = y2 - 32;
    for (const l of buyerAddrLines){
      txt(l, valueX, yy, helv, addrSize);
      yy -= addrLineH;
    }
    y -= (totalH + 16);

    // Items table
    rect(left, y-24, right-left, 24);
    txt("Description of Goods", left+8, y-16, bold);
    line(left+420, y, left+420, y-24);
    txt("Amount (USD)", left+430, y-16, bold);
    y -= 24;

    rect(left, y-28, right-left, 28);
    line(left+420, y, left+420, y-28);
    txt(data.desc, left+8, y-20, helv);
    txt(data.amount.toFixed(2), left+430, y-20, helv);
    y -= 40;

    // Totals box
    rect(left, y-40, right-left, 40);
    line(left+420, y, left+420, y-40);
    txt("Grand Total (USD)", left+430, y-16, bold);
    txt(data.amount.toFixed(2), left+430, y-30, helv, 12);
    y -= 56;

    // Footer note
    txt("System-generated invoice based on OCR inputs. No signature required.", left, 70, helv, 8);

    const bytes = await pdf.save();
    const blob = new Blob([bytes], {type:"application/pdf"});
    const fname = `INV_${new Date().toISOString().slice(0,10).replace(/-/g,"")}.pdf`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
    outStatus.textContent = "PDF 已下載（制式表格）。";
  } catch (e){
    console.error(e);
    outStatus.textContent = "PDF 生成失敗。";
  }
});
