# API

Referência completa da superfície pública de `cerne-boleto`. Para exemplos
executáveis, veja [EXEMPLOS.md](EXEMPLOS.md); para a linha de comando, veja
[CLI.md](CLI.md).

## Superfície exportada

```ts
import {
  // Extração
  extractBoletos,
  extractBoletoBatch,
  // Validação e conversão
  validateBoletoCode,
  parseBoletoCode,
  toBarcode,
  toDigitableLine,
  formatDigitableLine,
  calculateModulo10CheckDigit,
  calculateCobrancaBarcodeCheckDigit,
  calculateArrecadacaoModulo11CheckDigit,
  BOLETO_ISSUE_CODES,
} from "cerne-boleto";
```

Tudo o mais é interno. `ResolvedOptions`, `RenderRecipe`, `InvalidOptionsError`,
`ExtractionFailure` e os módulos de `document/`, `pdf/`, `recognition/`,
`candidates/` e `scoring/` não fazem parte do contrato público e podem mudar sem
aviso.

---

## Extração

### `extractBoletos(input, options?)`

```ts
function extractBoletos(input: DocumentInput, options?: ExtractOptions): Promise<ExtractionResult>;
```

Extrai boletos validados de uma única fonte. **A promise não é rejeitada por
falha de processamento**: erros esperados chegam em `result.error` com um
`ExtractionErrorCode` estável. Apenas defeitos de programação fora do contrato
podem escapar.

`input` aceita:

| Forma                      | Observação                                            |
| -------------------------- | ----------------------------------------------------- |
| `string` com caminho local | Caminho de arquivo resolvido pelo sistema de arquivos |
| `string` com URL           | Somente `http://` e `https://` completos              |
| `ArrayBuffer`              | Bytes em memória                                      |
| `Uint8Array` / `Buffer`    | Bytes em memória (`Buffer` é um `Uint8Array`)         |

O formato é decidido pela assinatura real dos bytes — PDF, JPEG ou PNG.
Extensão do arquivo e `Content-Type` da resposta não influenciam a aceitação.

### `extractBoletoBatch(inputs, options?)`

```ts
function extractBoletoBatch(inputs: readonly BoletoBatchInput[], options?: BatchExtractOptions): Promise<BatchExtractionResult>;
```

Processa várias fontes com concorrência limitada, preservando a ordem das
entradas no resultado. Também não rejeita: falhas de lote e falhas por fonte
aparecem no envelope retornado.

Cada elemento de `inputs` é um `DocumentInput` direto ou um descritor:

```ts
interface BoletoBatchSourceDescriptor {
  input: DocumentInput;
  requestHeaders?: Readonly<Record<string, string>>;
}
```

Os cabeçalhos pertencem a **uma** entrada. Não existe `requestHeaders` global no
lote, o que impede que a credencial de uma origem vaze para outra.

---

## Opções

### `ExtractOptions`

| Opção                  | Tipo                                 | Padrão              | Faixa aceita               |
| ---------------------- | ------------------------------------ | ------------------- | -------------------------- |
| `performance`          | `"fast" \| "balanced" \| "accurate"` | `"balanced"`        | —                          |
| `passes`               | `number`                             | do perfil           | `1..5`                     |
| `ocr`                  | `"never" \| "fallback" \| "always"`  | do perfil           | —                          |
| `maxPages`             | `number`                             | do perfil           | `1..10000`                 |
| `maxFileSizeBytes`     | `number`                             | `31457280` (30 MiB) | `1..1073741824` (1 GiB)    |
| `maxPixelsPerPage`     | `number`                             | do perfil           | `250000..100000000`        |
| `maxSourceImagePixels` | `number`                             | do perfil           | `250000..200000000`        |
| `timeoutMs`            | `number`                             | do perfil           | `0..3600000` (`0` desliga) |
| `stopAfterFirst`       | `boolean`                            | `false`             | —                          |
| `requestHeaders`       | `Readonly<Record<string,string>>`    | nenhum              | somente com URL            |
| `signal`               | `AbortSignal`                        | nenhum              | —                          |

