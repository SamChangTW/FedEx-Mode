// Minimal Web OCR → Invoice PDF generator (Public template v1.7M-F-W)
// No logo, no signature; fields follow FedEx-style commercial invoice essentials.
const el = (id) => document.getElementById(id);
const $ = el;

const preview = $("preview");
const imageInput = $("imageInput");
const btnSample = $("btnSample");
const btnOcr = $("btnOcr");
const ocrText = $("ocrText");
const ocrProgress = $("ocrProgress");
const ocrStatus = $("ocrStatus");
const outStatus = $("outStatus");

const awb = $("awb");
const date = $("date");
const seller = $("seller");
const sellerAddr = $("sellerAddr");
const buyer = $("buyer");
const buyerAddr = $("buyerAddr");
const incoterms = $("incoterms");
const currency = $("currency");
const items = $("items");
const freight = $("freight");
const insurance = $("insurance");
const notes = $("notes");

const btnPdf = $("btnPdf");
const btnJson = $("btnJson");

// Load sample image (embedded as data URL for offline demo)
btnSample.addEventListener("click", async () => {
  // A tiny embedded sample (blank) — replace by user image for real OCR.
  ocrText.value = "";
  preview.src = "https://dummyimage.com/1200x800/0d1117/ffffff&text=Sample+Invoice+Image";
});

imageInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    preview.src = reader.result;
  };
  reader.readAsDataURL(file);
});

btnOcr.addEventListener("click", async () => {
  if (!preview.src) {
    alert("請先選擇或拍攝一張圖片。");
    return;
  }
  ocrProgress.value = 0;
  ocrStatus.textContent = "OCR 初始化中…";
  try {
    const worker = Tesseract.createWorker();
    await worker.load();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    const { data } = await worker.recognize(preview.src, {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress) {
          ocrProgress.value = m.progress;
          ocrStatus.textContent = `OCR 辨識中… ${(m.progress*100).toFixed(0)}%`;
        }
      }
    });
    await worker.terminate();
    ocrText.value = data.text || "";
    ocrStatus.textContent = "OCR 完成。";
    autoMapFieldsFromOCR(ocrText.value);
  } catch (e) {
    console.error(e);
    ocrStatus.textContent = "OCR 失敗，請重試或換較清晰的圖片。";
  }
});

function autoMapFieldsFromOCR(text) {
  // Heuristic mapping
  const clean = (s) => s.replace(/\s+/g, " ").trim();

  // AWB: 12 digits with dashes/spaces allowed
  const awbMatch = text.match(/(?:AWB|Air\s*Waybill|Waybill)[^\d]*(\d{3,4}[-\s]?\d{3,4}[-\s]?\d{3,4})/i) 
                || text.match(/(\d{12})/);
  if (awbMatch) awb.value = clean(awbMatch[1]).replace(/\s+/g, "");

  // Date: YYYY-MM-DD or YYYY/MM/DD or DD/MM/YYYY
  const dateMatch = text.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/) || text.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/);
  if (dateMatch) {
    const d = dateMatch[1].replace(/\./g, "-").replace(/\//g,"-");
    date.value = d.length === 10 ? d : d;
  }

  // Seller & Buyer: lines after keywords
  const sellerMatch = text.match(/(?:Seller|Exporter|From)\s*[:\-]?\s*(.+)/i);
  if (sellerMatch) seller.value = clean(sellerMatch[1].slice(0, 80));
  const buyerMatch = text.match(/(?:Buyer|Consignee|To)\s*[:\-]?\s*(.+)/i);
  if (buyerMatch) buyer.value = clean(buyerMatch[1].slice(0, 80));

  // Attempt to find addresses (very naive: lines after the found names)
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const pickNextLine = (kw) => {
    const idx = lines.findIndex(l => new RegExp(kw, 'i').test(l));
    return idx>=0 && lines[idx+1] ? lines[idx+1] : "";
  };
  if (!sellerAddr.value) sellerAddr.value = clean(pickNextLine("(Seller|Exporter|From)"));
  if (!buyerAddr.value) buyerAddr.value = clean(pickNextLine("(Buyer|Consignee|To)"));

  // Currency and incoterms guesses
  if (!currency.value) {
    const cur = (text.match(/\b(USD|TWD|EUR|JPY|CNY|GBP)\b/i)||[])[1];
    if (cur) currency.value = cur.toUpperCase();
  }
  if (!incoterms.value) {
    const inco = (text.match(/\b(FOB|CIF|CFR|DAP|DDP|EXW)\b/i)||[])[1];
    if (inco) incoterms.value = inco.toUpperCase();
  }

  // Items: try to parse lines containing qty and price
  const itemLines = [];
  for (const l of lines) {
    // match: text ... qty ... unit price
    if (/\b\d+\b/.test(l) && /(\d+\.\d{1,2})/.test(l)) {
      itemLines.push(l);
    }
  }
  if (itemLines.length && !items.value.trim()) {
    // fallback: keep as description | | qty | PCS | price
    const mapped = itemLines.slice(0,4).map(l => {
      const mQty = l.match(/\b(\d{1,6})\b/);
      const mPrice = l.match(/(\d+\.\d{1,2})/);
      const desc = l.replace(/\b\d+(\.\d{1,2})?\b/g, "").replace(/[|]/g," ").trim();
      return `${desc || "Item"} |  | ${mQty ? mQty[1] : 1} | PCS | ${mPrice ? mPrice[1] : 0}`;
    });
    items.value = mapped.join("\n");
  }
}

