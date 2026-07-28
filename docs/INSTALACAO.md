# Instalação

## Requisitos

- Node.js `>=20`, conforme `engines.node` em [`package.json`](../package.json).
- CPU e memória compatíveis com o tamanho dos documentos e com os limites do perfil escolhido.
- Dependências nativas suportadas pelo ambiente para `@napi-rs/canvas`.

O projeto é voltado ao runtime Node.js. Ele usa APIs de arquivo, `Buffer`, timers e módulos nativos; não é um pacote para execução direta no navegador.

## Instalar como dependência

```bash
npm install cerne-boleto
```

Importação ESM:

```ts
import { extractBoletos, validateBoletoCode } from "cerne-boleto";
```

Importação CommonJS:

```js
const { extractBoletos, validateBoletoCode } = require("cerne-boleto");
```

O manifesto publica as seguintes entradas:

| Uso            | Artefato           |
| -------------- | ------------------ |
| ESM            | `dist/index.js`    |
| CommonJS       | `dist/index.cjs`   |
| Tipos ESM      | `dist/index.d.ts`  |
| Tipos CommonJS | `dist/index.d.cts` |
| CLI            | `dist/cli.js`      |

Os artefatos em `dist/` são gerados; o código-fonte está em `src/`.

O campo `files` do manifesto inclui `dist/`, `README.md` e `LICENSE`. Os guias
em `docs/` e o benchmark permanecem disponíveis no repositório, mas não entram
no pacote gerado pela configuração atual.

## Instalar a CLI globalmente

```bash
npm install --global cerne-boleto
cerne-boleto --help
```

O executável aceita arquivos locais e URLs HTTP(S). Para enviar cabeçalhos HTTP customizados, use a API JavaScript; a CLI não expõe essa opção.

## Trabalhar a partir do repositório

Instalação reprodutível com o lockfile e geração da distribuição:

```bash
npm ci
npm run build
```

Os scripts relevantes declarados em `package.json` são:

| Script                   | Finalidade                                                             |
| ------------------------ | ---------------------------------------------------------------------- |
| `npm run build`          | gera biblioteca ESM/CommonJS, declarações, mapas e CLI com `tsup`      |
| `npm run typecheck`      | verifica TypeScript sem emitir arquivos                                |
| `npm run lint`           | executa ESLint                                                         |
| `npm run format:check`   | verifica Prettier sem reescrever                                       |
| `npm run check`          | encadeia tipos, lint, formatação e build                               |
| `npm run bench:fixtures` | recria documentos sintéticos de benchmark                              |
| `npm run bench`          | executa o benchmark com coleta de memória favorecida por `--expose-gc` |
| `npm run security:audit` | executa auditoria de dependências                                      |

`prepare` aplica o patch versionado em [`patches/prettier+3.9.4.patch`](../patches/prettier+3.9.4.patch) por meio de `patch-package`.

## Dependências de runtime

| Dependência              | Papel no pipeline                                         |
| ------------------------ | --------------------------------------------------------- |
| `pdfjs-dist`             | parsing, texto e renderização de PDF                      |
| `@napi-rs/canvas`        | canvas e decodificação/renderização de imagens no Node.js |
| `@zxing/library`         | leitura do código de barras ITF                           |
| `tesseract.js`           | OCR local                                                 |
| `@tesseract.js-data/por` | dados de idioma português usados pelo OCR                 |

O OCR é executado localmente. O pacote não envia imagens a um serviço de OCR; a única requisição de documento feita pela biblioteca ocorre quando a própria entrada é uma URL HTTP(S).

## Compatibilidade e integração contínua

O CI do repositório verifica Node.js 20, 22 e 24 em Linux e executa tipos, lint, formatação e build. O requisito público permanece Node.js 20 ou superior; outros sistemas operacionais e arquiteturas dependem da disponibilidade das dependências instaladas.

Consulte [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) para a matriz atual.

## Falhas comuns de instalação

### Engine incompatível

Confirme `node --version`. Versões anteriores à 20 estão fora do contrato declarado.

### Falha ao carregar canvas nativo

O pipeline de renderização depende de `@napi-rs/canvas`. Confirme que a plataforma possui um artefato compatível e que a instalação de dependências foi concluída sem omissões de pacotes necessários ao ambiente.

### `dist/` ausente em um checkout local

`src/` contém TypeScript e `dist/` não é versionado. Gere os artefatos com `npm run build` antes de importar diretamente a distribuição local ou executar `bench/run.mjs`.

### OCR não inicializa

Confirme que `tesseract.js` e `@tesseract.js-data/por` estão instalados. Como o idioma português é carregado do pacote local com cache desabilitado, uma instalação incompleta impede a criação da sessão OCR.

Para falhas durante a extração, identifique `error.code` no resultado e consulte os [códigos de erro da API](API.md#códigos-de-erro-de-extração).
