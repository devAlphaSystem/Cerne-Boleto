# Cerne Boleto

Extração local de linhas digitáveis, códigos de barras e informações gerais de
boletos em **PDF, JPEG ou PNG** — por caminho, URL ou bytes em memória.
Processamento **somente por CPU**: sem GPU, sem serviço externo, sem credencial
de API.

```bash
npm install cerne-boleto
```

```ts
import { extractBoletos } from "cerne-boleto";

const result = await extractBoletos("./boleto.pdf");

if (result.success) {
  console.log(result.bestMatch.formattedDigitableLine);
  // 00190.50095 40144.816069 06809.350314 3 37370000000100
}
```

## Documentação

| Documento                        | Conteúdo                                                        |
| -------------------------------- | --------------------------------------------------------------- |
| [Instalação](docs/INSTALACAO.md) | Requisitos, scripts e benchmark                                 |
| [API](docs/API.md)               | Referência completa de funções, opções, tipos e erros           |
| [CLI](docs/CLI.md)               | Argumentos, códigos de saída e consumo da saída JSON            |
| [Exemplos](docs/EXEMPLOS.md)     | Receitas para lote, URLs, cancelamento, validação e integrações |

## O que é reconhecido

- Boletos de **cobrança**: código de barras de 44 dígitos, linha digitável de 47.
- Variante de cobrança **`988/0`**, identificada por ISPB.
- Contas e convênios de **arrecadação**: 44 dígitos, linha digitável de 48.

Só entra em `results` o código que passa **integralmente** pelas regras de
formato, semântica e dígitos verificadores. Beneficiário, pagador ou valor,
isoladamente, nunca criam um boleto artificial.

## Como funciona

| Etapa            | Aplicação                                                   |
| ---------------- | ----------------------------------------------------------- |
| Texto nativo     | Somente PDF; não conta como passagem visual                 |
| Código de barras | Leitor ITF, aceito apenas com 44 dígitos válidos            |
| OCR              | Tesseract local em português, conforme o modo configurado   |
| Consolidação     | Deduplicação pelo código canônico e pontuação por evidência |

Campos visíveis — instituição, beneficiário, beneficiário final, pagador,
CPF/CNPJ, vencimento, valor, nosso número, número e data do documento — são
associados ao boleto **geometricamente mais próximo** quando há mais de um na
mesma página.

## Perfis

| Perfil     | Passagens | OCR        | Páginas | Prazo padrão |
| ---------- | --------- | ---------- | ------- | ------------ |
| `fast`     | 1         | `never`    | 10      | 30 s         |
| `balanced` | 2         | `fallback` | 30      | 120 s        |
| `accurate` | 3         | `fallback` | 50      | 300 s        |

O perfil só define padrões: qualquer opção informada explicitamente prevalece.
Para esgotar as rotações de 90 graus em uma foto, use `passes: 5`.

## Custo de memória

O pico é transitório e vale por chamada: N extrações simultâneas multiplicam
esse valor por N. Medido num JPEG de 3,9 MP e num PDF equivalente:

| Etapa                                   | Pico    | Tempo  |
| --------------------------------------- | ------- | ------ |
| PDF com texto nativo (`stopAfterFirst`) | ~0 MB   | ~16 ms |
| Decodificar a imagem de origem          | ~22 MB  | —      |
| Render + leitura de código de barras    | ~32 MB  | —      |
| Passagens extras de `accurate`          | ~27 MB  | —      |
| **OCR**                                 | ~126 MB | ~1,7 s |

**O OCR domina, e o custo é subir o motor**: criar o worker do Tesseract sem
reconhecer nada já custa ~104 MB e ~290 ms. O reconhecimento em si é barato —
três páginas seguidas no mesmo worker somam ~9 MB. É a mesma natureza da heap
WebAssembly do OpenCV: runtime do motor, não trabalho útil.

Por isso `fast` usa `ocr: "never"` e os demais perfis usam `fallback`, que só
aciona o OCR quando código de barras e texto nativo falham. Force `ocr: "always"`
apenas quando a perda de reconhecimento justificar o custo; `maxPixelsPerPage`
governa o restante linearmente.

