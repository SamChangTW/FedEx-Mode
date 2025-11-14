// v1.7M-F-W-R2 Mobile (ZH-TW) — Uses "v1.7M 原始制式表格" style for PDF layout
const $ = (id) => document.getElementById(id);

const fileInput = $("fileInput");
const btnCamera = $("btnCamera");
const btnOcr = $("btnOcr");
const ocrProgress = $("ocrProgress");
const ocrStatus = $("ocrStatus");
const ocrText = $("ocrText");
const preview = $("preview");

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

const btnPdf = $("btnPdf");
const outStatus = $("outStatus");
const btnRemap = $("btnRemap");
const btnClear = $("btnClear");
const btnEnhance = $("btnEnhance");
const btnRotate = $("btnRotate");
const useFedExTpl = $("useFedExTpl");
const tplInput = $("tplInput");
const tplRow = $("tplRow");

// Camera shortcut
btnCamera.addEventListener("click", () => {
  fileInput.setAttribute("capture", "environment");
  fileInput.click();
  setTimeout(() => fileInput.removeAttribute("capture"), 1000);
});

// Toggle template row visibility based on checkbox
if (useFedExTpl && tplRow) {
  const syncTplRow = () => {
    tplRow.style.display = useFedExTpl.checked ? 'flex' : 'none';
  };
  useFedExTpl.addEventListener('change', syncTplRow);
  // initialize on load
  syncTplRow();
}

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => preview.src = reader.result;
  reader.readAsDataURL(file);
});

btnOcr.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file && !preview.src) {
    alert("請先拍照或選擇一張圖片。");
    return;
  }
  ocrStatus.textContent = "初始化 OCR…";
  ocrProgress.value = 0;

  try {
    const { text, confidence } = await runOcr(file ? file : preview.src);
    ocrText.value = text || "";
    if (text) {
      ocrStatus.textContent = `完成（信心 ${Number(confidence||0).toFixed(1)}）`;
    } else {
      ocrStatus.textContent = "完成，但未擷取到文字。";
    }
    autoMap(ocrText.value || "");
  } catch (err) {
    console.error(err);
    const msg = (err && (err.message || err.toString())) || '';
    // 常見：語言資料無法下載（離線 / 被阻擋）
    if (/Failed to load language/i.test(msg) || /loadLanguage/i.test(msg) || /network/i.test(msg)){
      ocrStatus.textContent = "辨識失敗：需要網路下載語言資料（eng）。請連線後重試。";
    } else {
      ocrStatus.textContent = `辨識失敗，請嘗試較清晰的圖片。${msg ? '（'+msg+'）' : ''}`;
    }
  }
});

// Core OCR runner with basic config and progress logger
async function runOcr(source, opts={}){
  // 明確指定 Tesseract 各組件路徑，避免在 PWA/行動裝置上載入失敗
  const t5 = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist';
  const worker = Tesseract.createWorker({
    workerPath: `${t5}/worker.min.js`,
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
    // 使用公開英文字語料（如需中英混合再另行加入）
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
  });
  ocrStatus.textContent = '載入 OCR 元件…';
  await worker.load();
  ocrStatus.textContent = '下載語言資料（eng）…';
  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  if (opts.psm) await worker.setParameters({ tessedit_pageseg_mode: String(opts.psm) });
  if (opts.whitelist) await worker.setParameters({ tessedit_char_whitelist: opts.whitelist });
  const { data } = await worker.recognize(source, {
    logger: m => {
      if (m.status === 'recognizing text') {
        ocrProgress.value = m.progress || 0;
        ocrStatus.textContent = `辨識中… ${(m.progress*100).toFixed(0)}%`;
      }
    }
  });
  await worker.terminate();
  return { text: data.text || "", confidence: data.confidence };
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
    for (const el of [awb, dateEl, seller, sellerAddr, buyer, buyerAddr, desc, amount, weight, pieces]){
      if (el) el.value = "";
    }
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