Valores fora da faixa produzem `error.code === "INVALID_OPTIONS"`. Os limites
são conferidos com `Number.isInteger`, então valores fracionários são recusados.

### Perfis de desempenho

| Perfil     | `passes` | `ocr`      | `maxPages` | `maxPixelsPerPage` | `maxSourceImagePixels` | `timeoutMs` |
| ---------- | -------- | ---------- | ---------- | ------------------ | ---------------------- | ----------- |
| `fast`     | 1        | `never`    | 10         | 8.000.000          | 40.000.000             | 30.000      |
| `balanced` | 2        | `fallback` | 30         | 12.000.000         | 60.000.000             | 120.000     |
| `accurate` | 3        | `fallback` | 50         | 20.000.000         | 100.000.000            | 300.000     |

O perfil define apenas os padrões. Qualquer opção informada explicitamente
prevalece — `{ performance: "fast", ocr: "always" }` é uma combinação válida.

### `requestHeaders`

Aceito somente quando `input` é uma URL HTTP/HTTPS e somente com valores string.
Nomes são normalizados para minúsculas e validados com `validateHeaderName` /
`validateHeaderValue` do Node.js. São recusados:

- nomes duplicados quando comparados sem diferenciar maiúsculas;
- objetos com protótipo diferente de `Object.prototype` ou `null`;
- os cabeçalhos reservados pelo componente de download:

```text
accept-encoding, connection, content-length, expect, host, if-range,
keep-alive, proxy-connection, range, te, trailer, transfer-encoding, upgrade
```

### `BatchExtractOptions`

```ts
type BatchExtractOptions = Omit<ExtractOptions, "requestHeaders" | "signal"> & {
  concurrency?: number; // 1..8, padrão 1
  signal?: AbortSignal; // único para o lote inteiro
};
```

O `signal` do lote cancela cooperativamente as extrações em andamento e impede
o início de novas entradas.

---

## Resultado de uma fonte

```ts
interface ExtractionResult {
  status: "success" | "not_found" | "partial" | "error";
  success: boolean;
  precisionScore: number;
  bestMatch: ExtractedBoleto | null;
  results: ExtractedBoleto[];
  metadata: ExtractionMetadata;
  warnings: string[];
  error: ExtractionErrorInfo | null;
}
```

### Como `status` é decidido

| Condição                                                | `status`      |
| ------------------------------------------------------- | ------------- |
| Houve erro terminal e nenhum boleto foi validado        | `"error"`     |
| Houve erro terminal mas ao menos um boleto foi validado | `"partial"`   |
| A varredura não completou (ex.: corte por `maxPages`)   | `"partial"`   |
| Varredura completa, ao menos um boleto validado         | `"success"`   |
| Varredura completa, nenhum boleto validado              | `"not_found"` |

`success` é independente de `status`: vale `true` sempre que `results` não está
vazio, inclusive em `"partial"`.

`precisionScore` no topo é **conservador** — corresponde à **menor** pontuação
entre os itens de `results`, não à do `bestMatch`. Quando `results` está vazio,
vale `0`.

### `ExtractedBoleto`

```ts
interface ExtractedBoleto {
  barcode: string; // canônico, 44 dígitos
  digitableLine: string; // canônico, 47 ou 48 dígitos, sem formatação
  formattedDigitableLine: string; // apresentação canônica com pontos e espaços
  layout: "cobranca" | "arrecadacao";
  isValid: true; // literal: só entra em results o que é válido
  precisionScore: number; // 0..1
  pages: number[]; // 1-based; imagens sempre [1]
  sources: ExtractionSource[];
  occurrences: number;
  components: BoletoComponents;
  generalInfo: BoletoGeneralInfo;
}
```

`isValid` é o literal `true`, não `boolean`: um boleto que não passe
integralmente por formato, semântica e dígitos verificadores nunca entra em
`results`.

`ExtractionSource` é `"pdf-text" | "pdf-text-reconstructed" | "itf" | "ocr"`.

