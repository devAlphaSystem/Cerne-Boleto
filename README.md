# Cerne Boleto

O Cerne Boleto extrai linhas digitáveis e informações gerais de um ou mais
boletos em PDF, JPEG ou PNG, recebidos por caminho, URL ou memória. O
processamento usa somente CPU: PDFs aproveitam seu texto nativo, todas as fontes
visuais passam pelo leitor ITF e, quando o perfil permite, pelo OCR local em
português.

O pacote reconhece:

- boletos de cobrança com código de barras de 44 dígitos e linha digitável de
  47 dígitos;
- a variante de cobrança `988/0`, identificada por ISPB;
- contas e convênios de arrecadação com código de barras de 44 dígitos e linha
  digitável de 48 dígitos.

Somente códigos que passam integralmente pelas regras de formato, semântica e
dígitos verificadores entram em `results`. Textos como beneficiário, pagador ou
valor, isoladamente, nunca criam um boleto artificial.

## Instalação

```bash
npm install cerne-boleto
```

É necessário usar Node.js 20 ou mais recente. O pacote não requer GPU, serviço
externo de extração, instalação do Tesseract no sistema nem credenciais de API.
O modelo de OCR em português é instalado com o pacote e carregado localmente.

## Extração de uma fonte

```ts
import { extractBoletos } from "cerne-boleto";

const result = await extractBoletos("/local/path/boleto.jpg", {
  performance: "balanced",
  passes: 2,
});

console.log(JSON.stringify(result, null, 2));
```

Uma fonte pode ser um caminho local, uma URL HTTP/HTTPS apontando diretamente
para bytes PDF, JPEG ou PNG, `Buffer`, `Uint8Array` ou `ArrayBuffer`. O formato
é detectado pela assinatura dos bytes; extensão e `Content-Type` não decidem a
aceitação:

No TypeScript, `DocumentInput` é o nome recomendado para esse contrato.
`PdfInput` permanece exportado apenas como alias compatível, sem um caminho de
implementação paralelo.

```ts
const fromBytes = await extractBoletos(pdfBuffer);

const fromImage = await extractBoletos(jpegBuffer);

const fromUrl = await extractBoletos("https://documents.example.com/public/boleto.png");
```

Para uma URL autenticada, use `requestHeaders`, disponível somente na API:

```ts
const result = await extractBoletos("https://documents.example.com/private/boleto.pdf", {
  requestHeaders: {
    Authorization: "Bearer <token>",
  },
});
```

`requestHeaders` só pode ser usado com uma URL HTTP/HTTPS e aceita apenas
valores string. Cabeçalhos de roteamento, enquadramento, intervalo e negociação
de compressão são reservados pelo componente de download e não podem ser
sobrescritos.

## Extração em lote

`extractBoletoBatch` preserva a ordem das entradas. A concorrência aceita
valores de `1` a `8` e usa `1` por padrão:

```ts
import { extractBoletoBatch } from "cerne-boleto";

const batch = await extractBoletoBatch(
  [
    "./boleto-a.pdf",
    "./foto-boleto.jpg",
    pngBuffer,
    {
      input: "https://documents.example.com/private/boleto-b.pdf",
      requestHeaders: {
        Authorization: "Bearer <token-exclusivo-da-origem>",
      },
    },
  ],
  {
    performance: "balanced",
    concurrency: 2,
  },
);
```

Os cabeçalhos pertencem ao descritor de uma única entrada; não existe
`requestHeaders` global no lote. Assim, credenciais de uma origem não são
compartilhadas acidentalmente com outra.

Cada item contém apenas `inputIndex` e o resultado daquela extração. Caminhos,
URLs, strings de consulta, buffers e valores de cabeçalhos não são reproduzidos
no resultado. O envelope de lote acrescenta:

- `items`: resultados individuais, na mesma ordem das entradas;
- `results`: todos os boletos encontrados, acompanhados de `inputIndex`;
- `bestMatch`: melhor boleto e o índice de sua entrada;
- `summary`: totais de entradas bem-sucedidas, sem boleto, parciais, com erro e
  quantidade de boletos encontrados.

`metadata` consolida páginas, bytes, renderizações e OCR de todas as entradas,
além dos limites e da duração do lote. Nos resultados individuais,
`inputFormat` informa `pdf`, `jpeg` ou `png`, e `renderAttempts` contabiliza
cada superfície visual efetivamente criada. Para JPEG e PNG,
`sourceImageWidth` e `sourceImageHeight` registram as dimensões decodificadas
originais; esses campos não aparecem no metadado agregado de um lote misto.

