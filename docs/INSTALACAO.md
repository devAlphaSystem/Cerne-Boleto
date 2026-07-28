# Instalação

## Requisitos

| Item             | Exigência                                                        |
| ---------------- | ---------------------------------------------------------------- |
| Node.js          | 20 ou superior (CI valida em 20, 22 e 24)                        |
| Sistema          | Windows, Linux ou macOS com binário `@napi-rs/canvas` disponível |
| GPU              | Não é usada                                                      |
| Tesseract        | Não precisa estar instalado no sistema                           |
| Credenciais      | Nenhuma chave de API é exigida pelo pacote                       |
| Rede em execução | Usada apenas se a entrada for uma URL HTTP/HTTPS                 |

O modelo de OCR em português (`@tesseract.js-data/por`) é instalado junto com o
pacote e carregado do disco local. Não há download de modelo em tempo de
execução nem uso da CDN padrão do Tesseract.

## Instalação como dependência

```bash
npm install cerne-boleto
```

O pacote publica ESM e CommonJS com declarações de tipos para ambos:

```ts
import { extractBoletos } from "cerne-boleto";
```

```js
const { extractBoletos } = require("cerne-boleto");
```

O `package.json` declara `"sideEffects": false`, então bundlers podem eliminar
código não utilizado. `engines.node` exige `>=20`.

## Instalação da CLI

O pacote registra o binário `cerne-boleto`. Depois de instalar como dependência
do projeto:

```bash
npx cerne-boleto ./boleto.pdf --pretty
```

Para uso global:

```bash
npm install --global cerne-boleto
```

Detalhes de argumentos e códigos de saída estão em [CLI.md](CLI.md).

## Dependências instaladas

| Pacote                   | Papel                                                     |
| ------------------------ | --------------------------------------------------------- |
| `pdfjs-dist`             | Abertura de PDF, extração de texto nativo e renderização  |
| `@napi-rs/canvas`        | Superfície de rasterização nativa usada nas renderizações |
| `@zxing/library`         | Leitura do código de barras ITF                           |
| `tesseract.js`           | Motor de OCR executado localmente em worker thread        |
| `@tesseract.js-data/por` | Dados de idioma português usados pelo OCR                 |

`@napi-rs/canvas` distribui binários pré-compilados por plataforma. Em sistemas
sem binário publicado a instalação falha; nesse caso não existe fallback puro em
JavaScript dentro deste pacote.

## Desenvolvimento local

```bash
git clone <repositorio>
cd "Cerne Boleto"
npm install
npm run build
```

O `postinstall` executa `patch-package`, que aplica `patches/prettier+3.9.4.patch`.
Instalações com `--ignore-scripts` pulam essa etapa e o `npm run format:check`
pode divergir do resultado esperado.

### Scripts disponíveis

| Script                   | O que faz                                                      |
| ------------------------ | -------------------------------------------------------------- |
| `npm run build`          | Gera ESM, CJS, `.d.ts`, sourcemaps e a CLI em `dist/` via tsup |
| `npm run typecheck`      | `tsc --noEmit`                                                 |
| `npm run lint`           | ESLint com `typescript-eslint`                                 |
| `npm run format`         | Aplica o Prettier                                              |
| `npm run format:check`   | Verifica a formatação sem escrever                             |
| `npm test`               | `node --test`                                                  |
| `npm run bench:fixtures` | Regenera as fixtures sintéticas em `bench/fixtures/`           |
| `npm run bench`          | Executa o benchmark de tempo e de estabilidade de resultado    |
| `npm run security:audit` | `npm audit --audit-level=low`                                  |
| `npm run check`          | typecheck + lint + format:check + build + test, na ordem       |

### Verificação de uma alteração

O repositório não versiona arquivos de teste: `npm test` hoje executa zero
testes e termina com sucesso de forma vacuosa. A garantia real de que uma
mudança em `src/` não alterou o resultado da extração vem do benchmark, que
compara todo o JSON de saída exceto `durationMs`:

```bash
npm run build && node bench/run.mjs --repeats 3 --save antes
```

Depois de alterar `src/`:

```bash
npm run build && node bench/run.mjs --repeats 3 --compare antes
```

Qualquer divergência em `results`, `precisionScore`, `warnings` ou `metadata` é
listada e o processo sai com código `1`. Consulte [`bench/README.md`](../bench/README.md).

### Integração contínua

`.github/workflows/ci.yml` roda `typecheck`, `lint`, `format:check`, `build` e
`test` na matriz Node 20/22/24, e `security:audit` em um job separado.

## Desinstalação

```bash
npm uninstall cerne-boleto
```

O pacote não grava arquivos fora de `node_modules`, não cria diretórios de cache
próprios e não persiste documentos em disco.