`occurrences` conta evidências físicas consolidadas. Filtros, escalas e rotações
aplicados aos mesmos pixels não viram ocorrências novas; ITF e OCR permanecem
fontes independentes. Dentro de um documento, a deduplicação usa o código de
barras canônico de 44 dígitos, então a linha digitável e o ITF correspondentes
não geram dois resultados.

### `ExtractionMetadata`

| Campo                  | Significado                                                            |
| ---------------------- | ---------------------------------------------------------------------- |
| `performance`          | Perfil resolvido                                                       |
| `ocrMode`              | Modo de OCR resolvido                                                  |
| `inputFormat?`         | `"pdf"`, `"jpeg"` ou `"png"`; ausente se a falha antecede a detecção   |
| `passesRequested`      | Passagens visuais configuradas                                         |
| `passesUsed`           | Passagem mais profunda efetivamente alcançada                          |
| `pagesTotal`           | Páginas declaradas pelo documento; sempre `1` em imagem                |
| `pagesProcessed`       | Páginas cuja etapa de texto nativo foi executada                       |
| `pagesRendered`        | Páginas distintas rasterizadas                                         |
| `renderAttempts?`      | Renderizações pedidas, incluindo reaproveitamento de superfície pronta |
| `ocrPages`             | Páginas distintas submetidas ao OCR                                    |
| `fileSizeBytes`        | Bytes da fonte carregada                                               |
| `sourceImageWidth?`    | Largura decodificada original (somente JPEG/PNG)                       |
| `sourceImageHeight?`   | Altura decodificada original (somente JPEG/PNG)                        |
| `maxPixelsPerPage`     | Limite resolvido por página renderizada                                |
| `maxSourceImagePixels` | Limite resolvido da imagem de origem                                   |
| `durationMs`           | Tempo total decorrido                                                  |
| `complete`             | `false` quando houve erro ou truncamento por `maxPages`                |
| `confidenceVersion`    | Literal `"1.2.0"` — versão do contrato de pontuação                    |

Fixe `confidenceVersion` se o seu sistema depende de limiares numéricos: uma
mudança nesse valor sinaliza que as pontuações foram recalibradas.

### `ExtractionErrorInfo`

```ts
interface ExtractionErrorInfo {
  code: ExtractionErrorCode;
  message: string;
}
```

| Código               | Quando ocorre                                           |
| -------------------- | ------------------------------------------------------- |
| `INVALID_INPUT`      | Entrada não é caminho, URL aceita nem bytes válidos     |
| `FILE_NOT_FOUND`     | Caminho local inexistente ou ilegível                   |
| `FILE_TOO_LARGE`     | Excede `maxFileSizeBytes` (declarado ou recebido)       |
| `DOWNLOAD_ERROR`     | Falha de rede, HTTP ou excesso de redirecionamentos     |
| `INVALID_OPTIONS`    | Opção fora da faixa aceita ou cabeçalho recusado        |
| `INVALID_PDF`        | Bytes de PDF corrompidos ou não abríveis                |
| `UNSUPPORTED_FORMAT` | Assinatura de bytes fora de PDF, JPEG e PNG             |
| `INVALID_IMAGE`      | JPEG/PNG malformado ou fora dos limites de dimensão     |
| `PASSWORD_REQUIRED`  | PDF criptografado; o pacote não oferece opção de senha  |
| `TIMEOUT`            | `timeoutMs` esgotado                                    |
| `ABORTED`            | `signal` disparado                                      |
| `RESOURCE_LIMIT`     | Limite de pixels, texto ou recurso interno atingido     |
| `PROCESSING_ERROR`   | Falha inesperada já convertida em resultado estruturado |

Nem `message` nem qualquer outro campo reproduzem caminhos, URLs, strings de
consulta, buffers ou valores de cabeçalho.

---

## Resultado de lote

```ts
interface BatchExtractionResult {
  status: ExtractionStatus;
  success: boolean;
  precisionScore: number;
  bestMatch: BatchMatchedBoleto | null;
  results: BatchMatchedBoleto[];
  metadata: ExtractionMetadata;
  items: BatchExtractionItem[];
  summary: BatchExtractionSummary;
  warnings: string[];
  error: ExtractionErrorInfo | null;
}
```