No lote, `partial` também representa uma ou mais varreduras incompletas sem
boletos encontrados. `error` fica reservado ao lote sem resultados e sem itens
parciais que contenha ao menos uma falha; `not_found` indica que todas as
varreduras relevantes terminaram sem encontrar boleto.

O cancelamento do lote usa um único `AbortSignal`. Entradas em andamento são
canceladas cooperativamente e novas entradas deixam de ser iniciadas.

## Resultado

As duas APIs mantêm o contrato principal do Cerne Fiscal:

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

Um boleto extraído tem esta forma geral; o conteúdo de `components` foi
abreviado no exemplo:

```json
{
  "barcode": "00193373700000001000500940144816060680935031",
  "digitableLine": "00190500954014481606906809350314337370000000100",
  "formattedDigitableLine": "00190.50095 40144.816069 06809.350314 3 37370000000100",
  "layout": "cobranca",
  "isValid": true,
  "precisionScore": 0.99,
  "pages": [1],
  "sources": ["pdf-text"],
  "occurrences": 1,
  "components": {
    "layout": "cobranca",
    "representation": "digitable-line"
  },
  "generalInfo": {
    "institution": null,
    "beneficiary": null,
    "finalBeneficiary": null,
    "payer": null,
    "dueDate": null,
    "amount": null,
    "ourNumber": null,
    "documentNumber": null,
    "documentDate": null
  }
}
```

`components` contém a decomposição determinística do código. `generalInfo`
contém os campos visíveis do documento. Cada campo visível resolvido registra:

```json
{
  "value": "2026-12-31",
  "rawValue": "31/12/2026",
  "precisionScore": 0.94,
  "pages": [1],
  "sources": ["pdf-text"]
}
```

Datas normalizadas usam `YYYY-MM-DD`. Valores e centavos permanecem strings para
não perder zeros à esquerda nem introduzir arredondamento binário. CPF e CNPJ
são normalizados sem pontuação; o CNPJ pode ser numérico ou alfanumérico.

`pages` usa numeração iniciada em `1`; imagens sempre têm a página `1`.
`occurrences` conta evidências físicas consolidadas, sem transformar filtros,
escalas ou rotações dos mesmos pixels em novas ocorrências. Fontes realmente
distintas, como ITF e OCR, permanecem independentes. Em cada documento, a
deduplicação usa o código de barras canônico de 44 dígitos, portanto a linha
digitável e o ITF correspondentes não criam dois resultados. No lote, cada
boleto permanece associado ao seu `inputIndex`; não há deduplicação global
entre arquivos.

### Componentes de cobrança

Para `layout: "cobranca"`, `components` informa:

- código da instituição, código de moeda e variante `bank-code` ou `ispb`;
- DV geral, DVs dos três campos e valores esperados;
- fator de vencimento, datas candidatas e eventual suposição de ciclo;
- valor codificado em centavos como string;
- campo livre;
- ISPB e o campo ISPB na variante `988/0`.

Na variante bancária, a moeda deve ser `9`, correspondente ao Real. Na variante
`988/0`, o bloco após o DV contém seis zeros seguidos do ISPB de oito dígitos;
fator e valor não são inferidos desse bloco.

### Fator de vencimento de cobrança

O fator `1000` passou a representar `2025-02-22` no ciclo reiniciado. Fatores a
partir de `1000` também podem representar uma data do ciclo histórico.

Quando existe uma data de vencimento impressa e geometricamente associada ao
boleto, o extrator a cruza com as datas possíveis. Sem confirmação impressa, o
ciclo reiniciado em 22/02/2025 é usado e a suposição é registrada. Uma data
externa conflitante não substitui silenciosamente a informação codificada.

### Componentes de arrecadação

Para `layout: "arrecadacao"`, `components` informa:

- produto e segmento;
- identificador de valor;
- algoritmo `modulo10` ou `modulo11`;
- DV geral e DVs dos quatro campos;
- valor efetivo em centavos ou valor de referência;
- identificador da empresa ou órgão e seu tipo;
- campo livre;
- vencimento opcional quando o layout do campo livre contém uma data válida.

Os segmentos aceitos são `1`, `2`, `3`, `4`, `5`, `6`, `7` e `9`. Os
identificadores `6` e `8` representam valor efetivo; `7` e `9`, referência. Os
identificadores `6` e `7` usam módulo 10, enquanto `8` e `9` usam módulo 11.

### Informações visíveis

O extrator procura instituição, beneficiário, beneficiário final, pagador,
CPF/CNPJ, vencimento, valor, nosso número, número do documento e data do
documento.

