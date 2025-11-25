// v1.7M-F-W-R2 Mobile (ZH-TW) — Uses "v1.7M 原始制式表格" style for PDF layout
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
const btnRemap = $("btnRemap");
const btnClear = $("btnClear");
const btnEnhance = $("btnEnhance");
const btnRotate = $("btnRotate");
const useFedExTpl = $("useFedExTpl");
const tplInput = $("tplInput");
const tplRow = $("tplRow");

// 舊版功能佔位符 (避免報錯)
const fileInput=null,btnCamera=null,btnOcr=null,ocrProgress=null,ocrStatus=null,ocrText=null,preview=null;
const btnScanStart=null,btnScanStop=null,barcodeVideo=null,barcodeStatus=null,btnSwitchCamera=null,btnDecodeImage=null,imgDecodeInput=null,btnHidToggle=null;

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

function setStatus(msg){ if (textExtractStatus) textExtractStatus.textContent = msg || ''; }

// Canvas 載入工具
async function loadImageToCanvas(src){
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
        resolve({ canvas, ctx, width:w, height:h });
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
    } catch (e){ reject(e); }
  });
}

// 簡易 OCR 與 NER 邏輯
async function extractTextFromImage(canvas){
  try {
    const TD = window.TextDetector;
    if (TD) {
      const detector = new TD();
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.92));
      const bmp = await createImageBitmap(blob);
      const results = await detector.detect(bmp);
      if (Array.isArray(results) && results.length){
        return results.map(r => r.rawValue || r.text || '').filter(Boolean).join('\n');
      }
    }
  } catch(e){ }
  try {
    if (typeof OCRAD === 'function'){
      return await new Promise((res) => { try { res(OCRAD(canvas)||''); } catch { res(''); } });
    }
  } catch {}
  return '';
}

function parseTextWithNER(text){
  const out = { senderName:'', senderCompany:'', senderAddress:'', recipientName:'', recipientCompany:'', recipientAddress:'', phone:'', postalCode:'', country:'', description:'', descriptionConfidence:0 };
  if (!text) return out;
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const whole = lines.join('\n');

  const phoneMatch = whole.match(/(?:TEL|PHONE|聯絡電話|電話)\s*[:：]?\s*([+]?\d[\d\s\-()]{6,}\d)/i) || whole.match(/\b\+?\d[\d\s\-()]{6,}\d\b/);
  if (phoneMatch) out.phone = phoneMatch[1] ? phoneMatch[1].trim() : phoneMatch[0].trim();

  const postalMatch = whole.match(/(?:POSTAL\s*CODE|ZIP|郵遞區號)\s*[:：]?\s*(\d{3,6})\b/i) || whole.match(/\b(\d{3,6})\b(?!.*\b(\d{3,6})\b)/);
  if (postalMatch) out.postalCode = postalMatch[1] || postalMatch[0];

  const idxSender = lines.findIndex(l=>/(寄件人|發件人|Sender|From|Shipper|Consignor)/i.test(l));
  const idxRecipient = lines.findIndex(l=>/(收件人|收貨人|Recipient|To|Ship\s*-?\s*To|Consignee)/i.test(l));

  const getBlock = (start) => {
    if (start < 0) return [];
    const arr = [];
    for(let i=start+1; i<Math.min(lines.length, start+8); i++){
      if (/(寄件人|收件人|Sender|Recipient|Invoice|Description|Amount)/i.test(lines[i])) break;
      arr.push(lines[i]);
    }
    return arr;
  };
  const sBlock = getBlock(idxSender);
  const rBlock = getBlock(idxRecipient);

  const parseNA = (blk) => {
    if(!blk.length) return {name:'',address:''};
    return { name: blk[0], address: blk.slice(1).join('\n') };
  };
  const sRes = parseNA(sBlock); out.senderName = sRes.name; out.senderAddress = sRes.address;
  const rRes = parseNA(rBlock); out.recipientName = rRes.name; out.recipientAddress = rRes.address;
  
  const descLine = lines.find(l=>/(?:Description|Goods|Contents)\s*[:：]\s*(.+)/i.test(l));
  if(descLine) {
    const m = descLine.match(/(?:Description|Goods|Contents)\s*[:：]\s*(.+)/i);
    if(m) out.description = m[1];
  }
  return out;
}

if (btnRunNER && rawText){
  btnRunNER.addEventListener('click', () => {
    const val = (rawText.value||'').trim();
    if(!val) { setStatus('請先拍照'); return; }
    const ent = parseTextWithNER(val);
    if(ent.senderName) seller.value = ent.senderName;
    if(ent.senderAddress) sellerAddr.value = ent.senderAddress;
    if(ent.recipientName) buyer.value = ent.recipientName;
    if(ent.recipientAddress) buyerAddr.value = ent.recipientAddress;
    if(ent.phone) phoneEl.value = ent.phone;
    if(ent.postalCode) postalCodeEl.value = ent.postalCode;
    if(ent.description) desc.value = ent.description;
    setStatus('已完成智能帶入。');
  });
}

if (btnClear){
  btnClear.addEventListener('click', () => {
    [awb, dateEl, seller, sellerAddr, buyer, buyerAddr, countryEl, postalCodeEl, phoneEl, desc, amount, weight, pieces, rawText].forEach(e => { if(e) e.value = ''; });
    setStatus("");
  });
}