`BatchMatchedBoleto` é `{ inputIndex: number; boleto: ExtractedBoleto }` e
`BatchExtractionItem` é `{ inputIndex: number; result: ExtractionResult }`.
`inputIndex` é a posição zero-based na array original — é o único vínculo com a
fonte, já que caminhos, URLs e buffers não são reproduzidos.

### `status` do lote

| Condição                                                      | `status`      |
| ------------------------------------------------------------- | ------------- |
| Há boletos e nenhuma entrada parcial ou com erro              | `"success"`   |
| Há boletos e existe ao menos uma entrada parcial ou com erro  | `"partial"`   |
| Sem boletos, com ao menos uma entrada parcial                 | `"partial"`   |
| Sem boletos e sem parciais, com ao menos uma entrada com erro | `"error"`     |
| Sem boletos, todas as varreduras completas                    | `"not_found"` |

Quando a validação do próprio lote falha (por exemplo, `concurrency` inválida),
`items` volta vazio e `summary.inputsFailed` conta **todas** as entradas.

### `BatchExtractionSummary`

```ts
interface BatchExtractionSummary {
  inputsTotal: number;
  inputsSucceeded: number; // itens com status "success"
  inputsNotFound: number;
  inputsPartial: number;
  inputsFailed: number; // itens com status "error"
  boletosFound: number;
  concurrency: number;
  durationMs: number;
}
```

`metadata` do lote consolida páginas, bytes, renderizações e OCR de todas as
entradas. `sourceImageWidth` e `sourceImageHeight` não aparecem no metadado
agregado de um lote misto. `warnings` do lote prefixa cada aviso com
`Input <índice>:`.

Não há deduplicação entre arquivos: o mesmo boleto presente em duas fontes
aparece duas vezes, com `inputIndex` distintos.

---

## `components`: decomposição do código

`components` é uma união discriminada por `layout`.

### `CobrancaBoletoComponents` (`layout: "cobranca"`)

| Campo                                                  | Conteúdo                                          |
| ------------------------------------------------------ | ------------------------------------------------- |
| `normalizedValue`                                      | Entrada sem separadores de apresentação           |
| `representation`                                       | `"barcode"` ou `"digitable-line"`                 |
| `barcode` / `digitableLine` / `formattedDigitableLine` | Formas canônicas                                  |
| `variant`                                              | `"bank-code"` ou `"ispb"`                         |
| `institutionCode`                                      | Três dígitos                                      |
| `currencyCode`                                         | Um dígito                                         |
| `ispb` / `ispbField`                                   | Preenchidos apenas na variante `ispb`             |
| `dueDateFactor`                                        | Quatro dígitos na variante `bank-code`            |
| `dueDate`                                              | `YYYY-MM-DD` selecionada, ou `null`               |
| `dueDateCandidates`                                    | Todas as datas compatíveis com o fator            |
| `dueDateAssumption`                                    | `"2025-reset-cycle"` quando o ciclo foi presumido |
| `amountField` / `amountCents`                          | Valor codificado; centavos como **string**        |
| `freeField`                                            | 25 dígitos                                        |
| `generalCheckDigit` / `expectedGeneralCheckDigit`      | DV geral presente e calculado                     |
| `fieldCheckDigits` / `expectedFieldCheckDigits`        | Trinca de DVs de campo                            |

Na variante `bank-code`, `currencyCode` deve ser `9` (Real). Na variante `ispb`
(instituição `988`), a posição 4 deve ser `0` e o bloco seguinte contém seis
zeros seguidos de um ISPB de oito dígitos diferente de zero; fator e valor não
são inferidos desse bloco.

**Fator de vencimento.** O fator `1000` passou a representar `2025-02-22` no
ciclo reiniciado, mas fatores a partir de `1000` também podem corresponder a uma
data do ciclo histórico. Quando existe data impressa geometricamente associada
ao boleto, ela é cruzada com `dueDateCandidates`. Sem confirmação impressa, o
ciclo reiniciado é adotado e registrado em `dueDateAssumption`. Uma data externa
conflitante não substitui silenciosamente o que está codificado.