Linhas do texto nativo e blocos do OCR mantêm suas coordenadas. Quando há mais
de um boleto na página, um campo visível é associado ao boleto geometricamente
mais próximo. Texto sem posição só é usado como informação da página inteira
quando existe exatamente um boleto nela. Ausências ou conflitos que não possam
ser resolvidos com segurança permanecem `null`.

Rótulos impressos em colunas são associados pela posição: o valor é procurado
na mesma linha e, quando ausente ou incompatível, na célula abaixo do rótulo.
Rótulos que aparecem dentro de frases padrão, como "uso do banco" e "texto de
responsabilidade do beneficiário", não criam campos.

Em cobrança na variante bancária, a instituição é resolvida a partir do código
de instituição codificado, usando uma tabela embutida dos emissores mais
comuns; nesse caso a fonte é `encoded`. Códigos fora da tabela usam o rótulo
impresso. Quando o nome impresso de uma parte contém um CPF ou CNPJ com
dígitos verificadores válidos, o documento é separado do nome e atribuído ao
`taxId` da mesma parte.

Valores impressos repetidos que diferem apenas por truncamento de quebra de
linha são consolidados no valor mais completo. Quando valores realmente
distintos competem, uma maioria estrita entre as evidências resolve o campo de
forma determinística; o campo resolvido por maioria tem a pontuação limitada a
`0.95` e gera um aviso. Sem maioria, o campo permanece `null`.

Em contas de arrecadação, além dos rótulos, blocos não rotulados de nome e
endereço ancorados por um CEP identificam as partes: o bloco com CNPJ válido
ou sufixo societário nomeia o beneficiário e os demais nomeiam o pagador.
Esses campos heurísticos têm pontuação máxima de `0.9`, nunca são usados em
boletos de cobrança e cedem ao rótulo correspondente quando ele existe. O
rótulo de número da fatura também alimenta o número do documento. QR codes e
códigos de barras desenhados como texto de dígitos 0 e 1 são descartados antes
da reconstrução do texto.

### Pontuação

`precisionScore` é uma pontuação determinística e versionada pelas evidências
encontradas. Texto nativo, texto reconstruído, ITF e OCR têm bases diferentes;
fontes independentes concordantes aumentam a confiança. O valor não é uma
probabilidade estatisticamente calibrada.

Todo item em `results` já passou pela validação integral do código. A pontuação
do resultado superior é conservadora: quando há vários boletos, corresponde à
menor pontuação entre eles. Valide limiares de automação em um corpus próprio e
representativo.

## Opções

| Opção                  | Valores                        | Padrão               | Significado                                                  |
| ---------------------- | ------------------------------ | -------------------- | ------------------------------------------------------------ |
| `performance`          | `fast`, `balanced`, `accurate` | `balanced`           | Seleciona resolução, limites e política de OCR               |
| `passes`               | inteiro `1..5`                 | específico do perfil | Número de tentativas visuais distintas                       |
| `ocr`                  | `never`, `fallback`, `always`  | específico do perfil | Controla o OCR local em português                            |
| `maxPages`             | inteiro positivo               | `10`, `30` ou `50`   | Máximo de páginas processadas                                |
| `maxFileSizeBytes`     | inteiro positivo               | 30 MiB               | Limite da entrada local ou remota                            |
| `maxPixelsPerPage`     | inteiro positivo               | específico do perfil | Limite da área renderizada por página                        |
| `maxSourceImagePixels` | inteiro positivo               | específico do perfil | Limite da imagem de origem antes e depois da decodificação   |
| `timeoutMs`            | `0..3600000`                   | específico do perfil | Prazo do download e extração; `0` desabilita o prazo         |
| `stopAfterFirst`       | booleano                       | `false`              | Interrompe após o primeiro boleto integralmente válido       |
| `requestHeaders`       | registro de strings            | nenhum               | Cabeçalhos de uma URL; disponível apenas na extração simples |
| `signal`               | `AbortSignal`                  | nenhum               | Cancela download e processamento                             |

`BatchExtractOptions` aceita as mesmas opções, exceto `requestHeaders`, e
acrescenta `concurrency`. Cabeçalhos de lote pertencem a cada descritor.
`stopAfterFirst: true` reduz trabalho, mas pode omitir outros boletos da mesma
fonte.

Perfis:

- `fast`: uma passagem visual, até 10 páginas e OCR desabilitado por padrão;
- `balanced`: duas passagens visuais, até 30 páginas e OCR de fallback;
- `accurate`: três passagens visuais, até 50 páginas, resoluções maiores e OCR
  de fallback.