// =========================================================
// 核心修改區：PDF 生成邏輯 (針對 assets/fedex-commercial-invoice-form-tw.pdf)
// =========================================================
btnPdf.addEventListener("click", async () => {
  // 1. 收集資料
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
  outStatus.style.color = "blue";

  // 警告：中文字元檢測
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
    // 設定是否開啟除錯紅框 (設為 false 即可隱藏)
    const DEBUG_BOX = true; 

    // 2. 載入模板 (優先使用 assets/fedex-commercial-invoice-form-tw.pdf)
    if (wantTpl) {
      let tplBytes = null;
      let mime = "application/pdf";
      
      // (A) 使用者上傳優先
      if (tplInput && tplInput.files && tplInput.files[0]) {
        tplBytes = await tplInput.files[0].arrayBuffer();
        mime = tplInput.files[0].type;
      } 
      // (B) 強制讀取指定的 assets 檔案
      else {
        // 請確保 assets 資料夾下確實有此檔案
        const targetFile = 'assets/fedex-commercial-invoice-form-tw.pdf';
        try {
            const resp = await fetch(targetFile);
            if (resp.ok) {
                tplBytes = await resp.arrayBuffer();
                console.log(`成功載入: ${targetFile}`);
            } else {
                throw new Error(`找不到檔案: ${targetFile}`);
            }
        } catch(e) {
            console.error(e);
            alert(`錯誤：無法讀取模板檔案 (${targetFile})。\n\n請確認檔案已放入 assets 資料夾中。`);
            // 若失敗則建立空白頁
            page = pdf.addPage([595.28, 841.89]);
        }
      }

      // 如果成功取得模板內容，則建立頁面
      if (tplBytes) {
        if (mime.includes('pdf')) {
            const tplPdf = await PDFDocument.load(tplBytes);
            // 複製第一頁
            const [tplPage] = await pdf.copyPages(tplPdf, [0]);
            page = pdf.addPage(tplPage);
        } else {
            // 圖片 fallback
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

    // 若上述步驟失敗導致 page 仍未定義，做個防呆
    if (!page) page = pdf.addPage([595.28, 841.89]);

    // 3. 填寫欄位 (根據 FedEx 台灣版調整座標)
    // 座標系統：左下角為 (0,0)。X 向右增加，Y 向上增加。
    // A4 尺寸約為 寬 595 x 高 842
    
    const drawField = (text, x, y, widthLimit = 300) => {
        if (!text) return;
        // 簡易過濾中文以避免報錯停止 (實際顯示仍需使用者輸入英文)
        const safeText = String(text).replace(/[\u4e00-\u9fa5]/g, '??'); 
        
        // Debug 紅框
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
            // 簡單換行邏輯
            if (line.length + w.length > 40) { // 約 40 字元換行
                drawField(line, x, currentY);
                line = w + " ";
                currentY -= 12;
            } else {
                line += w + " ";
            }
        }
        if (line) drawField(line, x, currentY);
    };

    // --- 開始填寫 (請對照 assets/fedex-commercial-invoice-form-tw.pdf) ---

    // 1. AWB (上方標題右側/中間框)
    // "INTERNATIONAL AIR WAYBILL NO." 右邊的格子
    drawField(data.awb, 280, 785); 

    // 2. 出口日期 (AWB 下方)
    drawField(data.date, 150, 762);

    // 3. 寄件人區塊 (左側大欄位: SHIPPER/EXPORTER)
    // 姓名/公司 (第一行)
    drawField(data.seller, 40, 725);
    // 地址 (往下折行)
    wrapText(data.sellerAddr, 40, 710, 250);

    // 4. 收件人區塊 (右側大欄位: CONSIGNEE)
    // 姓名/公司
    drawField(data.buyer, 310, 725);
    // 地址
    wrapText(data.buyerAddr, 310, 710, 250);

    // 5. 貨品描述 (FULL DESCRIPTION OF GOODS) - 中間寬欄
    // X 軸約在 180~200 之間，Y 軸從 500 開始往下
    drawField(data.desc, 190, 520);

    // 6. 表格數據 (同一行)
    // 件數 (NO. OF PKGS) - 左三
    drawField(data.pieces, 120, 520);
    // 數量 (QTY) - 右四
    drawField(data.pieces, 420, 520); 
    // 重量 (WEIGHT) - 右三
    drawField(data.weight, 455, 520);
    // 單價 (UNIT VALUE) - 右二
    drawField(data.amount, 500, 520);
    // 總價 (TOTAL VALUE) - 最右邊
    drawField(data.amount, 550, 520);

    // 7. 底部總計區 (TOTALS) - 右下角
    // 總件數 (TOTAL PKGS)
    drawField(data.pieces, 120, 150); // 對齊上方表格列
    // 總重量
    drawField(data.weight, 455, 150);
    // 總金額 (TOTAL INVOICE VALUE)
    drawField(data.amount, 550, 150);

    // 8. 簽名欄上方 (SIGNATURE)
    drawField(data.seller, 40, 60); // Name
    drawField(data.date, 300, 60);  // Date

    // 4. 下載
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