### `ArrecadacaoBoletoComponents` (`layout: "arrecadacao"`)

| Campo                                                   | Conteúdo                                     |
| ------------------------------------------------------- | -------------------------------------------- |
| `productCode`                                           | Deve ser `8`                                 |
| `segmentCode` / `segmentName`                           | Dígito e categoria normalizada               |
| `valueIdentifier` / `valueType`                         | Identificador e `"amount"` ou `"reference"`  |
| `checkDigitAlgorithm`                                   | `"modulo10"` ou `"modulo11"`                 |
| `valueField` / `amountCents` / `referenceValue`         | Campo de 11 dígitos e sua interpretação      |
| `organizationIdentifier` / `organizationIdentifierType` | Empresa/órgão e como lê-lo                   |
| `freeField`                                             | Restante dependente do segmento              |
| `dueDate`                                               | Data no início do campo livre, quando válida |

Segmentos aceitos: `1`, `2`, `3`, `4`, `5`, `6`, `7` e `9`.
`segmentName` mapeia para `city-government`, `sanitation`, `energy-and-gas`,
`telecommunications`, `government-agencies`, `payment-slips-and-similar`,
`traffic-fines` e `bank-exclusive`.
Identificadores de valor: `6` e `8` indicam valor efetivo; `7` e `9`, referência.
`6` e `7` usam módulo 10; `8` e `9`, módulo 11.
`organizationIdentifierType` pode ser `febraban-code`, `cnpj-root` ou `bank-code`.

---

## `generalInfo`: campos visíveis

```ts
interface BoletoGeneralInfo {
  institution: ExtractedBoletoField | null;
  beneficiary: BoletoPartyInfo | null;
  finalBeneficiary: BoletoPartyInfo | null;
  payer: BoletoPartyInfo | null;
  dueDate: ExtractedBoletoField | null;
  amount: ExtractedBoletoField | null;
  ourNumber: ExtractedBoletoField | null;
  documentNumber: ExtractedBoletoField | null;
  documentDate: ExtractedBoletoField | null;
}

interface BoletoPartyInfo {
  name: ExtractedBoletoField | null;
  taxId: ExtractedBoletoField | null;
}

interface ExtractedBoletoField<TValue extends string = string> {
  value: TValue; // normalizado
  rawValue: string; // como aparecia na origem
  precisionScore: number;
  pages: number[];
  sources: BoletoFieldSource[]; // "encoded" | "pdf-text" | "ocr"
}
```

Normalizações: datas em `YYYY-MM-DD`; valores monetários como string decimal sem
símbolo de moeda; CPF e CNPJ sem pontuação, com CNPJ numérico ou alfanumérico.
Strings são preservadas para não perder zeros à esquerda nem introduzir
arredondamento binário.

**Associação geométrica.** Linhas do texto nativo e blocos do OCR preservam
coordenadas. Com mais de um boleto na página, o campo visível é atribuído ao
boleto geometricamente mais próximo. Texto sem posição só vira informação da
página inteira quando existe exatamente um boleto nela. Rótulos em coluna são
resolvidos pela posição: mesma linha primeiro, célula abaixo em seguida.
Rótulos dentro de frases padrão como "uso do banco" não criam campos.

**Instituição.** Na cobrança com variante bancária, o nome vem do código
codificado através de um catálogo embutido de 26 emissores comuns — nesse caso
`sources` contém `"encoded"`. Códigos fora do catálogo caem no rótulo impresso.

**Conflitos.** Valores repetidos que diferem apenas por truncamento de quebra de
linha são consolidados no mais completo. Quando valores realmente distintos
competem, uma maioria estrita resolve o campo de forma determinística, a
pontuação fica limitada a `0.95` e um aviso é emitido. Sem maioria, o campo
permanece `null`.

**Heurística de arrecadação.** Em contas de arrecadação, blocos não rotulados de
nome e endereço ancorados por um CEP também identificam as partes: o bloco com
CNPJ válido ou sufixo societário nomeia o beneficiário, os demais nomeiam o
pagador. Esses campos têm pontuação máxima de `0.9`, nunca são usados em
cobrança e cedem ao rótulo correspondente quando ele existe.