No perfil `balanced`, o OCR de fallback é usado quando falta um código válido ou
quando uma página digitalizada precisa fornecer campos gerais. `ocr: "always"`
força OCR; `ocr: "never"` o desativa. A etapa de texto nativo sempre é
executada apenas em PDF e não conta como passagem visual.

Imagens são documentos visuais de uma página. A primeira passagem mantém o
quadro completo, sem recorte, contraste ou ampliação. Passagens posteriores,
até o limite de `passes`, podem usar recorte conservador de margens uniformes,
escala de cinza, contraste moderado, redimensionamento limitado e rotações
discretas. As coordenadas reconhecidas são sempre remapeadas à imagem original
já orientada por EXIF. Para tentar todas as rotações de 90 graus, use
`passes: 5`.

## OCR e reconhecimento de códigos

O código de barras é lido com ITF e só é aceito quando produz exatamente 44
dígitos válidos. A leitura preserva a posição e varre regiões da página para
encontrar mais de um boleto.

O OCR usa dados locais em português e preserva blocos e coordenadas. Se a
primeira leitura textual não produzir um código válido, somente regiões
numéricas candidatas são repetidas com uma lista permitida de dígitos.
Correções de caracteres visualmente confundíveis só são aceitas quando levam a
um único código integralmente válido; uma correção ambígua é descartada.

Uma fotografia degradada pode terminar legitimamente em `not_found`. As
passagens adicionais aumentam as tentativas de leitura, mas não garantem
recuperação e não autorizam completar trechos ilegíveis. Informações como
beneficiário, vencimento ou valor nunca substituem um código que não tenha
passado por todas as validações FEBRABAN. QR Code Pix não é usado como
substituto automático da linha digitável ou do código de barras.

## CLI

Após a instalação:

```text
cerne-boleto <file-or-url>... [options]
```

Uma fonte produz o mesmo resultado simples de `extractBoletos`; duas ou mais
fontes produzem o envelope de `extractBoletoBatch`:

```bash
cerne-boleto ./boleto.pdf --performance balanced --pretty
cerne-boleto ./boleto.jpg --passes 5 --pretty
cerne-boleto ./a.pdf ./foto.jpeg ./conta.png --concurrency 2 --pretty
cerne-boleto https://documents.example.com/public/boleto.png --pretty
```

Opções disponíveis:

```text
--performance fast|balanced|accurate
--passes 1..5
--ocr never|fallback|always
--max-pages N
--max-file-size BYTES
--max-pixels N
--max-source-pixels N
--timeout-ms N
--concurrency 1..8
--first
--pretty
--help
```

Não existe `--document-type`: cobrança e arrecadação são reconhecidas na mesma
execução. A CLI não aceita cabeçalhos nem senhas. Para downloads autenticados,
use a API com `requestHeaders`. Evite credenciais em strings de consulta, pois
argumentos podem aparecer no histórico do terminal ou na lista de processos.

A saída padrão contém somente JSON. O código de saída `0` indica extração
concluída com pelo menos um boleto, ou ajuda solicitada; `2` indica varredura
completa sem boletos; e `1` indica resultado parcial ou erro.

## Validação e conversão independentes

Os validadores não precisam abrir um PDF:

```ts
import { calculateArrecadacaoModulo11CheckDigit, calculateCobrancaBarcodeCheckDigit, calculateModulo10CheckDigit, formatDigitableLine, parseBoletoCode, toBarcode, toDigitableLine, validateBoletoCode } from "cerne-boleto";

const validation = validateBoletoCode("00190.50095 40144.816069 06809.350314 3 37370000000100");

if (validation.isValid) {
  console.log(validation.barcode);
}
```

- `validateBoletoCode` normaliza, decompõe e valida formato, identificadores,
  DVs de campos e DV geral;
- `parseBoletoCode` decompõe uma representação estruturalmente suportada, mas
  não substitui a validação;
- `toBarcode` converte 47 ou 48 dígitos em 44;
- `toDigitableLine` converte o código de barras em 47 ou 48 dígitos;
- `formatDigitableLine` aplica a apresentação canônica;
- as funções de módulo 10 e 11 recebem o corpo sem o DV calculado.

As conversões preservam strings e zeros à esquerda.

Passar nos DVs confirma a consistência do código com o layout, não a
autenticidade, existência, quitação, situação cadastral ou legitimidade do
boleto. O pacote não consulta bancos e não funciona como ferramenta antifraude.

