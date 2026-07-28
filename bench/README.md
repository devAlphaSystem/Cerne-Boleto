# Benchmark

Mede o tempo de extração e verifica que uma mudança não alterou o resultado.
As fixtures são sintéticas e determinísticas: nenhum boleto real é versionado.

## Uso

```bash
npm run build
node bench/fixtures.mjs
node bench/run.mjs
```

`bench/fixtures.mjs` só precisa rodar de novo quando o próprio gerador muda.

## Verificando uma otimização

Grave a execução de referência antes de mexer em `src/`, e confronte depois:

```bash
git stash && npm run build && node bench/run.mjs --repeats 3 --save antes
git stash pop && npm run build && node bench/run.mjs --repeats 3 --compare antes
```

A comparação ignora `durationMs` e confronta todo o resto do JSON — `results`,
`precisionScore`, `warnings` e `metadata`. Qualquer divergência é listada e o
processo sai com código 1, então a comparação serve em CI.

## Interpretando os números

O tempo varia entre 5% e 30% de uma execução para outra, principalmente nos
casos curtos: o OCR roda em uma worker thread e sofre com o escalonamento do
sistema. Use `--repeats 3` e leve a sério só as diferenças acima de ~15%, ou o
total da suíte. A saída, ao contrário do tempo, é determinística — uma
divergência ali é sempre real.

A coluna de memória é o pico de RSS durante o caso, medido por amostragem a cada
10 ms sobre uma linha de base tirada depois de um GC. Ela responde "quanta
memória este caso exige de um contêiner", não "quanta memória foi vazada" — o
residual entre casos é baixo e não aparece aqui.

O ruído é maior do que o do tempo: o RSS é contabilidade do sistema operacional e
o alocador devolve páginas quando quer, então um caso isolado pode oscilar 30%
sem que nada tenha mudado. Trate como sinal confiável o **pico máximo da suíte**,
e per-caso só com `--repeats 3` e diferenças acima de ~40%. `npm run bench` já
passa `--expose-gc`; rodando `node bench/run.mjs` direto, sem essa flag, as
linhas de base ficam sujas e os picos saem inflados.

## Casos

| Fixture                            | Caminho exercitado                                    |
| ---------------------------------- | ----------------------------------------------------- |
| `boleto-native.pdf`                | PDF só com camada de texto                            |
| `boleto-vector.pdf`                | PDF de banco: texto real e código de barras vetorial  |
| `boleto-vector-barcode-only.pdf`   | Vetorial sem linha digitável, força render e OCR      |
| `boleto-scan.pdf`                  | PDF escaneado (JPEG embutido, sem texto)              |
| `boleto-scan-barcode-only.pdf`     | Escaneado sem linha digitável                         |
| `boleto.png` / `boleto.jpg`        | Imagem avulsa                                         |
| `boleto-blur.jpg`                  | Foto degradada: derruba o código de barras, sobra OCR |
| `nomatch.jpg` / `nomatch-scan.pdf` | Página densa sem boleto: pior caso, pipeline inteiro  |

Cada um roda nos perfis que fazem diferença para aquele caminho.