Quando o nome impresso de uma parte contém CPF ou CNPJ com DV válido, o
documento é separado do nome e atribuído ao `taxId` da mesma parte.

---

## Pontuação

`precisionScore` é determinístico e versionado por `metadata.confidenceVersion`.
Texto nativo, texto reconstruído, ITF e OCR partem de bases diferentes; fontes
independentes que concordam elevam a confiança. **Não é uma probabilidade
calibrada estatisticamente.** Meça precisão e recall em um corpus próprio
representativo antes de fixar um limiar de automação.

Todo item de `results` já passou pela validação integral do código. Campos
visíveis nunca criam um boleto: um beneficiário ou um valor isolado não produz
resultado.

---

## Validação e conversão independentes

Estas funções são síncronas, puras e não carregam PDF, canvas ou OCR.

### `validateBoletoCode(value)`

```ts
function validateBoletoCode(value: string): BoletoValidation;
```

Não lança para conteúdo inválido — devolve estrutura com `issues`. Aceita 44, 47
ou 48 dígitos com espaços, pontos e hífens.

```ts
interface BoletoValidation {
  isValid: boolean;
  normalizedValue: string;
  layout: BoletoLayout | null;
  representation: BoletoRepresentation | null;
  barcode: string | null;
  digitableLine: string | null;
  formattedDigitableLine: string | null;
  components: BoletoComponents | null;
  expectedGeneralCheckDigit: number | null;
  expectedFieldCheckDigits: BoletoFieldCheckDigits | null;
  issues: BoletoIssue[];
}

interface BoletoIssue {
  code: BoletoIssueCode;
  message: string;
  field?: "general" | "field-1" | "field-2" | "field-3" | "field-4";
  actual?: string | number;
  expected?: string | number;
}
```

`BOLETO_ISSUE_CODES` enumera os códigos estáveis:

```text
INVALID_FORMAT              INVALID_ISPB
INVALID_PRODUCT             INVALID_SEGMENT
INVALID_INSTITUTION_CODE    INVALID_VALUE_IDENTIFIER
INVALID_CURRENCY_CODE       INVALID_FIELD_CHECK_DIGIT
INVALID_ISPB_CONFIGURATION  INVALID_GENERAL_CHECK_DIGIT
```

### `parseBoletoCode(value)`

```ts
function parseBoletoCode(value: string): BoletoComponents;
```

Decompõe uma representação estruturalmente suportada. **Lança `TypeError`** se o
formato não for 44/47/48 dígitos numéricos. Não decide validade — os DVs vêm
como presentes e esperados, sem julgamento. Não substitui `validateBoletoCode`.

### Conversões

```ts
function toBarcode(value: string): string; // → 44 dígitos
function toDigitableLine(value: string): string; // → 47 ou 48 dígitos
function formatDigitableLine(value: string): string; // → apresentação canônica
```

Todas lançam `TypeError` para entrada não suportada. `toDigitableLine` e
`formatDigitableLine` também lançam quando um código de barras de arrecadação
usa identificador de valor fora de `6`, `7`, `8` e `9`, porque o algoritmo de DV
de campo ficaria indefinido. As conversões preservam strings e zeros à esquerda.

### Dígitos verificadores

```ts
function calculateModulo10CheckDigit(body: string): number; // 0..9
function calculateCobrancaBarcodeCheckDigit(body: string): number; // 1..9
function calculateArrecadacaoModulo11CheckDigit(body: string): number; // 0..9
```

Cada função recebe o corpo **sem** o DV que será calculado.
`calculateCobrancaBarcodeCheckDigit` exige exatamente 43 dígitos — o código de
barras com a posição do DV geral removida — e lança `TypeError` caso contrário.
As outras duas exigem corpo numérico não vazio.

> Passar nos DVs confirma consistência do código com o layout. Não confirma
> autenticidade, existência, quitação, situação cadastral ou legitimidade. O
> pacote não consulta bancos e não é ferramenta antifraude.

