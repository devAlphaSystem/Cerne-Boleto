# Referência da API

A superfície pública é definida por [`src/index.ts`](../src/index.ts). O pacote exporta duas operações de extração, oito helpers de boleto, a constante de códigos de validação e os tipos associados.

## Importação

```ts
import { extractBoletoBatch, extractBoletos, formatDigitableLine, parseBoletoCode, toBarcode, toDigitableLine, validateBoletoCode } from "cerne-boleto";
```

## Entradas aceitas

```ts
type DocumentInput = string | ArrayBuffer | Uint8Array | Readable | AsyncIterable<Uint8Array>;
type DocumentFormat = "pdf" | "jpeg" | "png";
```

Uma `string` é interpretada como URL somente quando começa com `http://` ou `https://` (sem diferenciar maiúsculas de minúsculas); nos demais casos, é tratada como caminho local. `Buffer` é aceito em runtime e em TypeScript por ser uma subclasse de `Uint8Array`. Um `Readable` ou qualquer `AsyncIterable<Uint8Array>` é consumido bloco a bloco sob a política de [`streamStorage`](#entradas-em-stream).

O formato é detectado pela assinatura dos bytes, não pela extensão nem pelo `Content-Type`: PNG usa a assinatura completa, JPEG começa por `FF D8 FF` e PDF deve conter `%PDF-` nos primeiros 1.024 bytes.

## `extractBoletos`

```ts
function extractBoletos(input: DocumentInput, options?: ExtractOptions): Promise<ExtractionResult>;
```

Carrega um documento, busca evidências de boleto, valida cada código, associa campos visíveis e devolve um resultado estruturado. Falhas de opções, entrada, download, parsing, prazo ou processamento são convertidas em `ExtractionResult.error`; o fluxo normal do consumidor deve inspecionar o resultado resolvido.

### Exemplo

```ts
const result = await extractBoletos("./boleto.pdf", {
  performance: "balanced",
  ocr: "fallback",
  maxPages: 20,
  timeoutMs: 90_000,
});

if (result.success) {
  console.log(result.bestMatch?.formattedDigitableLine);
}
```

## Opções de extração

| Opção                        | Tipo                                 | Padrão              | Faixa/valores                | Efeito                                                                 |
| ---------------------------- | ------------------------------------ | ------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `performance`                | `"fast" \| "balanced" \| "accurate"` | `"balanced"`        | valores listados             | seleciona os padrões de passes, OCR, páginas, pixels e prazo           |
| `passes`                     | `number` inteiro                     | perfil              | 1 a 5                        | limita as receitas de renderização por página                          |
| `ocr`                        | `"never" \| "fallback" \| "always"`  | perfil              | valores listados             | desabilita OCR, usa em páginas sem evidência/texto nativo ou força OCR |
| `maxPages`                   | `number` inteiro                     | perfil              | 1 a 10.000                   | limita as páginas processadas por documento                            |
| `maxFileSizeBytes`           | `number` inteiro                     | 31.457.280 (30 MiB) | 1 a 1.073.741.824            | limita arquivo local, bytes em memória, stream e download              |
| `maxPixelsPerPage`           | `number` inteiro                     | perfil              | 250.000 a 100.000.000        | limita a área de cada superfície renderizada                           |
| `maxSourceImagePixels`       | `number` inteiro                     | perfil              | 250.000 a 200.000.000        | limita a área declarada/decodificada da imagem-fonte                   |
| `timeoutMs`                  | `number` inteiro                     | perfil              | 0 a 3.600.000                | prazo da extração; zero desabilita                                     |
| `stopAfterFirst`             | `boolean`                            | `false`             | `true`/`false`               | interrompe páginas/passes restantes após a primeira evidência válida   |
| `streamStorage`              | `"memory" \| "file" \| "auto"`       | `"auto"`            | valores listados             | escolhe onde um stream fica enquanto é consumido                       |
| `streamMemoryThresholdBytes` | `number` inteiro                     | 8.388.608 (8 MiB)   | 1 a 1.073.741.824            | memória máxima de um stream `auto` antes de migrar para arquivo        |
| `streamTempDirectory`        | `string`                             | temporário do SO    | diretório existente          | escolhe onde os temporários do extrator são criados                    |
| `requestHeaders`             | `Readonly<Record<string, string>>`   | ausente             | nomes e valores HTTP válidos | cabeçalhos usados somente em uma entrada HTTP(S)                       |
| `signal`                     | `AbortSignal`                        | ausente             | sinal válido                 | cancela carregamento, leitura do stream e processamento                |

### Entradas em stream

```js
const result = await extractBoletos(readable, {
  streamStorage: "auto",
  streamMemoryThresholdBytes: 1024 * 1024,
  maxFileSizeBytes: 25 * 1024 * 1024,
  signal,
});
```

```ts
type StreamStorage = "memory" | "file" | "auto";
```

| Política | Onde os bytes ficam                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory` | Acumula na memória do processo, respeitando `maxFileSizeBytes`. Nenhum arquivo é criado.                                                                                              |
| `file`   | Grava cada bloco em um temporário do extrator assim que ele chega. O documento completo nunca é montado na memória durante o recebimento.                                             |
| `auto`   | Padrão. Mantém na memória até `streamMemoryThresholdBytes`; ao ultrapassá-lo, cria o temporário, grava os blocos já recebidos e direciona os seguintes ao arquivo, sem reler a fonte. |

Regras que valem para as três políticas:

- os blocos são puxados um a um e cada gravação é aguardada antes do próximo bloco, então o produtor é limitado pela velocidade do destino (backpressure real);
- o tamanho aceito vem dos bytes que realmente chegaram, nunca de um comprimento anunciado pelo produtor; ao ultrapassar `maxFileSizeBytes` a leitura é interrompida com `FILE_TOO_LARGE`;
- todo bloco precisa ser `Uint8Array` ou `Buffer`; qualquer outro tipo produz `INVALID_INPUT`;
- o `signal` é verificado antes da leitura, entre blocos e após cada gravação, e um `Readable` é destruído ao abortar;
- em `auto`, a memória retida é no máximo o limite configurado mais o bloco em processamento.

A política não se aplica a `Buffer`, `Uint8Array`, `ArrayBuffer`, caminho local ou URL. Bytes já recebidos em memória não são gravados em disco, porque a alocação já aconteceu; o download remoto continua com o comportamento anterior.

Um stream só pode ser consumido uma vez. Não reaproveite a mesma instância em duas chamadas nem em dois itens do mesmo lote.

#### O que `file` e `auto` economizam neste pacote

O PDF.js e o decodificador de imagem exigem o documento completo em um único buffer. Um stream gravado em temporário é lido de volta no momento em que o parsing começa, em uma alocação de tamanho exato. O ganho está no recebimento: enquanto o produtor entrega os bytes — que é a fase longa em um upload — o processo segura no máximo o bloco atual em vez do documento inteiro, e a alocação final é exata em vez do excesso que um buffer crescente deixaria. O pico durante o parsing é o mesmo das outras entradas.

#### Arquivos temporários

- O nome é aleatório (24 bytes de entropia), sem nenhum trecho vindo do chamador ou do conteúdo, e o arquivo é criado com `wx` e modo `0600`: um caminho já existente, inclusive um symlink plantado, faz a criação falhar em vez de ser seguido.
- O diretório é `streamTempDirectory` quando informado e, caso contrário, o diretório temporário do sistema. O caminho é resolvido para absoluto na validação de opções; o diretório precisa existir, e um diretório inutilizável produz `RESOURCE_LIMIT` em vez de gravar em outro lugar silenciosamente.
- A remoção acontece no `finally` de cada extração, portanto também em erro, `TIMEOUT`, `ABORTED`, falha de parsing e `not_found`. No lote, cada fonte limpa o próprio temporário ao terminar.
- Caminhos fornecidos pelo chamador nunca são removidos, e nenhum caminho temporário aparece em resultados, avisos ou mensagens de erro.

#### Compatibilidade

A mudança é retrocompatível. `DocumentInput` ganhou dois membros na união, `ExtractOptions` ganhou três campos opcionais e nenhum comportamento anterior mudou: código existente que passa caminho, URL ou bytes continua idêntico, inclusive nos códigos de erro. O requisito de runtime segue sendo Node.js 20 ou superior, validado em Node.js 20, 22 e 24.

### Padrões por perfil

| Perfil     | `passes` | `ocr`      | `maxPages` | `maxPixelsPerPage` | `maxSourceImagePixels` | `timeoutMs` |
| ---------- | -------: | ---------- | ---------: | -----------------: | ---------------------: | ----------: |
| `fast`     |        1 | `never`    |         10 |          8.000.000 |             40.000.000 |      30.000 |
| `balanced` |        2 | `fallback` |         30 |         12.000.000 |             60.000.000 |     120.000 |
| `accurate` |        3 | `fallback` |         50 |         20.000.000 |            100.000.000 |     300.000 |

As opções individuais substituem apenas o respectivo padrão do perfil. Por exemplo, `{ performance: "fast", ocr: "always" }` mantém os demais limites de `fast` e força OCR.

### Cabeçalhos HTTP

O objeto deve ser um objeto simples, todos os valores devem ser strings e nomes duplicados sem considerar caixa são rejeitados. Estes cabeçalhos não podem ser sobrescritos:

```text
accept-encoding, connection, content-length, expect, host, if-range,
keep-alive, proxy-connection, range, te, trailer, transfer-encoding, upgrade
```

`accept-encoding: identity` é definido internamente. Cabeçalhos fornecidos pelo chamador são removidos quando um redirecionamento muda de origem ou faz downgrade de HTTPS para HTTP.

## `ExtractionResult`

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

### Semântica de status

| Status      | Significado na extração individual                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `success`   | ao menos um boleto foi encontrado e a política de término foi cumprida sem erro nem truncamento por `maxPages` |
| `not_found` | processamento completo, sem boleto válido                                                                      |
| `partial`   | há resultados apesar de erro terminal, ou a execução terminou incompleta, por exemplo por `maxPages`           |
| `error`     | erro terminal sem nenhum resultado válido                                                                      |

`success` indica apenas se `results` contém ao menos um boleto. Portanto, também pode ser `true` quando `status === "partial"`.

`bestMatch` é o primeiro boleto após ordenação por maior confiança, primeira página e código. `precisionScore` no nível do resultado é a menor confiança entre os boletos retornados, arredondada a três casas; quando não há resultados, vale zero.

## `ExtractedBoleto`

| Campo                    | Significado                                               |
| ------------------------ | --------------------------------------------------------- |
| `barcode`                | representação canônica de 44 dígitos                      |
| `digitableLine`          | linha canônica sem formatação, com 47 ou 48 dígitos       |
| `formattedDigitableLine` | linha com espaços e pontuação canônicos                   |
| `layout`                 | `"cobranca"` ou `"arrecadacao"`                           |
| `isValid`                | sempre `true` para um item retornado                      |
| `precisionScore`         | confiança consolidada, de 0 a 1                           |
| `pages`                  | páginas de evidência, numeradas a partir de 1             |
| `sources`                | fontes distintas em ordem estável                         |
| `occurrences`            | ocorrências após deduplicação espacial por página e fonte |
| `components`             | campos codificados, específicos do layout                 |
| `generalInfo`            | campos codificados e visíveis reconciliados               |

`sources` pode conter:

- `pdf-text`: ordem de itens da camada de texto do PDF;
- `pdf-text-reconstructed`: linhas reconstruídas por posição;
- `itf`: código de barras ITF decodificado;
- `ocr`: texto reconhecido pelo Tesseract.

### Informações gerais

`generalInfo` contém os campos abaixo. Qualquer campo sem evidência confiável permanece `null`.

```ts
interface BoletoGeneralInfo {
  institution: ExtractedBoletoField | null;
  beneficiary: BoletoPartyInfo | null;
  finalBeneficiary: BoletoPartyInfo | null;
  payer: BoletoPartyInfo | null;
  dueDate: ExtractedBoletoField | null; // YYYY-MM-DD
  amount: ExtractedBoletoField | null; // decimal com ponto, sem moeda
  ourNumber: ExtractedBoletoField | null;
  documentNumber: ExtractedBoletoField | null;
  documentDate: ExtractedBoletoField | null; // YYYY-MM-DD
}
```

Cada `ExtractedBoletoField` preserva `value`, `rawValue`, `precisionScore`, páginas e fontes (`encoded`, `pdf-text` ou `ocr`). Beneficiário, beneficiário final e pagador contêm `name` e `taxId` independentes.

Valor e vencimento codificados têm precedência sobre texto visível, salvo a regra de desambiguação do fator de vencimento. Conflitos relevantes são preservados em `warnings`, não mascarados por um valor alternativo.

### Componentes de cobrança

`CobrancaBoletoComponents` inclui, além dos campos comuns:

- `variant`: `bank-code` ou `ispb`;
- `institutionCode`, `currencyCode`, `generalCheckDigit` e dígitos calculados;
- `ispb` e `ispbField` para a variante ISPB;
- `dueDateFactor`, `dueDate`, `dueDateCandidates` e `dueDateAssumption` para a variante bancária;
- `amountField`, `amountCents` e `freeField`.

Fator `0000` não codifica data. Fatores a partir de `1000` possuem uma data histórica e uma data no ciclo reiniciado em 22/02/2025; o parser escolhe o ciclo de 2025 e registra `dueDateAssumption: "2025-reset-cycle"`. Durante a extração, uma data impressa compatível pode desambiguar o fator.

### Componentes de arrecadação

`ArrecadacaoBoletoComponents` inclui:

- `productCode`, `segmentCode` e `segmentName`;
- `valueIdentifier`, `valueType` (`amount`/`reference`) e `checkDigitAlgorithm` (`modulo10`/`modulo11`);
- `valueField`, `amountCents` ou `referenceValue`;
- `organizationIdentifier`, seu tipo e o `freeField` restante;
- `dueDate` quando os oito primeiros dígitos do campo livre formam uma data `YYYYMMDD` válida.

Segmentos aceitos: `1`, `2`, `3`, `4`, `5`, `6`, `7` e `9`. Identificadores de valor aceitos: `6`, `7`, `8` e `9`.

## Metadados

`ExtractionMetadata` permite observar configuração, consumo e completude:

| Campo                                      | Conteúdo                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `performance`, `ocrMode`                   | opções resolvidas                                                          |
| `inputFormat`                              | formato detectado; ausente se a entrada falhou antes da detecção           |
| `passesRequested`, `passesUsed`            | limite solicitado e maior pass tentado                                     |
| `pagesTotal`, `pagesProcessed`             | páginas declaradas e processadas na etapa de texto nativo                  |
| `pagesRendered`                            | páginas distintas renderizadas                                             |
| `renderAttempts`                           | tentativas de reconhecimento que usaram uma superfície renderizada         |
| `ocrPages`                                 | páginas distintas enviadas ao OCR                                          |
| `fileSizeBytes`                            | bytes carregados                                                           |
| `sourceImageWidth`, `sourceImageHeight`    | dimensões decodificadas de JPEG/PNG, quando aplicável                      |
| `maxPixelsPerPage`, `maxSourceImagePixels` | limites resolvidos                                                         |
| `durationMs`                               | tempo total em milissegundos                                               |
| `complete`                                 | cumprimento da política de término sem erro nem truncamento por `maxPages` |
| `confidenceVersion`                        | versão do contrato de confiança; atualmente `"1.2.0"`                      |

## Extração em lote

```ts
function extractBoletoBatch(inputs: readonly BoletoBatchInput[], options?: BatchExtractOptions): Promise<BatchExtractionResult>;
```

Cada item é uma entrada simples ou um descritor com cabeçalhos próprios:

```ts
type BoletoBatchInput =
  | DocumentInput
  | {
      input: DocumentInput;
      requestHeaders?: Readonly<Record<string, string>>;
    };
```

Um `Readable` ou async iterable é aceito nas duas formas: como item direto do array ou no campo `input` do descritor. O descritor continua exigindo objeto simples com `input`; um stream é reconhecido como entrada antes dessa checagem, então não é confundido com um descritor malformado. Cada fonte consome o próprio stream e limpa o próprio temporário.

`BatchExtractOptions` contém as mesmas opções, com estas diferenças:

- `concurrency?: number` aceita inteiros de 1 a 8 e usa 1 por padrão;
- `requestHeaders` não existe no nível do lote; use o descritor de cada fonte;
- `signal` cancela o lote, interrompe agendamento e é repassado às extrações ativas;
- `streamStorage`, `streamMemoryThresholdBytes` e `streamTempDirectory` valem para todas as fontes do lote.

O resultado agrega:

- `items`: resultados individuais em ordem de entrada;
- `results`: boletos com `inputIndex`, agrupados por ordem da entrada;
- `bestMatch`: maior confiança global, com desempate pelo menor índice;
- `summary`: contagens por status, total de boletos, concorrência e duração;
- `metadata`: soma de páginas, renderizações, OCR e bytes, com o maior pass usado;
- `warnings`: avisos individuais prefixados por `Input <índice>:`.

Um lote inválido (por exemplo, vazio ou com concorrência fora da faixa) retorna `status: "error"`, `items: []` e contabiliza todas as entradas como falhas. Descritores inválidos isolados viram erros apenas nos respectivos itens.

## Helpers de boleto

### `validateBoletoCode`

```ts
function validateBoletoCode(value: string): BoletoValidation;
```

Remove espaços, pontos e hífens de apresentação, identifica o layout pelo comprimento/prefixo, converte para código de barras e verifica semântica e dígitos. Conteúdo inválido é retornado com `isValid: false` e `issues`; esta função não lança por um código de boleto inválido.

### `parseBoletoCode`

```ts
function parseBoletoCode(value: string): BoletoComponents;
```

Decompõe uma forma estruturalmente suportada, inclusive quando os dígitos verificadores estão errados. Lança `TypeError` se não houver exatamente 44, 47 ou 48 dígitos válidos após remover somente os separadores aceitos.

### Conversões

```ts
function toBarcode(value: string): string;
function toDigitableLine(value: string): string;
function formatDigitableLine(value: string): string;
```

- `toBarcode` devolve 44 dígitos.
- `toDigitableLine` devolve 47 dígitos para cobrança ou 48 para arrecadação.
- `formatDigitableLine` aplica o formato humano canônico.

Essas funções validam a forma, mas não exigem que todos os dígitos verificadores do valor fornecido estejam corretos. Elas lançam `TypeError` para formas inválidas; a conversão de um código de arrecadação também exige identificador de valor `6`, `7`, `8` ou `9`.

### Cálculo de dígitos

```ts
function calculateModulo10CheckDigit(body: string): number;
function calculateCobrancaBarcodeCheckDigit(body: string): number;
function calculateArrecadacaoModulo11CheckDigit(body: string): number;
```

- módulo 10 e módulo 11 de arrecadação aceitam um corpo numérico não vazio;
- o dígito geral de cobrança exige exatamente 43 dígitos;
- entrada fora do contrato lança `TypeError`.

## Códigos de problemas de validação

`BOLETO_ISSUE_CODES` expõe os códigos estáveis abaixo:

| Código                        | Regra                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `INVALID_FORMAT`              | forma não numérica ou comprimento diferente de 44/47/48 |
| `INVALID_PRODUCT`             | produto de arrecadação diferente de `8`                 |
| `INVALID_INSTITUTION_CODE`    | banco `000` em cobrança                                 |
| `INVALID_CURRENCY_CODE`       | cobrança bancária sem código de Real `9`                |
| `INVALID_ISPB_CONFIGURATION`  | instituição `988` sem código de configuração `0`        |
| `INVALID_ISPB`                | campo ISPB sem seis zeros iniciais ou ISPB não nulo     |
| `INVALID_SEGMENT`             | segmento de arrecadação não suportado                   |
| `INVALID_VALUE_IDENTIFIER`    | identificador de valor fora de `6` a `9`                |
| `INVALID_FIELD_CHECK_DIGIT`   | dígito de um campo divergente                           |
| `INVALID_GENERAL_CHECK_DIGIT` | dígito geral divergente                                 |

Cada `BoletoIssue` possui `code` e `message` e pode incluir `field`, `actual` e `expected`.

## Códigos de erro de extração

| Código               | Situações representadas                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_INPUT`      | entrada vazia/inválida, caminho que não é arquivo, esquema remoto não aceito, credenciais na URL, bloco de stream que não é byte array, stream que falhou durante a leitura ou falha genérica de leitura |
| `FILE_NOT_FOUND`     | caminho local inexistente                                                                                                                                                                                |
| `FILE_TOO_LARGE`     | tamanho conhecido ou recebido ultrapassa `maxFileSizeBytes`                                                                                                                                              |
| `DOWNLOAD_ERROR`     | falha de rede, status HTTP não bem-sucedido, corpo ausente ou redirecionamento inválido/excessivo                                                                                                        |
| `INVALID_OPTIONS`    | valor fora da faixa, sinal/cabeçalhos inválidos ou cabeçalhos aplicados a entrada não remota                                                                                                             |
| `INVALID_PDF`        | PDF não pôde ser analisado ou possui dimensões de página inválidas                                                                                                                                       |
| `UNSUPPORTED_FORMAT` | bytes não correspondem a PDF, JPEG ou PNG                                                                                                                                                                |
| `INVALID_IMAGE`      | estrutura PNG/JPEG truncada, malformada ou indecodificável                                                                                                                                               |
| `PASSWORD_REQUIRED`  | PDF criptografado exige senha; a API não possui opção de senha                                                                                                                                           |
| `TIMEOUT`            | prazo configurado atingido                                                                                                                                                                               |
| `ABORTED`            | `AbortSignal` acionado                                                                                                                                                                                   |
| `RESOURCE_LIMIT`     | texto ou imagem excede limites seguros, memória não pôde ser alocada, ou o temporário de stream não pôde ser gravado                                                                                     |
| `PROCESSING_ERROR`   | falha interna/dependência não categorizada durante o processamento                                                                                                                                       |

O objeto público de erro contém somente `code` e uma mensagem segura; a exceção original não é devolvida.

## Tipos exportados

Além dos contratos descritos acima, o pacote exporta aliases e interfaces para formatos, status, fontes, opções, resultados individuais e de lote, campos, componentes de cobrança/arrecadação, dígitos e problemas de validação. A lista exata e atual está em [`src/index.ts`](../src/index.ts), e as definições em [`src/types.ts`](../src/types.ts) e [`src/validation/boleto.ts`](../src/validation/boleto.ts).
