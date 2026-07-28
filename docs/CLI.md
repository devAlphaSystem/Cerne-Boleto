# CLI

O pacote registra o executável `cerne-boleto`, gerado a partir de [`src/cli.ts`](../src/cli.ts) e [`src/cli/run.ts`](../src/cli/run.ts).

## Sintaxe

```text
cerne-boleto <documento-ou-url>... [opções]
```

Ao menos uma fonte é obrigatória, exceto com `--help`. Cada fonte pode ser um caminho local ou uma URL completa HTTP(S) para PDF, JPEG ou PNG.

```bash
cerne-boleto ./boleto.pdf --pretty
cerne-boleto ./foto-boleto.jpg --performance balanced
cerne-boleto https://documents.example/boleto.png --first --pretty
cerne-boleto ./boleto.pdf ./foto-boleto.jpg ./conta.png --concurrency 2 --pretty
```

No Windows, coloque caminhos com espaços entre aspas:

```powershell
cerne-boleto "C:\Documentos\boleto julho.pdf" --pretty
```

## Opções

| Opção                 | Valor                            | Padrão       | Descrição                                     |
| --------------------- | -------------------------------- | ------------ | --------------------------------------------- |
| `--performance`       | `fast`, `balanced` ou `accurate` | `balanced`   | seleciona o perfil de recursos e precisão     |
| `--passes`            | inteiro de 1 a 5                 | perfil       | máximo de receitas de renderização por página |
| `--ocr`               | `never`, `fallback` ou `always`  | perfil       | controla a participação do OCR                |
| `--max-pages`         | inteiro de 1 a 10.000            | perfil       | páginas máximas por documento                 |
| `--max-file-size`     | bytes, inteiro                   | 31.457.280   | tamanho máximo de cada fonte                  |
| `--max-pixels`        | pixels, inteiro                  | perfil       | área máxima por página renderizada            |
| `--max-source-pixels` | pixels, inteiro                  | perfil       | área máxima da imagem-fonte                   |
| `--timeout-ms`        | milissegundos, inteiro           | perfil       | prazo por extração; `0` desabilita            |
| `--concurrency`       | inteiro de 1 a 8                 | `1`          | concorrência quando há várias fontes          |
| `--first`             | sem valor                        | desabilitado | encerra após a primeira evidência válida      |
| `--pretty`            | sem valor                        | desabilitado | formata o JSON com indentação de dois espaços |
| `--help`              | sem valor                        | —            | escreve a descrição JSON da CLI e termina     |

Os limites numéricos completos são os mesmos da API e estão em [API.md](API.md#opções-de-extração). O parser da CLI aceita somente inteiros decimais não negativos; a validação da API resolve as faixas específicas.

`--concurrency` é usado somente quando há mais de uma fonte. Com uma única fonte, a CLI chama `extractBoletos` diretamente.

## Saída

A CLI escreve exatamente um documento JSON seguido de quebra de linha em `stdout`:

- uma fonte: `ExtractionResult`;
- duas ou mais fontes: `BatchExtractionResult`;
- ajuda: descritor com nome, uso, formatos, exemplos e opções;
- argumento inválido: `ExtractionResult` de erro com código `INVALID_INPUT`.

Sem `--pretty`, o JSON é compacto. A saída de negócio não é enviada a `stderr`; consumidores automatizados devem ler `stdout` e também verificar o código do processo.

Exemplo de inspeção com PowerShell:

```powershell
$result = cerne-boleto .\boleto.pdf | ConvertFrom-Json
if ($result.success) {
  $result.bestMatch.formattedDigitableLine
}
```

## Códigos de saída

| Código | Condição                                            |
| -----: | --------------------------------------------------- |
|    `0` | `--help` ou resultado com `status: "success"`       |
|    `2` | resultado com `status: "not_found"`                 |
|    `1` | resultado `partial`, `error` ou falha de argumentos |

Um resultado `partial` pode conter boletos válidos. Não descarte o JSON apenas porque o código de processo é `1`; inspecione `results`, `warnings`, `error` e `metadata.complete`.

## Exemplos operacionais

### Priorizar velocidade em PDF com texto

```bash
cerne-boleto ./boleto.pdf --performance fast --pretty
```

O perfil `fast` usa um pass, não ativa OCR por padrão e limita a 10 páginas.

### Forçar OCR de um documento digitalizado

```bash
cerne-boleto ./digitalizacao.pdf --ocr always --performance accurate --pretty
```

### Limitar recursos

```bash
cerne-boleto ./entrada.pdf --max-pages 5 --max-file-size 10485760 --timeout-ms 45000
```

Se o documento tiver mais de cinco páginas, a execução pode retornar `partial` e um aviso de truncamento, mesmo que já tenha encontrado resultados. `--first` muda a política de término e permite considerar completa a execução encerrada após a primeira evidência.

### Processar lote conservador

```bash
cerne-boleto ./a.pdf ./b.png ./c.jpg --concurrency 2 --performance balanced --pretty
```

A ordem em `items` segue a ordem dos argumentos, mesmo que as extrações terminem em momentos diferentes.

## Limitações da CLI

- Não há opções para cabeçalhos HTTP; use `extractBoletos` ou descritores de lote na API.
- Não há opção de senha para PDF criptografado.
- Não há separador `--` para encerrar opções; uma fonte cujo texto começa por `--` é interpretada como opção.
- A CLI não lê bytes do `stdin`; cada fonte deve ser caminho ou URL.
- A CLI não cria servidor nem mantém processo residente.

Para diagnóstico, use `status`, `error.code`, `warnings` e `metadata.complete` no JSON e consulte os [códigos de erro da API](API.md#códigos-de-erro-de-extração). Ao aceitar URLs ou documentos não confiáveis, valide os destinos, limite os recursos e evite registrar cabeçalhos ou dados extraídos.