---

## Documentos remotos

Somente URLs completas `http://` e `https://`, apontando diretamente para bytes
de PDF, JPEG ou PNG. Páginas HTML, formulários de login e navegação por cookies
estão fora do escopo.

O download segue respostas 301, 302, 303, 307 e 308, com no máximo cinco
redirecionamentos. Cabeçalhos da aplicação sobrevivem a redirecionamentos de
mesma origem. Quando a origem muda ou HTTPS é rebaixado para HTTP, todos são
removidos; apenas o `Accept-Encoding: identity` controlado internamente é
recriado. `maxFileSizeBytes` é aplicado tanto ao `Content-Length` declarado
quanto aos bytes efetivamente recebidos.

> **O pacote não é um filtro de SSRF.** Uma URL e seus redirecionamentos podem
> alcançar qualquer endereço acessível ao processo. Aplicações que recebem URLs
> de terceiros devem aplicar a própria política de host, DNS/IP e
> redirecionamento — ou baixar o arquivo com um cliente controlado e entregar os
> bytes ao extrator.

---

## Limites, segurança e escopo

- A rede é usada apenas para baixar a URL informada. Documentos, texto, códigos
  e imagens não são enviados a OCR ou processamento externo.
- O modelo de idioma do OCR é lido do disco local.
- Resultados estruturados não incluem caminhos, URLs, consultas, buffers nem
  credenciais. Manter esses dados fora dos logs continua sendo responsabilidade
  da aplicação chamadora.
- JPEG e PNG têm largura, altura e área verificadas no cabeçalho antes da
  decodificação e novamente depois. Cada eixo é limitado a 32.767 pixels, além
  de `maxSourceImagePixels`.
- A execução de JavaScript embutido em PDF permanece desabilitada.
- Recursos de PDF, canvas e OCR são encerrados ao fim da extração.
- O cancelamento é cooperativo: atua nos pontos de verificação de cada etapa.

**Fora do escopo:** HEIC/HEIF, TIFF, GIF, imagens multipágina e vídeo. Cada JPEG
ou PNG é uma única página. O pré-processamento não corrige perspectiva — fotos
muito inclinadas, deformadas, com reflexo, desfoque forte ou código encoberto
podem terminar legitimamente em `not_found`. Aumentar `passes` amplia as
tentativas, mas não garante recuperação e não autoriza completar trechos
ilegíveis. QR Code Pix não é usado como substituto da linha digitável ou do
código de barras.

## Reconhecimento

O código de barras é lido com ITF e só é aceito quando produz exatamente 44
dígitos válidos, preservando posição e varrendo regiões da página para localizar
mais de um boleto.

O OCR usa dados locais em português e preserva blocos e coordenadas. Se a
primeira leitura textual não produzir código válido, apenas regiões numéricas
candidatas são repetidas com lista permitida de dígitos. Correções de caracteres
visualmente confundíveis só são aceitas quando levam a um único código
integralmente válido; correção ambígua é descartada.

Imagens são documentos visuais de uma página. A primeira passagem mantém o
quadro completo, sem recorte, contraste ou ampliação, já orientado por EXIF.
Passagens seguintes, até o limite de `passes`, podem usar recorte conservador de
margens uniformes, escala de cinza, contraste moderado, redimensionamento
limitado e rotações discretas. As coordenadas reconhecidas são sempre remapeadas
para a imagem original. Para tentar todas as rotações de 90 graus, use
`passes: 5`.

A etapa de texto nativo existe somente em PDF e não conta como passagem visual.

---

## Referências normativas

- [Convenção da Cobrança FEBRABAN](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Conven%C3%A7%C3%A3o%20da%20Cobran%C3%A7a%20-%2005_02_2021_f.pdf)
- [Layout de Código de Barras de Arrecadação, versão 8](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20-%20C%C3%B3digo%20de%20Barras%20-%20Vers%C3%A3o%208%20-%2011_05_2026.pdf)
- [Especificação técnica do fator de vencimento](https://www.bb.com.br/docs/pub/emp/empl/dwn/Doc5175Bloqueto.pdf)
