// main.js v2.0-Clean (基於 v1.7M 邏輯，移除 OCR)
const $ = (id) => document.getElementById(id);

// UI 元件參照
const btnRunNER = $("btnRunNER");
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

// 狀態顯示工具
function setStatus(msg){ if (textExtractStatus) textExtractStatus.innerHTML = msg || ''; }

// 切換模板上傳列顯示狀態
if (useFedExTpl && tplRow) {
  const syncTplRow = () => {
    tplRow.style.display = useFedExTpl.checked ? 'flex' : 'none';
  };
  useFedExTpl.addEventListener('change', syncTplRow);
  syncTplRow();
}

// 監聽 NER 按鈕
if (btnRunNER && rawText){
  btnRunNER.addEventListener('click', () => {
    const val = (rawText.value||'').trim();
    if(!val) { 
        alert('請先貼上文字內容！'); 
        return; 
    }
    
    // 執行你原本的高級解析邏輯
    const ent = parseTextWithNER(val);
    fillFieldsFromEntities(ent);
    
    alert('✅ 智能帶入完成！請檢查欄位。');
    setStatus('✅ 解析完成');
  });
}

// 監聽清空按鈕
if (btnClear){
  btnClear.addEventListener('click', () => {
    if(confirm('確定要清空所有欄位嗎？')) {
        [awb, dateEl, seller, sellerAddr, buyer, buyerAddr, countryEl, postalCodeEl, phoneEl, desc, amount, weight, pieces, rawText].forEach(e => { if(e) e.value = ''; });
        setStatus("");
        outStatus.textContent = "";
    }
  });
}

// ==========================================
// 恢復完整的 NER 智能解析邏輯 (保留你原本的程式碼)
// ==========================================
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

  // Phone
  const phoneMatch = whole.match(/(?:TEL|PHONE|聯絡電話|電話)\s*[:：]?\s*([+]?\d[\d\s\-()]{6,}\d)/i) || whole.match(/\b\+?\d[\d\s\-()]{6,}\d\b/);
  if (phoneMatch) out.phone = phoneMatch[1] ? phoneMatch[1].trim() : phoneMatch[0].trim();

  // Postal code
  const postalMatch = whole.match(/(?:POSTAL\s*CODE|ZIP|郵遞區號)\s*[:：]?\s*(\d{3,6})\b/i) || whole.match(/\b(\d{3,6})\b(?!.*\b(\d{3,6})\b)/);
  if (postalMatch) out.postalCode = postalMatch[1] || postalMatch[0];

  // Country detection
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

  // AWB 偵測 (新增)
  const awbMatch = whole.match(/(?:\b|\D)(\d{4}[ \-]?\d{4}[ \-]?\d{4})(?:\b|\D)/);
  if (awbMatch) awb.value = awbMatch[1].replace(/[ \-]/g, '');

  // 日期偵測 (新增)
  const dateMatch = whole.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})|(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})/i);
  if (dateMatch) dateEl.value = dateMatch[0];

  // 金額偵測 (新增)
  const amountMatch = whole.match(/(?:USD|Value|Total|Amount)[:\s\$]*(\d{1,5}\.?\d{0,2})/i);
  if (amountMatch) amount.value = amountMatch[1];

  // Identify sender/recipient blocks
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

  const parseNameAddr = (block) => {
    if (!block || !block.length) return { name:'', company:'', address:'' };
    const first = block[0];
    const second = block[1] || '';
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

  // Fallback address logic
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

  // Semantic Description Extraction (你原本的邏輯)
  try {
    const descEnt = extractShipmentDescriptionSemantic({
      text: whole,
      lines,
      excludeBlocks: { sender: senderBlock, recipient: recipientBlock }
    });
    if (descEnt && descEnt.value && descEnt.confidence >= 3) {
      out.description = descEnt.value;
      out.descriptionConfidence = descEnt.confidence;
    }
  } catch(e){ }

  return out;
}

