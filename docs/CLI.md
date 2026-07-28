# CLI

O pacote registra o binário `cerne-boleto`. A saída padrão contém **somente
JSON** — nada de logs, banners ou texto livre —, o que permite encadear com
`jq`, `ConvertFrom-Json` ou qualquer consumidor estruturado.

## Uso

```text
cerne-boleto <documento-ou-url>... [opções]
```

- **Uma fonte** produz o mesmo envelope de `extractBoletos`.
- **Duas ou mais fontes** produzem o envelope de `extractBoletoBatch`.

Cada fonte pode ser um caminho local ou uma URL HTTP/HTTPS que retorne
diretamente bytes de PDF, JPEG ou PNG. O formato é decidido pela assinatura dos
bytes, também na CLI.

```bash
cerne-boleto ./boleto.pdf --pretty
```

```bash
cerne-boleto ./a.pdf ./foto.jpeg ./conta.png --concurrency 2 --pretty
```

## Opções

| Opção                     | Valor                          | Padrão     | Efeito                                             |
| ------------------------- | ------------------------------ | ---------- | -------------------------------------------------- |
| `--performance <perfil>`  | `fast`, `balanced`, `accurate` | `balanced` | Seleciona resolução, limites e política de OCR     |
| `--passes <n>`            | `1..5`                         | do perfil  | Número de tentativas visuais distintas             |
| `--ocr <modo>`            | `never`, `fallback`, `always`  | do perfil  | Controla o OCR local em português                  |
| `--max-pages <n>`         | `1..10000`                     | do perfil  | Máximo de páginas processadas                      |
| `--max-file-size <bytes>` | `1..1073741824`                | 30 MiB     | Limite da entrada local ou remota                  |
| `--max-pixels <n>`        | `250000..100000000`            | do perfil  | Limite da área renderizada por página              |
| `--max-source-pixels <n>` | `250000..200000000`            | do perfil  | Limite da imagem de origem                         |
| `--timeout-ms <n>`        | `0..3600000`                   | do perfil  | Prazo de download e extração; `0` desabilita       |
| `--concurrency <n>`       | `1..8`                         | `1`        | Entradas simultâneas; só faz sentido com 2+ fontes |
| `--first`                 | —                              | desligado  | Equivale a `stopAfterFirst: true`                  |
| `--pretty`                | —                              | desligado  | Indenta o JSON com dois espaços                    |
| `--help`                  | —                              | —          | Imprime o descritor de ajuda em JSON e sai com `0` |

Todos os valores numéricos precisam ser inteiros não negativos. Qualquer token
que não comece com `--` é tratado como fonte, então as fontes podem aparecer
antes, depois ou entre as opções.

Não existe `--document-type`: cobrança e arrecadação são reconhecidas na mesma
execução.

## Códigos de saída

| Código | Significado                                                        |
| ------ | ------------------------------------------------------------------ |
| `0`    | `status` igual a `success`, ou `--help`                            |
| `2`    | `status` igual a `not_found` — varredura completa, nenhum boleto   |
| `1`    | `status` igual a `partial` ou `error`, incluindo erro de argumento |

O código é decidido por `status`, não por `success`. Um resultado `partial` que
encontrou boletos sai com `1`: houve truncamento ou falha, e a varredura não é
confiável como completa. Trate `1` como "revisar", não necessariamente como
"nada encontrado".

Erros de argumento também produzem JSON — um `ExtractionResult` com
`error.code === "INVALID_INPUT"` — e não texto solto em stderr.

## Sem credenciais na CLI

A CLI **não** aceita cabeçalhos nem senhas, por decisão de projeto. Para
downloads autenticados use a API com `requestHeaders`:

```ts
await extractBoletos(url, { requestHeaders: { Authorization: "Bearer <token>" } });
```

Evite tokens em strings de consulta na linha de comando: argumentos podem
aparecer no histórico do terminal e na lista de processos do sistema.

PDFs protegidos por senha retornam `PASSWORD_REQUIRED`; não há opção de senha em
nenhuma das interfaces.

## Exemplos

Extração simples, legível:

```bash
cerne-boleto ./boleto.pdf --performance balanced --pretty
```

Foto de boleto, esgotando as rotações:

```bash
cerne-boleto ./foto-boleto.jpg --performance accurate --passes 5 --pretty
```

Varredura rápida sem OCR, parando no primeiro código válido:

```bash
cerne-boleto ./boleto.pdf --performance fast --first
```

URL pública:

```bash
cerne-boleto https://documents.example.com/public/boleto.png --pretty
```

Lote com concorrência:

```bash
cerne-boleto ./a.pdf ./b.jpg ./c.png --concurrency 4 --performance balanced --pretty
```

Documento denso com prazo maior:

```bash
cerne-boleto ./lote-digitalizado.pdf --max-pages 100 --timeout-ms 600000 --pretty
```

## Consumindo a saída

Somente a linha digitável do melhor resultado:

```bash
cerne-boleto ./boleto.pdf | jq -r '.bestMatch.digitableLine'
```

Todos os códigos de barras encontrados:

```bash
cerne-boleto ./boleto.pdf | jq -r '.results[].barcode'
```

No PowerShell:

```powershell
(cerne-boleto ./boleto.pdf | ConvertFrom-Json).bestMatch.formattedDigitableLine
```

Ramificando por código de saída:

```bash
cerne-boleto ./boleto.pdf > resultado.json
case $? in
  0) echo "boleto encontrado" ;;
  2) echo "nenhum boleto no documento" ;;
  *) echo "revisar: $(jq -r '.error.code // .status' resultado.json)" ;;
esac
```

Mapeando cada boleto do lote à sua entrada:

```bash
cerne-boleto ./a.pdf ./b.pdf | jq -r '.results[] | "\(.inputIndex)\t\(.boleto.digitableLine)"'
```

Lembre que no lote os caminhos não voltam no JSON: a correspondência é feita por
`inputIndex`, na ordem em que as fontes foram passadas.

## Ajuda

```bash
cerne-boleto --help
```

Devolve um descritor JSON com `name`, `usage`, `inputFormats`, `examples` e a
lista de `options`. `--help` tem precedência sobre qualquer outro argumento e
sempre sai com `0`.
