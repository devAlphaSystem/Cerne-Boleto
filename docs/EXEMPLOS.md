# Exemplos

Receitas prontas para os usos mais comuns. A referência dos tipos está em
[API.md](API.md).

## Sumário

- [Extração básica](#extração-básica)
- [Escolhendo o perfil](#escolhendo-o-perfil)
- [Entradas em memória](#entradas-em-memória)
- [URLs e autenticação](#urls-e-autenticação)
- [Lote](#lote)
- [Cancelamento e prazo](#cancelamento-e-prazo)
- [Lendo o resultado com segurança](#lendo-o-resultado-com-segurança)
- [Tratamento de erros](#tratamento-de-erros)
- [Cobrança e arrecadação](#cobrança-e-arrecadação)
- [Campos visíveis](#campos-visíveis)
- [Validação sem documento](#validação-sem-documento)
- [Integrações](#integrações)

---

## Extração básica

```ts
import { extractBoletos } from "cerne-boleto";

const result = await extractBoletos("./boleto.pdf");

if (result.success) {
  console.log(result.bestMatch.digitableLine);
  console.log(result.bestMatch.formattedDigitableLine);
  console.log(result.bestMatch.layout); // "cobranca" | "arrecadacao"
}
```

Em CommonJS:

```js
const { extractBoletos } = require("cerne-boleto");

extractBoletos("./boleto.pdf").then((result) => {
  console.log(JSON.stringify(result, null, 2));
});
```

## Escolhendo o perfil

```ts
// Documento gerado por sistema, com texto nativo: o mais barato resolve.
const rapido = await extractBoletos("./boleto-do-banco.pdf", {
  performance: "fast",
});

// Foto de celular: vale gastar em rotações e OCR.
const foto = await extractBoletos("./foto-boleto.jpg", {
  performance: "accurate",
  passes: 5,
});

// Digitalização sem camada de texto: force o OCR mesmo no perfil rápido.
const digitalizado = await extractBoletos("./scan.pdf", {
  performance: "fast",
  ocr: "always",
});
```

`passes: 5` é o que habilita todas as rotações de 90 graus em imagem. Com
`passes` menor, apenas as primeiras receitas da lista do perfil são usadas.

## Entradas em memória

```ts
import { readFile } from "node:fs/promises";
import { extractBoletos } from "cerne-boleto";

const bytes = await readFile("./boleto.pdf");
const result = await extractBoletos(bytes); // Buffer é Uint8Array
```

Vindo de um upload HTTP, sem tocar no disco:

```ts
import { extractBoletos } from "cerne-boleto";

app.post("/boletos", async (request, reply) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request.raw) {
    chunks.push(chunk);
  }

  const result = await extractBoletos(Buffer.concat(chunks), {
    performance: "balanced",
    maxFileSizeBytes: 10 * 1024 * 1024,
    timeoutMs: 60_000,
  });

  return reply.code(result.success ? 200 : 422).send(result);
});
```

O formato é detectado pelos bytes, então não é preciso confiar no nome do
arquivo nem no `Content-Type` enviado pelo cliente.

## URLs e autenticação

```ts
// URL pública
const publico = await extractBoletos("https://documents.example.com/public/boleto.png");

// URL autenticada — requestHeaders existe apenas na API
const privado = await extractBoletos("https://documents.example.com/private/boleto.pdf", {
  requestHeaders: {
    Authorization: "Bearer <token>",
    "X-Tenant-Id": "acme",
  },
});
```

Os cabeçalhos sobrevivem a redirecionamentos de mesma origem e são descartados
quando a origem muda ou HTTPS cai para HTTP.

Quando a URL vem de terceiros, prefira baixar com um cliente sob seu controle e
entregar os bytes — o extrator não faz filtragem de SSRF:

```ts
const response = await fetch(urlValidadaPelaSuaPolitica, { redirect: "error" });
const bytes = new Uint8Array(await response.arrayBuffer());
const result = await extractBoletos(bytes);
```

## Lote

```ts
import { extractBoletoBatch } from "cerne-boleto";

const batch = await extractBoletoBatch(
  [
    "./boleto-a.pdf",
    "./foto-boleto.jpg",
    pngBuffer,
    {
      input: "https://documents.example.com/private/boleto-b.pdf",
      requestHeaders: { Authorization: "Bearer <token-exclusivo-da-origem>" },
    },
  ],
  { performance: "balanced", concurrency: 2 },
);

console.log(batch.summary);
// { inputsTotal: 4, inputsSucceeded: 3, inputsNotFound: 1, ... }
```

Correlacionando resultados às fontes originais — o JSON não devolve caminhos:

```ts
const fontes = ["./a.pdf", "./b.jpg", "./c.png"];
const batch = await extractBoletoBatch(fontes, { concurrency: 3 });

for (const { inputIndex, boleto } of batch.results) {
  console.log(`${fontes[inputIndex]} → ${boleto.digitableLine}`);
}
```

Isolando as entradas que falharam:

```ts
const problemas = batch.items.filter((item) => item.result.status !== "success");

for (const { inputIndex, result } of problemas) {
  console.warn(fontes[inputIndex], result.status, result.error?.code ?? "-");
}
```

O mesmo boleto presente em dois arquivos aparece duas vezes: não há deduplicação
entre fontes.

## Cancelamento e prazo

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);

const result = await extractBoletos("./documento-grande.pdf", {
  signal: controller.signal,
});

if (result.error?.code === "ABORTED") {
  console.warn("cancelado pelo chamador");
}
```

Prazo interno, sem `AbortController`:

```ts
const result = await extractBoletos("./documento.pdf", { timeoutMs: 15_000 });
// result.error?.code === "TIMEOUT" quando estoura
```

Ligando ao ciclo de vida de uma requisição HTTP:

```ts
app.post("/extrair", async (request, reply) => {
  const controller = new AbortController();
  request.raw.on("close", () => controller.abort());

  return extractBoletos(request.body.url, { signal: controller.signal });
});
```

No lote, um único `signal` cancela as extrações em andamento e impede o início
de novas entradas.

## Lendo o resultado com segurança

`status` e `success` respondem perguntas diferentes:

```ts
const result = await extractBoletos("./boleto.pdf");

switch (result.status) {
  case "success":
    // Varredura completa, ao menos um boleto validado.
    break;
  case "not_found":
    // Varredura completa, nada encontrado. Não é erro.
    break;
  case "partial":
    // Encontrou algo, mas a varredura foi truncada ou falhou no meio.
    // result.success pode ser true aqui.
    console.warn(result.warnings);
    break;
  case "error":
    console.error(result.error);
    break;
}
```

O `precisionScore` do topo é o **menor** entre os resultados. Para avaliar o
melhor resultado isoladamente, use o dele:

```ts
const confiavel = result.bestMatch !== null && result.bestMatch.precisionScore >= 0.9;
```

Exigindo confirmação por fontes independentes:

```ts
const corroborado = result.results.filter((boleto) => boleto.sources.length > 1);
```

Detectando truncamento por limite de páginas:

```ts
if (!result.metadata.complete) {
  console.warn("varredura incompleta:", result.warnings);
}
```

## Tratamento de erros

A promise não é rejeitada por falha esperada — tudo chega em `result.error`:

```ts
const result = await extractBoletos(entrada);

if (result.error) {
  switch (result.error.code) {
    case "PASSWORD_REQUIRED":
      return { motivo: "PDF protegido por senha" };
    case "FILE_TOO_LARGE":
    case "RESOURCE_LIMIT":
      return { motivo: "documento acima dos limites configurados" };
    case "TIMEOUT":
    case "ABORTED":
      return { motivo: "processamento interrompido", retentar: true };
    case "UNSUPPORTED_FORMAT":
      return { motivo: "envie PDF, JPEG ou PNG" };
    case "DOWNLOAD_ERROR":
      return { motivo: "não foi possível baixar a URL", retentar: true };
    default:
      return { motivo: result.error.message };
  }
}
```

Nenhum campo do resultado reproduz caminho, URL, string de consulta, buffer ou
valor de cabeçalho, então `result` pode ir para o log sem tratamento adicional.

## Cobrança e arrecadação

`components` é uma união discriminada por `layout` — o TypeScript estreita o
tipo sozinho:

```ts
const boleto = result.bestMatch;
if (boleto === null) return;

if (boleto.components.layout === "cobranca") {
  const { institutionCode, variant, dueDate, amountCents, dueDateAssumption } = boleto.components;

  console.log(institutionCode, variant); // "341" "bank-code"
  console.log(dueDate); // "2026-12-31" | null
  console.log(amountCents); // "10000" (string, em centavos)

  if (dueDateAssumption === "2025-reset-cycle") {
    console.warn("vencimento presumido pelo ciclo reiniciado; sem data impressa para confirmar");
  }
} else {
  const { segmentName, valueType, amountCents, referenceValue, organizationIdentifier } = boleto.components;

  console.log(segmentName); // "sanitation", "energy-and-gas", ...
  console.log(valueType); // "amount" | "reference"
  console.log(valueType === "amount" ? amountCents : referenceValue);
  console.log(organizationIdentifier);
}
```

Convertendo centavos sem perder precisão binária:

```ts
function centavosParaDecimal(centavos: string): string {
  const inteiro = centavos.slice(0, -2) || "0";
  const fracao = centavos.slice(-2).padStart(2, "0");
  return `${inteiro}.${fracao}`;
}
```

Boletos de cobrança com ISPB:

```ts
if (boleto.components.layout === "cobranca" && boleto.components.variant === "ispb") {
  console.log(boleto.components.ispb); // oito dígitos
  // fator de vencimento e valor não são codificados nessa variante
}
```

## Campos visíveis

Todo campo de `generalInfo` pode ser `null`. Ausência e conflito irresolvível
são representados da mesma forma:

```ts
const info = boleto.generalInfo;

console.log(info.institution?.value ?? "instituição não identificada");
console.log(info.beneficiary?.name?.value ?? "-");
console.log(info.beneficiary?.taxId?.value ?? "-"); // CPF/CNPJ sem pontuação
console.log(info.dueDate?.value ?? "-"); // "YYYY-MM-DD"
console.log(info.amount?.value ?? "-"); // decimal em string
```

Separando o que veio do código do que veio do papel:

```ts
const instituicao = info.institution;

if (instituicao?.sources.includes("encoded")) {
  // Resolvida pelo código do banco no catálogo embutido: mais confiável.
} else if (instituicao?.sources.includes("ocr")) {
  // Lida por OCR do rótulo impresso: confirme antes de automatizar.
}
```

Cruzando o vencimento impresso com o codificado:

```ts
const impresso = info.dueDate?.value ?? null;
const codificado = boleto.components.layout === "cobranca" ? boleto.components.dueDate : null;

if (impresso && codificado && impresso !== codificado) {
  console.warn("vencimento impresso diverge do codificado", { impresso, codificado });
}
```

Campos resolvidos por maioria têm pontuação limitada a `0.95` e geram um aviso
em `result.warnings`; heurísticas de arrecadação ficam limitadas a `0.9`.

## Validação sem documento

Os validadores são síncronos e não carregam PDF, canvas ou OCR:

```ts
import { validateBoletoCode } from "cerne-boleto";

const validacao = validateBoletoCode("00190.50095 40144.816069 06809.350314 3 37370000000100");

if (validacao.isValid) {
  console.log(validacao.barcode);
  console.log(validacao.layout); // "cobranca"
} else {
  for (const issue of validacao.issues) {
    console.error(issue.code, issue.message, issue.expected);
  }
}
```

Convertendo entre representações:

```ts
import { formatDigitableLine, toBarcode, toDigitableLine } from "cerne-boleto";

const barcode = toBarcode("00190.50095 40144.816069 06809.350314 3 37370000000100");
const linha = toDigitableLine(barcode);
const legivel = formatDigitableLine(barcode);
```

Essas três lançam `TypeError` para entrada não suportada — envolva em `try` se a
origem não for confiável:

```ts
function normalizarComSeguranca(valor: string): string | null {
  try {
    return toBarcode(valor);
  } catch {
    return null;
  }
}
```

Validando o que o usuário digitou, antes de chamar o extrator:

```ts
import { validateBoletoCode, BOLETO_ISSUE_CODES } from "cerne-boleto";

const validacao = validateBoletoCode(entradaDoFormulario);

if (!validacao.isValid) {
  const dvErrado = validacao.issues.some((issue) => issue.code === BOLETO_ISSUE_CODES.INVALID_GENERAL_CHECK_DIGIT || issue.code === BOLETO_ISSUE_CODES.INVALID_FIELD_CHECK_DIGIT);

  return dvErrado ? "Confira os dígitos: há erro de digitação." : "Formato de boleto não reconhecido.";
}
```

Calculando dígitos verificadores isoladamente:

```ts
import { calculateArrecadacaoModulo11CheckDigit, calculateCobrancaBarcodeCheckDigit, calculateModulo10CheckDigit } from "cerne-boleto";

calculateModulo10CheckDigit("001905009");
calculateCobrancaBarcodeCheckDigit("0019373700000001000500940144816060680935031"); // exige 43 dígitos
calculateArrecadacaoModulo11CheckDigit("12345678901");
```

## Integrações

### Fila de processamento com retentativa seletiva

```ts
const RETENTAVEIS = new Set(["DOWNLOAD_ERROR", "TIMEOUT", "PROCESSING_ERROR"]);

async function processar(job: { url: string; tentativas: number }) {
  const result = await extractBoletos(job.url, {
    performance: job.tentativas === 0 ? "balanced" : "accurate",
    passes: job.tentativas === 0 ? 2 : 5,
    timeoutMs: 120_000,
  });

  if (result.success) {
    return result;
  }

  if (result.error && RETENTAVEIS.has(result.error.code) && job.tentativas < 3) {
    throw new Error(`retentar: ${result.error.code}`);
  }

  return result; // not_found e erros definitivos não voltam para a fila
}
```

### Escalonando o esforço

```ts
async function extrairComEscalada(entrada: DocumentInput) {
  const barato = await extractBoletos(entrada, { performance: "fast" });
  if (barato.success) return barato;

  return extractBoletos(entrada, { performance: "accurate", passes: 5, ocr: "always" });
}
```

### Conferindo um boleto contra o esperado

```ts
function confere(result: ExtractionResult, esperado: { barcode: string; centavos: string }) {
  const boleto = result.results.find((item) => item.barcode === esperado.barcode);
  if (!boleto) return { ok: false, motivo: "código não encontrado no documento" };

  const centavos = boleto.components.layout === "cobranca" ? boleto.components.amountCents : boleto.components.amountCents;

  if (centavos !== esperado.centavos) {
    return { ok: false, motivo: `valor divergente: ${centavos} ≠ ${esperado.centavos}` };
  }

  return { ok: true, confianca: boleto.precisionScore };
}
```

Comparar `barcode` é mais robusto que comparar linhas digitáveis: as duas formas
convergem para o mesmo código de 44 dígitos.
