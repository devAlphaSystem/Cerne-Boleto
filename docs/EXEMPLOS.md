# Exemplos

Os exemplos usam ESM e TypeScript, mas as mesmas funções estão disponíveis pelo export CommonJS.

## Extrair de um arquivo local

```ts
import { extractBoletos } from "cerne-boleto";

const result = await extractBoletos("./documentos/boleto.pdf");

switch (result.status) {
  case "success":
    console.log(result.bestMatch?.formattedDigitableLine);
    break;
  case "not_found":
    console.log("Documento processado, sem boleto válido.");
    break;
  case "partial":
    console.log("Resultados parciais:", result.results);
    console.warn(result.warnings, result.error);
    break;
  case "error":
    console.error(result.error?.code, result.error?.message);
    break;
}
```

## Ler JPEG ou PNG

```ts
const imageResult = await extractBoletos("./captura/boleto.jpg", {
  performance: "accurate",
  ocr: "fallback",
  passes: 3,
});

console.log(imageResult.metadata.inputFormat); // "jpeg"
console.log(imageResult.metadata.sourceImageWidth);
console.log(imageResult.metadata.sourceImageHeight);
```

Imagens são tratadas como documentos de uma página. A orientação EXIF de JPEG é aplicada durante a renderização.

## Extrair de bytes em memória

```ts
import { readFile } from "node:fs/promises";
import { extractBoletos } from "cerne-boleto";

const bytes = await readFile("./boleto.png");
const result = await extractBoletos(bytes, {
  maxFileSizeBytes: 15 * 1024 * 1024,
});
```

O carregador copia a entrada em memória antes do processamento. O formato continua sendo identificado pelos bytes.

## Baixar uma URL autenticada

```ts
const result = await extractBoletos("https://documents.example/boleto.pdf", {
  requestHeaders: {
    authorization: "Bearer <token-temporario>",
    "x-request-id": "operacao-123",
  },
  maxFileSizeBytes: 20 * 1024 * 1024,
  timeoutMs: 60_000,
});
```

Use `requestHeaders` apenas com URL HTTP(S). Credenciais embutidas na URL são rejeitadas. Em redirecionamento para outra origem ou downgrade de HTTPS, os cabeçalhos fornecidos pelo chamador são removidos.

O carregador aceita no máximo cinco redirecionamentos e aplica o limite de bytes tanto ao `Content-Length` quanto ao corpo recebido.

## Cancelar uma extração

```ts
const controller = new AbortController();

const extraction = extractBoletos("https://documents.example/boleto.pdf", {
  signal: controller.signal,
  timeoutMs: 0,
});

setTimeout(() => controller.abort(), 5_000);

const result = await extraction;
if (result.error?.code === "ABORTED") {
  console.log("Extração cancelada pelo chamador.");
}
```

`timeoutMs` usa o mesmo mecanismo interno de parada, mas retorna código `TIMEOUT`. O cancelamento é cooperativo: download e checkpoints do pipeline recebem o sinal, enquanto uma operação nativa ou OCR já em andamento pode devolver o controle apenas ao final da etapa corrente.

## Encerrar após a primeira evidência

```ts
const result = await extractBoletos("./arquivo-com-muitos-boletos.pdf", {
  stopAfterFirst: true,
  performance: "balanced",
});
```

Essa opção reduz trabalho, mas não procura todos os boletos do documento. Quando a primeira evidência válida é encontrada, `metadata.complete` representa o cumprimento dessa política de término, não a varredura integral do arquivo.

## Processar um lote

```ts
import { extractBoletoBatch } from "cerne-boleto";

const batch = await extractBoletoBatch(
  [
    "./boletos/a.pdf",
    "./boletos/b.png",
    {
      input: "https://documents.example/c.pdf",
      requestHeaders: { authorization: "Bearer <token-temporario>" },
    },
  ],
  {
    concurrency: 2,
    performance: "balanced",
    signal: AbortSignal.timeout(120_000),
  },
);

for (const item of batch.items) {
  console.log(item.inputIndex, item.result.status, item.result.results.length);
}

for (const match of batch.results) {
  console.log(match.inputIndex, match.boleto.formattedDigitableLine);
}
```