## Download de documentos remotos

Somente URLs completas `http://` e `https://` são aceitas. A URL deve apontar
diretamente para bytes PDF, JPEG ou PNG; páginas HTML, formulários de login e
navegação por cookies ficam fora do escopo. O formato declarado pelo servidor
não é confiado: a assinatura real dos bytes determina o caminho de abertura.

O download segue respostas 301, 302, 303, 307 e 308, com no máximo cinco
redirecionamentos. Cabeçalhos fornecidos pela aplicação são preservados em
redirecionamentos de mesma origem. Quando a origem muda ou HTTPS é rebaixado
para HTTP, todos esses cabeçalhos são removidos; somente o `Accept-Encoding:
identity` controlado internamente pelo pacote é recriado. O limite
`maxFileSizeBytes` é aplicado ao `Content-Length` e aos bytes recebidos.

Trate URLs como entradas confiáveis. O pacote não é um filtro de SSRF: uma URL e
seus redirecionamentos podem alcançar qualquer endereço acessível ao processo.
Aplicações que recebem URLs de terceiros devem aplicar sua própria política de
host, DNS/IP e redirecionamento, ou baixar o arquivo com um cliente controlado e
fornecer os bytes ao extrator.

## Segurança, privacidade e recursos

- A rede é usada somente para baixar a URL informada. Documentos, texto,
  códigos e imagens não são enviados a OCR ou processamento externo.
- O modelo de idioma do OCR é lido do disco local.
- Caminhos, URLs, consultas, buffers e credenciais não são incluídos nos
  resultados estruturados.
- A aplicação chamadora continua responsável por não registrar entradas ou
  credenciais ao redor da biblioteca.
- Tamanho do arquivo, páginas, pixels de origem e renderização, dimensões de
  imagem, itens de texto, volume textual, tempo e concorrência têm limites.
- JPEG e PNG têm largura, altura e área verificadas no cabeçalho antes da
  decodificação e novamente após a abertura. Cada eixo fica limitado a 32767
  pixels, além de `maxSourceImagePixels`.
- O download e as etapas de CPU respeitam cancelamento, dentro dos pontos
  cooperativos de cada operação.
- A execução de JavaScript contido em PDF permanece desabilitada.
- Recursos de PDF, canvas e OCR são encerrados após a extração.

PDFs criptografados que exigem senha retornam `PASSWORD_REQUIRED`; o pacote não
oferece uma opção de senha. PDFs e imagens inválidos, muito grandes ou que
excedem limites retornam erros estruturados. Uma digitalização danificada pode
resultar em `not_found`; o extrator não aceita um código parcial.

HEIC/HEIF, TIFF, GIF estático ou animado, imagens multipágina e vídeo ficam
fora do escopo. Cada JPEG ou PNG é tratado como uma única página. O
pré-processamento não corrige perspectiva; fotos muito inclinadas, com
deformação, reflexo, desfoque forte ou código encoberto podem terminar em
`not_found`.

Códigos de erro:

```text
INVALID_INPUT
FILE_NOT_FOUND
FILE_TOO_LARGE
DOWNLOAD_ERROR
INVALID_OPTIONS
INVALID_PDF
INVALID_IMAGE
UNSUPPORTED_FORMAT
PASSWORD_REQUIRED
TIMEOUT
ABORTED
RESOURCE_LIMIT
PROCESSING_ERROR
```

## Interface local

A pasta `live` contém uma interface sem dependências frontend adicionais. Ela
aceita seleção, arrastar e soltar ou URL pública para PDF, JPEG e PNG. PDFs são
mostrados em `iframe`; imagens usam um elemento apropriado. Downloads remotos
são feitos uma única vez, permanecem somente em memória pelo TTL configurado e
passam por bloqueio de endereços locais, privados e reservados. Consulte
`live/README.md`.

## Referências

- [Convenção da Cobrança FEBRABAN](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Conven%C3%A7%C3%A3o%20da%20Cobran%C3%A7a%20-%2005_02_2021_f.pdf)
- [Layout de Código de Barras de Arrecadação, versão 8](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20-%20C%C3%B3digo%20de%20Barras%20-%20Vers%C3%A3o%208%20-%2011_05_2026.pdf)
- [Especificação técnica do fator de vencimento](https://www.bb.com.br/docs/pub/emp/empl/dwn/Doc5175Bloqueto.pdf)

## Desenvolvimento

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
```

A compilação gera ESM, CommonJS, declarações, mapas de código-fonte e a CLI em
`dist/`. Os testes usam o executor nativo do Node.js.
