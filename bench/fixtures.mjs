import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas } from "@napi-rs/canvas";

const OUTPUT_DIRECTORY = fileURLToPath(new URL("./fixtures/", import.meta.url));

const PAGE_WIDTH = 1654;
const PAGE_HEIGHT = 2339;

function cobrancaCheckDigit(body) {
  let sum = 0;
  let weight = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += (body.charCodeAt(index) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const digit = 11 - remainder;
  return remainder === 0 || remainder === 1 || digit === 10 || digit === 11 ? 1 : digit;
}

function modulo10(body) {
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    const product = (body.charCodeAt(index) - 48) * multiplier;
    sum += product > 9 ? product - 9 : product;
    multiplier = multiplier === 2 ? 1 : 2;
  }
  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

function boletoBarcode() {
  const bank = "341";
  const currency = "9";
  const dueFactor = "9999";
  const amount = "0000123456";
  const freeField = "1234567890123456789012345";
  const checkDigit = cobrancaCheckDigit(`${bank}${currency}${dueFactor}${amount}${freeField}`);
  return `${bank}${currency}${checkDigit}${dueFactor}${amount}${freeField}`;
}

function boletoDigitableLine(barcode) {
  const freeField = barcode.slice(19);
  const firstField = `${barcode.slice(0, 4)}${freeField.slice(0, 5)}`;
  const secondField = freeField.slice(5, 15);
  const thirdField = freeField.slice(15, 25);
  return `${firstField}${modulo10(firstField)}${secondField}${modulo10(secondField)}${thirdField}${modulo10(thirdField)}${barcode.slice(4, 5)}${barcode.slice(5, 19)}`;
}

function formatDigitableLine(line) {
  return `${line.slice(0, 5)}.${line.slice(5, 10)} ${line.slice(10, 15)}.${line.slice(15, 21)} ${line.slice(21, 26)}.${line.slice(26, 32)} ${line.slice(32, 33)} ${line.slice(33)}`;
}

const ITF_PATTERNS = ["11221", "21112", "12112", "22111", "11212", "21211", "12211", "11122", "21121", "12121"];

const ITF_NARROW = 1;
const ITF_WIDE = 3;

function itfModules(digits) {
  const widths = [ITF_NARROW, ITF_NARROW, ITF_NARROW, ITF_NARROW];
  for (let index = 0; index < digits.length; index += 2) {
    const bars = ITF_PATTERNS[digits.charCodeAt(index) - 48];
    const spaces = ITF_PATTERNS[digits.charCodeAt(index + 1) - 48];
    for (let element = 0; element < 5; element += 1) {
      widths.push(bars[element] === "2" ? ITF_WIDE : ITF_NARROW, spaces[element] === "2" ? ITF_WIDE : ITF_NARROW);
    }
  }
  widths.push(ITF_WIDE, ITF_NARROW, ITF_NARROW);
  return widths;
}

function drawLinear(context, widths, x, y, unit, height) {
  let cursor = x;
  let isBar = true;
  for (const width of widths) {
    if (isBar) {
      context.fillStyle = "#000000";
      context.fillRect(Math.round(cursor), y, Math.round(width * unit), height);
    }
    cursor += width * unit;
    isBar = !isBar;
  }
}

function newPage() {
  const canvas = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  return { canvas, context };
}

function label(context, text, x, y, size = 22, bold = false) {
  context.fillStyle = "#000000";
  context.font = `${bold ? "bold " : ""}${size}px Arial`;
  context.fillText(text, x, y);
}

const BOLETO_ROWS = [
  ["Local de pagamento", "Pagavel em qualquer banco ate o vencimento"],
  ["Beneficiario", "CERNE SISTEMAS LTDA    CNPJ 11.222.333/0001-81"],
  ["Data do documento", "25/07/2026"],
  ["Numero do documento", "000012345"],
  ["Especie doc.", "DM"],
  ["Aceite", "N"],
  ["Data processamento", "25/07/2026"],
  ["Nosso numero", "123/45678901-2"],
  ["Uso do banco", "-"],
  ["Carteira", "109"],
  ["Especie", "R$"],
  ["Quantidade", "1"],
  ["Valor documento", "1.234,56"],
  ["Vencimento", "10/08/2026"],
  ["Agencia/Codigo do beneficiario", "1234 / 56789-0"],
  ["(-) Desconto / Abatimento", ""],
  ["(-) Outras deducoes", ""],
  ["(+) Mora / Multa", ""],
  ["(+) Outros acrescimos", ""],
  ["(=) Valor cobrado", "1.234,56"],
  ["Pagador", "EMPRESA EXEMPLO LTDA    CNPJ 11.222.333/0001-81"],
  ["Endereco", "RUA DAS FLORES, 1000 - CENTRO - SAO PAULO/SP - 01000-000"],
  ["Sacador/Avalista", ""],
  ["Instrucoes", "Apos o vencimento cobrar multa de 2% e juros de 1% ao mes."],
];

function boletoPage({ withBarcode = true, withLine = true } = {}) {
  const { canvas, context } = newPage();
  const barcode = boletoBarcode();
  const line = boletoDigitableLine(barcode);

  context.strokeStyle = "#000000";
  context.lineWidth = 2;
  context.strokeRect(90, 120, PAGE_WIDTH - 180, 1500);

  label(context, "341-7", 110, 175, 34, true);
  label(context, "Banco Itau Unibanco S.A.", 260, 175, 24);
  if (withLine) {
    label(context, formatDigitableLine(line), 560, 175, 27, true);
  }

  let y = 240;
  for (const [name, value] of BOLETO_ROWS) {
    label(context, name, 110, y, 18);
    label(context, value, 110, y + 30, 24);
    context.beginPath();
    context.moveTo(100, y + 46);
    context.lineTo(PAGE_WIDTH - 100, y + 46);
    context.stroke();
    y += 62;
  }

  if (withBarcode) {
    drawLinear(context, itfModules(barcode), 110, 1680, 2, 110);
  }
  label(context, "Autenticacao mecanica - Ficha de Compensacao", 110, 1860, 20);
  return { canvas, barcode, line };
}

function noisePage() {
  const { canvas, context } = newPage();
  label(context, "RELATORIO GERENCIAL DE MOVIMENTACAO", 110, 180, 34, true);
  let y = 260;
  for (let row = 0; row < 40; row += 1) {
    label(context, `Linha ${row + 1} - Centro de custo 1234 - Valor 9.876,54 - Ref 2026-07-25`, 110, y, 22);
    y += 40;
  }
  return canvas;
}

function degrade(sourceCanvas) {
  const small = createCanvas(Math.round(PAGE_WIDTH * 0.55), Math.round(PAGE_HEIGHT * 0.55));
  const smallContext = small.getContext("2d");
  smallContext.filter = "blur(1.5px)";
  smallContext.drawImage(sourceCanvas, 0, 0, small.width, small.height);

  const canvas = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const context = canvas.getContext("2d");
  context.drawImage(small, 0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  const imageData = context.getImageData(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  const data = imageData.data;
  let seed = 20260725;
  for (let offset = 0; offset < data.length; offset += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const noise = ((seed >> 16) % 41) - 20;
    data[offset] += noise;
    data[offset + 1] += noise;
    data[offset + 2] += noise;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function pdfFromObjects(objects) {
  const header = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1");
  const chunks = [header];
  const offsets = [0];
  let position = header.length;
  for (const [index, body] of objects.entries()) {
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"), Buffer.from("\nendobj\n", "latin1")]);
    offsets.push(position);
    chunks.push(object);
    position += object.length;
  }
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

function pdfStream(dictionary, data) {
  return Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);
}

function escapePdfText(text) {
  return text.replace(/([\\()])/gu, "\\$1");
}

function imagePdf(jpeg, width, height) {
  return pdfFromObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>", pdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpeg), pdfStream("", Buffer.from("q 595 0 0 842 0 0 cm /Im0 Do Q\n", "latin1"))]);
}

function textPdf(lines) {
  let content = "BT /F1 9 Tf 12 TL 40 800 Td\n";
  for (const line of lines) {
    content += `(${escapePdfText(line)}) Tj T*\n`;
  }
  content += "ET\n";
  return pdfFromObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", pdfStream("", Buffer.from(content, "latin1"))]);
}

function vectorPdf(lines, widths, barcode) {
  let content = "BT /F1 9 Tf 12 TL 40 800 Td\n";
  for (const line of lines) {
    content += `(${escapePdfText(line)}) Tj T*\n`;
  }
  content += "ET\n0 0 0 rg\n";
  let cursor = barcode.x;
  let isBar = true;
  for (const width of widths) {
    if (isBar) {
      content += `${cursor.toFixed(3)} ${barcode.y} ${(width * barcode.unit).toFixed(3)} ${barcode.height} re f\n`;
    }
    cursor += width * barcode.unit;
    isBar = !isBar;
  }
  return pdfFromObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", pdfStream("", Buffer.from(content, "latin1"))]);
}

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

function write(name, data) {
  writeFileSync(join(OUTPUT_DIRECTORY, name), data);
}

const boleto = boletoPage();
const boletoWithoutLine = boletoPage({ withLine: false });
const noise = noisePage();

const boletoTextLines = ["Banco Itau Unibanco S.A.   341-7", `Linha digitavel: ${formatDigitableLine(boleto.line)}`, "Beneficiario: CERNE SISTEMAS LTDA   CNPJ 11.222.333/0001-81", "Pagador: EMPRESA EXEMPLO LTDA   CNPJ 11.222.333/0001-81", "Vencimento: 10/08/2026    Valor do documento: 1.234,56", "Nosso numero: 123/45678901-2   Carteira: 109   Agencia/Codigo: 1234 / 56789-0"];
const vectorBarcode = { x: 40, y: 60, unit: 0.72, height: 37 };

write("boleto.png", boleto.canvas.toBuffer("image/png"));
write("boleto.jpg", boleto.canvas.toBuffer("image/jpeg", 82));
write("boleto-blur.jpg", degrade(boleto.canvas).toBuffer("image/jpeg", 45));
write("boleto-scan.pdf", imagePdf(boleto.canvas.toBuffer("image/jpeg", 82), PAGE_WIDTH, PAGE_HEIGHT));
write("boleto-scan-barcode-only.pdf", imagePdf(boletoWithoutLine.canvas.toBuffer("image/jpeg", 82), PAGE_WIDTH, PAGE_HEIGHT));
write("boleto-native.pdf", textPdf(boletoTextLines));
write("boleto-vector.pdf", vectorPdf(boletoTextLines, itfModules(boleto.barcode), vectorBarcode));
write("boleto-vector-barcode-only.pdf", vectorPdf(["Ficha de compensacao"], itfModules(boleto.barcode), vectorBarcode));
write("nomatch.jpg", noise.toBuffer("image/jpeg", 82));
write("nomatch-scan.pdf", imagePdf(noise.toBuffer("image/jpeg", 82), PAGE_WIDTH, PAGE_HEIGHT));

console.log(`Código de barras: ${boleto.barcode}`);
console.log(`Linha digitável:  ${boleto.line}`);
console.log(`Fixtures geradas em ${OUTPUT_DIRECTORY}`);