## Lote

```ts
import { extractBoletoBatch } from "cerne-boleto";

const batch = await extractBoletoBatch(["./a.pdf", "./foto.jpg", pngBuffer], {
  concurrency: 2,
});

console.log(batch.summary.boletosFound);
```

A ordem das entradas é preservada e cada resultado carrega seu `inputIndex`.
Cabeçalhos HTTP pertencem ao descritor de **uma** entrada — não existe
`requestHeaders` global —, de modo que credenciais de uma origem não vazam para
outra.

## CLI

```bash
cerne-boleto ./boleto.pdf --pretty
cerne-boleto ./a.pdf ./foto.jpeg ./conta.png --concurrency 2 --pretty
```

Uma fonte produz o envelope simples; duas ou mais produzem o envelope de lote. A
saída padrão contém somente JSON. Códigos de saída: `0` sucesso, `2` varredura
completa sem boleto, `1` parcial ou erro.

Não existe `--document-type`: cobrança e arrecadação são reconhecidas na mesma
execução. A CLI não aceita cabeçalhos nem senhas — use a API com
`requestHeaders` para downloads autenticados.

## Validação independente

Os validadores não precisam abrir um documento:

```ts
import { validateBoletoCode } from "cerne-boleto";

const validacao = validateBoletoCode("00190.50095 40144.816069 06809.350314 3 37370000000100");
console.log(validacao.isValid, validacao.layout);
```

Também são exportados `parseBoletoCode`, `toBarcode`, `toDigitableLine`,
`formatDigitableLine`, as três funções de dígito verificador e
`BOLETO_ISSUE_CODES`.

> Passar nos DVs confirma a consistência do código com o layout — **não** a
> autenticidade, existência, quitação ou legitimidade do boleto. O pacote não
> consulta bancos e não é ferramenta antifraude.

## Limites e escopo

- A rede é usada apenas para baixar a URL informada; nada é enviado a serviços
  externos de OCR ou processamento.
- Resultados estruturados não reproduzem caminhos, URLs, consultas, buffers nem
  credenciais.
- JavaScript embutido em PDF permanece desabilitado; PDFs com senha retornam
  `PASSWORD_REQUIRED`.
- Tamanho, páginas, pixels, texto, tempo e concorrência são limitados. Cada eixo
  de imagem é limitado a 32.767 pixels.
- **O pacote não é um filtro de SSRF.** Trate URLs de terceiros com política
  própria de host, DNS/IP e redirecionamento.
- Fora do escopo: HEIC/HEIF, TIFF, GIF, imagens multipágina e vídeo. O
  pré-processamento não corrige perspectiva — fotos muito degradadas podem
  terminar legitimamente em `not_found`.

`precisionScore` é determinístico e versionado por `metadata.confidenceVersion`
(hoje `"1.2.0"`), **não** uma probabilidade calibrada. Valide limiares em um
corpus próprio antes de automatizar decisões.

## Desenvolvimento

```bash
npm install
npm run check   # typecheck + lint + format:check + build + test
```

O repositório não versiona arquivos de teste — `npm test` executa zero testes. A
verificação real de que uma mudança em `src/` não alterou o resultado é o
benchmark, que compara todo o JSON de saída exceto `durationMs`:

```bash
npm run build && node bench/run.mjs --repeats 3 --compare antes
```

Detalhes em [`bench/README.md`](bench/README.md) e
[docs/INSTALACAO.md](docs/INSTALACAO.md).

## Referências

- [Convenção da Cobrança FEBRABAN](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Conven%C3%A7%C3%A3o%20da%20Cobran%C3%A7a%20-%2005_02_2021_f.pdf)
- [Layout de Código de Barras de Arrecadação, versão 8](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20-%20C%C3%B3digo%20de%20Barras%20-%20Vers%C3%A3o%208%20-%2011_05_2026.pdf)
- [Especificação técnica do fator de vencimento](https://www.bb.com.br/docs/pub/emp/empl/dwn/Doc5175Bloqueto.pdf)

## Licença

MIT. Veja [LICENSE](LICENSE).