// --- Semantic shipment description extractor (保持不變) ---
function extractShipmentDescriptionSemantic(ctx){
  const text = (ctx?.text || '').trim();
  const lines = Array.isArray(ctx?.lines) ? ctx.lines : text.split(/\r?\n/).map(s=>s.trim());
  if (!text) return { value:'', confidence:0 };

  const GOODS_LEXICON = [
    'paperboard box','carton','box','documents','document','papers','commercial goods','merchandise','goods','electronics','electronic','device','devices','clothing sample','sample','samples','garment','clothing','accessories','accessory','parts','spare parts','gift','return','parcel','package','packages','watch','bag','bags','shoes','book','books','stationery','toy','toys','component','components'
  ];
  const QTY_CUES_RE = /\b(?:\d+[\d.,]*\s*)?(?:pcs?|pieces?|units?|unit|boxes|box|cartons?|ctn|pkg|packages?|set|sets|kg|g|lb|lbs)\b/i;
  const ADDRESS_CUES_RE = /(street|st\.?|road|rd\.?|avenue|ave\.?|blvd\.?|lane|ln\.?|drive|dr\.?|district|city|county|state|province|zip|postal|floor|fl\.|suite|ste\.|號|路|街|巷|弄|樓|市|區|鄉|鎮)/i;
  const NAME_CUES_RE = /(Mr\.?|Ms\.?|Mrs\.?|先生|小姐|公司|股份|有限公司|CO\.?|INC\.?|LTD\.?|LLC|CORP\.?)/i;
  const PHONE_RE = /\+?\d[\d\s\-()]{6,}\d/;
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

  const excludeSet = new Set();
  const addToExclude = (arr)=>{ (arr||[]).forEach(s=>{ if (s) excludeSet.add(s.trim()); }); };
  if (ctx?.excludeBlocks){ addToExclude(ctx.excludeBlocks.sender); addToExclude(ctx.excludeBlocks.recipient); }

  const candList = [];
  const pushCand = (value, lineIdx, origin) => {
    const v = (value||'').trim().replace(/^[-:•·*\s]+/, '').replace(/\s{2,}/g,' ');
    if (!v) return;
    if (v.length < 2 || v.length > 80) return;
    if (PHONE_RE.test(v) || EMAIL_RE.test(v)) return;
    if (/^(sender|from|shipper|to|recipient|consignee|address|addr|invoice|amount|weight|pieces|awb|tracking|trk)/i.test(v)) return;
    candList.push({ value: v, lineIdx, origin });
  };

  lines.forEach((ln, i)=>{
    const raw = (ln||'').trim();
    if (!raw) return;
    if (excludeSet.has(raw)) return;
    if (PHONE_RE.test(raw) || EMAIL_RE.test(raw)) return;
    if (/^\d{3,}$/.test(raw)) return;
    const cleaned = raw.replace(/\b(description|contents?|商品|品名|物品|貨品|內容)\b\s*[:：]/i, ' ');
    const parts = cleaned.split(/[\|,/;]+|\s{2,}/).map(s=>s.trim()).filter(Boolean);
    if (parts.length === 0) return;

    const qtyHit = QTY_CUES_RE.test(raw);
    if (qtyHit){
      const m1 = raw.match(/\b(\d+[\d.,]*)\s*(pcs?|pieces?|units?|boxes?|cartons?|kg|g|lb|lbs)\b\s*([A-Za-z][\w \-]{1,60})/i);
      if (m1) pushCand(m1[3], i, 'qty-tail');
      const m2 = raw.match(/([A-Za-z][\w \-]{1,60})\s*\b(\d+[\d.,]*)\s*(pcs?|pieces?|units?|boxes?|cartons?|kg|g|lb|lbs)\b/i);
      if (m2) pushCand(m2[1], i, 'qty-head');
    }

    parts.forEach(p=>{
      const words = p.split(/\s+/).filter(Boolean);
      if (words.length === 0 || words.length > 6) return;
      if (!/[A-Za-z\p{L}]/u.test(p)) return;
      pushCand(p, i, 'part');
    });
  });

  const lowerText = text.toLowerCase();
  const scoreCand = (c)=>{
    let s = 1;
    const vLow = c.value.toLowerCase();
    if (GOODS_LEXICON.some(g => vLow.includes(g))) s += 2;
    for (let d=-2; d<=2; d++){
      const li = c.lineIdx + d;
      if (li>=0 && li<lines.length && QTY_CUES_RE.test(lines[li]||'')) { s += (d===0?2:1); break; }
    }
    if (ADDRESS_CUES_RE.test(c.value)) s -= 2;
    if (NAME_CUES_RE.test(c.value)) s -= 1;
    if (c.value.length >= 3 && c.value.length <= 30) s += 1;
    if (c.value.length > 12 && c.value === c.value.toUpperCase()) s -= 1;
    return s;
  };

  let best = null;
  for (const c of candList){
    const sc = scoreCand(c);
    if (!best || sc > best.score) best = { ...c, score: sc };
  }
  if (!best || best.score < 3) return { value:'', confidence: best ? best.score : 0 };

  let val = best.value.replace(/^(contents?|description|desc|品名|貨品|內容)\s*[:：\-]\s*/i, '').trim();
  val = val.replace(/\b(kg|g|lb|lbs|pcs?|pieces?|units?)\b/ig, '').replace(/\s{2,}/g,' ').trim();
  const title = val.split(' ').map(w=>{
    if (/^[A-Z0-9]{2,}$/.test(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
  return { value: title || val, confidence: best.score };
}

function fillFieldsFromEntities(ent){
  if (!ent) return;
  if (seller && (ent.senderCompany || ent.senderName)) seller.value = (ent.senderCompany || ent.senderName || '').trim();
  if (sellerAddr && ent.senderAddress) sellerAddr.value = ent.senderAddress;
  if (buyer && (ent.recipientCompany || ent.recipientName)) buyer.value = (ent.recipientCompany || ent.recipientName || '').trim();
  if (buyerAddr && ent.recipientAddress) buyerAddr.value = ent.recipientAddress;
  if (countryEl && ent.country) countryEl.value = ent.country;
  if (postalCodeEl && ent.postalCode) postalCodeEl.value = ent.postalCode;
  if (phoneEl && ent.phone) phoneEl.value = ent.phone;
  if (desc && ent.description && (desc.value || '').trim() === '' && (ent.descriptionConfidence||0) >= 3) {
    desc.value = ent.description;
  }
}

// =========================================================
// PDF 生成邏輯 (完全保留)
// =========================================================
btnPdf.addEventListener("click", async () => {
  const data = {
    awb: awb.value.trim(),
    date: (dateEl.value.trim() || new Date().toISOString().slice(0,10)),
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
  outStatus.style.color = "#C8B47E";

  const allText = Object.values(data).join('');
  const hasChinese = /[\u4e00-\u9fa5]/.test(allText);
  if (hasChinese) {
    alert("【注意】檢測到中文字元！\n\n目前的 PDF 字型僅支援英文/數字。\n欄位中的中文將無法顯示或變為亂碼。\n\n請務必將欄位內容修改為「英文」以確保正確顯示。");
  }

  try {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    let pdf = await PDFDocument.create();
    let page;
    const wantTpl = useFedExTpl && useFedExTpl.checked;
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const size = 10;
    const DEBUG_BOX = false; // 預設關閉紅框，如果你想除錯可以改成 true

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
        } catch(e) {
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

    const drawField = (text, x, y, widthLimit = 300) => {
        if (!text) return;
        const safeText = String(text).replace(/[\u4e00-\u9fa5]/g, '??'); 
        if (DEBUG_BOX) {
           page.drawRectangle({ x: x, y: y - 2, width: (safeText.length * 5) + 5, height: 12, borderColor: rgb(1, 0, 0), borderWidth: 1 });
        }
        page.drawText(safeText, { x, y, size, font: helv, color: rgb(0,0,0) });
    };

    const wrapText = (text, x, y, maxWidth) => {
        const words = String(text||"").split(/\s+/);
        let line = "";
        let currentY = y;
        for (const w of words) {
            if (line.length + w.length > 40) {
                drawField(line, x, currentY);
                line = w + " ";
                currentY -= 12;
            } else {
                line += w + " ";
            }
        }
        if (line) drawField(line, x, currentY);
    };

    // 填寫座標 (保持不變)
    drawField(data.awb, 280, 785); 
    drawField(data.date, 150, 762);
    drawField(data.seller, 40, 725);
    wrapText(data.sellerAddr, 40, 710, 250);
    drawField(data.buyer, 310, 725);
    wrapText(data.buyerAddr, 310, 710, 250);
    drawField(data.desc, 190, 520);
    drawField(data.pieces, 120, 520); 
    drawField(data.pieces, 420, 520); 
    drawField(data.weight, 455, 520); 
    drawField(data.amount, 500, 520); 
    drawField(data.amount, 550, 520); 
    drawField(data.pieces, 120, 150);
    drawField(data.weight, 455, 150);
    drawField(data.amount, 550, 150);
    drawField(data.seller, 40, 60);
    drawField(data.date, 300, 60);

    const pdfBytes = await pdf.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `FedEx_Invoice_TW_${Date.now()}.pdf`;
    link.click();
    
    outStatus.textContent = "PDF 下載成功！";
    setTimeout(() => outStatus.textContent = "", 5000);

  } catch (e) {
    console.error(e);
    alert("生成失敗：" + e.message);
    outStatus.textContent = "生成錯誤";
    outStatus.style.color = "red";
  }
});