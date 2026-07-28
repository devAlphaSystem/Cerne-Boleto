# Cerne Boleto

Biblioteca e CLI para extrair códigos validados e informações gerais de boletos a partir de PDF, JPEG e PNG. As entradas podem ser caminhos locais, URLs HTTP(S), bytes em memória, `Readable` do Node.js ou qualquer `AsyncIterable<Uint8Array>`; o processamento usa CPU local, sem depender de um serviço externo de OCR.

O projeto reconhece boletos de cobrança e de arrecadação, consolida evidências vindas do texto do PDF, do código de barras ITF e do OCR e só retorna como resultado códigos que passam pelas regras estruturais, semânticas e de dígitos verificadores implementadas pela biblioteca.

> A validação confirma a consistência do código segundo as regras suportadas. Ela não confirma autenticidade, titularidade, situação de pagamento nem segurança do beneficiário. Antes de pagar, confira os dados em um canal confiável.

## Recursos principais

- PDF com ou sem camada de texto, JPEG e PNG, detectados pelo conteúdo dos bytes.
- Entrada por arquivo local, URL HTTP(S), `ArrayBuffer`, `Uint8Array`, `Buffer`, `Readable` ou `AsyncIterable<Uint8Array>`.
- Política explícita de armazenamento para streams: `memory`, `file` ou `auto`.
- Extração individual e em lote, com concorrência limitada e ordem estável.
- Leitura de linha digitável no texto, código de barras ITF e OCR em português.
- Validação de cobrança (44/47 dígitos) e arrecadação (44/48 dígitos).
- Conversão entre código de barras e linha digitável, formatação e decomposição dos campos codificados.
- Extração de instituição, beneficiário, beneficiário final, pagador, CPF/CNPJ, vencimento, valor, nosso número, número e data do documento quando há evidência confiável.
- Limites configuráveis de arquivo, páginas, pixels, tempo e cancelamento com `AbortSignal`.
- Saída estruturada com status, confiança, origem, páginas, avisos, metadados e erros estáveis.
- Distribuição ESM, CommonJS, tipos TypeScript e executável `cerne-boleto`.

## Requisitos e instalação

- Node.js 20 ou superior.
- Um sistema compatível com as dependências nativas instaladas por `@napi-rs/canvas`.

```bash
npm install cerne-boleto
```

Mais detalhes, inclusive uso a partir do código-fonte, estão em [docs/INSTALACAO.md](docs/INSTALACAO.md).

## Uso rápido da API

```ts
import { extractBoletos } from "cerne-boleto";

const extraction = await extractBoletos("./boleto.pdf", {
  performance: "balanced",
  ocr: "fallback",
});

if (extraction.status === "success" || extraction.status === "partial") {
  for (const boleto of extraction.results) {
    console.log(boleto.formattedDigitableLine);
    console.log(boleto.generalInfo.amount?.value ?? "valor não identificado");
  }
} else if (extraction.status === "not_found") {
  console.log("Nenhum boleto válido foi encontrado.");
} else {
  console.error(extraction.error?.code, extraction.error?.message);
}
```

Falhas de leitura e processamento são representadas em `ExtractionResult`; consulte `status`, `error`, `warnings` e `metadata.complete` em vez de depender apenas de exceções.

### Entrada em stream

```js
const result = await extractBoletos(readable, {
  streamStorage: "auto",
  streamMemoryThresholdBytes: 1024 * 1024,
  maxFileSizeBytes: 25 * 1024 * 1024,
  signal,
});
```

`streamStorage` decide onde os bytes ficam enquanto o stream é consumido: `memory` acumula na memória do processo, `file` grava cada bloco em um temporário do extrator e `auto` (padrão) começa na memória e migra para um temporário ao ultrapassar `streamMemoryThresholdBytes`. A política vale apenas para streams; `Buffer`, `Uint8Array` e `ArrayBuffer` já estão na memória e nunca vão para disco. Temporários criados pelo extrator são removidos ao fim da chamada, inclusive em erro, timeout, aborto e `not_found`. O lote aceita um stream como item direto ou dentro de um descritor `{ input }`. Detalhes em [docs/API.md](docs/API.md#entradas-em-stream).

## Uso rápido da CLI

```bash
cerne-boleto ./boleto.pdf --pretty
cerne-boleto ./boleto.pdf ./conta.png --concurrency 2 --pretty
```

A CLI escreve um único JSON em `stdout`. O código de saída é `0` para sucesso ou ajuda, `2` quando nada foi encontrado e `1` para resultado parcial, erro ou argumentos inválidos. Veja todas as opções em [docs/CLI.md](docs/CLI.md).

## Perfis de desempenho

| Perfil     | Passes | OCR padrão | Máximo de páginas | Pixels por página | Pixels da imagem-fonte | Prazo |
| ---------- | -----: | ---------- | ----------------: | ----------------: | ---------------------: | ----: |
| `fast`     |      1 | `never`    |                10 |         8.000.000 |             40.000.000 |  30 s |
| `balanced` |      2 | `fallback` |                30 |        12.000.000 |             60.000.000 | 120 s |
| `accurate` |      3 | `fallback` |                50 |        20.000.000 |            100.000.000 | 300 s |

O perfil padrão é `balanced`. O limite padrão de arquivo é 30 MiB em todos os perfis. Cada valor pode ser sobrescrito dentro dos intervalos aceitos; a referência completa está em [docs/API.md](docs/API.md#opções-de-extração).

## Documentação

- [Instalação e distribuição](docs/INSTALACAO.md)
- [Referência da API](docs/API.md)
- [CLI](docs/CLI.md)
- [Exemplos](docs/EXEMPLOS.md)
- [Benchmark](bench/README.md)

## Estrutura do repositório

```text
src/
  candidates/    descoberta de códigos e campos visíveis
  cli/           parsing e execução da CLI
  document/      carregamento e abstração de PDF/imagem
  pdf/           texto, abertura e renderização de PDF
  recognition/   leitura ITF e OCR
  scoring/       associação, reconciliação e confiança
  validation/    regras de boleto e conversões
  extractor.ts   orquestração individual e em lote
  index.ts       superfície pública
bench/           fixtures sintéticas e benchmark determinístico
docs/            documentação detalhada
```

Não há servidor, banco de dados, rotas HTTP, controllers ou views neste projeto. URLs são apenas uma forma de entrada para documentos.

## Desenvolvimento

Os scripts declarados no projeto cobrem verificação de tipos, lint, formatação, build, benchmark e auditoria:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
```

A integração contínua executa essas verificações em Node.js 20, 22 e 24 e mantém uma etapa separada de auditoria de dependências. O benchmark usa documentos sintéticos e não versiona boletos reais; veja [bench/README.md](bench/README.md).

## Licença

[MIT](LICENSE).