btnPdf.addEventListener("click", async () => {
  const data = collectData();
  if (!data.items.length) {
    alert("請至少輸入一筆 Items。");
    return;
  }
  outStatus.textContent = "生成 PDF 中…";
  try {
    const pdfBytes = await buildPdf(data);
    const blob = new Blob([pdfBytes], {type: "application/pdf"});
    const fname = `INV_${(new Date()).toISOString().slice(0,10).replace(/-/g,"")}_${safeCode(data.buyer)}.pdf`;
    downloadBlob(blob, fname);
    outStatus.textContent = "PDF 已下載。";
  } catch (e) {
    console.error(e);
    outStatus.textContent = "PDF 生成失敗。";
  }
});

btnJson.addEventListener("click", () => {
  const data = collectData();
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const fname = `INV_${(new Date()).toISOString().slice(0,10).replace(/-/g,"")}_${safeCode(data.buyer)}.json`;
  downloadBlob(blob, fname);
});

function collectData(){
  const parsedItems = items.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split("|").map(s => s.trim());
    return {
      desc: parts[0] || "",
      hsCode: parts[1] || "",
      qty: Number(parts[2] || "0"),
      uom: parts[3] || "PCS",
      unitPrice: Number(parts[4] || "0")
    };
  });
  const sub = parsedItems.reduce((s, it) => s + (it.qty * it.unitPrice), 0);
  const freightVal = Number(freight.value||"0");
  const insuranceVal = Number(insurance.value||"0");
  const total = sub + freightVal + insuranceVal;
  return {
    docType: "invoice",
    version: "1.7M-F-W",
    awbNo: awb.value.trim(),
    date: date.value.trim() || new Date().toISOString().slice(0,10),
    seller: { name: seller.value.trim(), address: sellerAddr.value.trim() },
    buyer: { name: buyer.value.trim(), address: buyerAddr.value.trim() },
    incoterms: incoterms.value.trim() || "DAP",
    currency: currency.value.trim() || "USD",
    items: parsedItems,
    totals: { subTotal: round2(sub), freight: round2(freightVal), insurance: round2(insuranceVal), grandTotal: round2(total) },
    notes: notes.value.trim(),
    ocrText: ocrText.value.trim()
  };
}

function round2(n){ return Math.round(n*100)/100; }
function downloadBlob(blob, filename){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function safeCode(s){ return (s||"CLIENT").toUpperCase().replace(/[^A-Z0-9]+/g,"").slice(0,12) || "CLIENT"; }

async function buildPdf(data){
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4 in points
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const size = 10;

  let y = 800;
  const left = 40, right = 555;

  function text(t, x, y, f = font, s = size){ page.drawText(String(t||""), {x, y, size:s, font:f, color: rgb(0.95,0.95,0.96)}); }
  function line(x1,y1,x2,y2){ page.drawLine({start:{x:x1,y:y1}, end:{x:x2,y:y2}, thickness:1, color: rgb(0.2,0.25,0.32)}); }
  function label(l,v,yrow){
    text(l, left, yrow, bold);
    text(v, left+120, yrow);
  }

  text("COMMERCIAL INVOICE (Public Template v1.7M‑F‑W)", left, y, bold, 12); y -= 18;
  line(left, y, right, y); y -= 10;

  label("FedEx AWB No.", data.awbNo, y); y -= 14;
  label("Date", data.date, y); y -= 20;

  text("Seller / Exporter", left, y, bold); y -= 12;
  text(data.seller.name, left, y); y -= 12;
  text(data.seller.address, left, y); y -= 18;

  text("Buyer / Consignee", left, y, bold); y -= 12;
  text(data.buyer.name, left, y); y -= 12;
  text(data.buyer.address, left, y); y -= 18;

  label("Incoterms", data.incoterms, y);
  text("Currency", left+300, y, bold); text(data.currency, left+370, y); y -= 16;

  // Items table header
  y -= 6;
  line(left, y, right, y); y -= 14;
  text("Description", left, y, bold);
  text("HS Code", left+230, y, bold);
  text("Qty", left+330, y, bold);
  text("UOM", left+370, y, bold);
  text("Unit Price", left+420, y, bold);
  text("Amount", left+490, y, bold);
  y -= 10;
  line(left, y, right, y); y -= 12;

  const maxRows = 20;
  data.items.slice(0, maxRows).forEach(it => {
    text(it.desc, left, y);
    text(it.hsCode||"", left+230, y);
    text(it.qty, left+330, y);
    text(it.uom, left+370, y);
    text(it.unitPrice.toFixed(2), left+420, y);
    text((it.qty*it.unitPrice).toFixed(2), left+490, y);
    y -= 14;
  });

  y -= 6; line(left, y, right, y); y -= 14;

  text("Sub-Total", left+420, y, bold); text(data.totals.subTotal.toFixed(2), left+490, y); y -= 14;
  text("Freight", left+420, y, bold); text(data.totals.freight.toFixed(2), left+490, y); y -= 14;
  text("Insurance", left+420, y, bold); text(data.totals.insurance.toFixed(2), left+490, y); y -= 14;
  text("Grand Total", left+420, y, bold); text(data.totals.grandTotal.toFixed(2), left+490, y); y -= 18;
  line(left, y, right, y); y -= 14;

  if (data.notes){
    text("Notes:", left, y, bold); y -= 12;
    text(data.notes, left, y);
  }

  return await pdfDoc.save();
}