Cabeçalhos remotos pertencem a cada descritor; não existe `requestHeaders` global no lote. `concurrency` aceita de 1 a 8.

## Consumir informações gerais com proveniência

```ts
const boleto = result.bestMatch;

if (boleto !== null) {
  const amount = boleto.generalInfo.amount;
  if (amount !== null) {
    console.log({
      value: amount.value, // por exemplo, "1234.56"
      confidence: amount.precisionScore,
      pages: amount.pages,
      sources: amount.sources, // encoded, pdf-text e/ou ocr
    });
  }

  console.log(boleto.generalInfo.beneficiary?.name?.value);
  console.log(boleto.generalInfo.beneficiary?.taxId?.value);
}
```

Datas normalizadas usam `YYYY-MM-DD`; valores monetários usam ponto decimal, sem símbolo de moeda.

## Validar uma linha digitável

```ts
import { validateBoletoCode } from "cerne-boleto";

const validation = validateBoletoCode("00190.50095 40144.816069 06809.350314 3 37370000000100");

if (validation.isValid) {
  console.log(validation.barcode);
  console.log(validation.components?.layout);
} else {
  for (const issue of validation.issues) {
    console.error(issue.code, issue.field, issue.actual, issue.expected);
  }
}
```

`validateBoletoCode` não lança para conteúdo inválido. Isso permite exibir todos os problemas encontrados de uma vez.

## Converter e decompor um código

```ts
import { formatDigitableLine, parseBoletoCode, toBarcode, toDigitableLine } from "cerne-boleto";

const formatted = "00190.50095 40144.816069 06809.350314 3 37370000000100";
const barcode = toBarcode(formatted);
const line = toDigitableLine(barcode);
const display = formatDigitableLine(barcode);
const components = parseBoletoCode(line);

console.log({ barcode, line, display, components });
```

Os helpers de conversão e parsing lançam `TypeError` quando a forma não tem 44, 47 ou 48 dígitos numéricos após remover somente espaços, pontos e hífens. Use validação antes deles quando a entrada vier diretamente de um usuário.

## Calcular dígitos verificadores

```ts
import { calculateArrecadacaoModulo11CheckDigit, calculateCobrancaBarcodeCheckDigit, calculateModulo10CheckDigit } from "cerne-boleto";

const fieldDigit = calculateModulo10CheckDigit("001905009");
const barcodeDigit = calculateCobrancaBarcodeCheckDigit("0019373700000001000500940144816060680935031");
const collectionDigit = calculateArrecadacaoModulo11CheckDigit("12345678901");
```

## CommonJS

```js
const { extractBoletos } = require("cerne-boleto");

async function main() {
  const result = await extractBoletos("./boleto.pdf");
  console.log(result.status);
}

main().catch(console.error);
```

## Ajuste gradual de precisão

Comece com o padrão `balanced`. Se um documento válido retornar `not_found`:

1. confirme que os bytes são PDF, JPEG ou PNG e que o documento não está protegido;
2. confira `metadata.pagesProcessed`, `pagesRendered` e `ocrPages`;
3. teste `ocr: "always"` quando a linha estiver somente como imagem;
4. aumente `passes` ou use `accurate` para fotos rotacionadas/degradadas;
5. verifique se `maxPages`, prazo ou limites de pixels estão truncando o trabalho;
6. melhore a resolução, o enquadramento e o contraste do documento de origem.

Não aumente limites de arquivo e pixels sem considerar memória, CPU e o risco de entradas não confiáveis. Em integrações expostas, valide URLs controladas pelo usuário, restrinja o acesso de rede e isole o processamento com limites externos de tempo e recursos.
