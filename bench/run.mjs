import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIRECTORY = fileURLToPath(new URL("./fixtures/", import.meta.url));
const RESULT_DIRECTORY = fileURLToPath(new URL("./results/", import.meta.url));
const DIST_ENTRY = new URL("../dist/index.js", import.meta.url);

const CASES = [
  ["boleto-native.pdf", "balanced"],
  ["boleto-vector.pdf", "balanced"],
  ["boleto-vector-barcode-only.pdf", "balanced"],
  ["boleto-vector-barcode-only.pdf", "fast"],
  ["boleto-scan.pdf", "balanced"],
  ["boleto-scan-barcode-only.pdf", "balanced"],
  ["boleto.png", "balanced"],
  ["boleto.jpg", "balanced"],
  ["nomatch-scan.pdf", "balanced"],
  ["nomatch.jpg", "balanced"],
  ["boleto-scan.pdf", "fast"],
  ["boleto.jpg", "fast"],
  ["boleto-scan.pdf", "accurate"],
  ["boleto.jpg", "accurate"],
  ["nomatch.jpg", "accurate"],
  ["boleto-blur.jpg", "balanced"],
  ["boleto-blur.jpg", "accurate"],
];

function parseArguments(argv) {
  const options = { save: null, compare: null, repeats: 1, filter: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--save" || flag === "--compare" || flag === "--filter") {
      if (value === undefined) {
        throw new Error(`${flag} exige um valor.`);
      }
      options[flag.slice(2)] = value;
      index += 1;
    } else if (flag === "--repeats") {
      options.repeats = Number(value);
      if (!Number.isInteger(options.repeats) || options.repeats < 1) {
        throw new Error("--repeats exige um inteiro maior que zero.");
      }
      index += 1;
    } else {
      throw new Error(`Argumento desconhecido: ${flag}`);
    }
  }
  return options;
}

function withoutTiming(result) {
  return JSON.parse(JSON.stringify(result, (key, value) => (key === "durationMs" ? 0 : value)));
}

function loadResults(label) {
  const path = join(RESULT_DIRECTORY, `${label}.json`);
  if (!existsSync(path)) {
    throw new Error(`Execução salva não encontrada: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const options = parseArguments(process.argv.slice(2));

if (!existsSync(FIXTURE_DIRECTORY)) {
  throw new Error("Fixtures ausentes. Rode `node bench/fixtures.mjs` primeiro.");
}
if (!existsSync(fileURLToPath(DIST_ENTRY))) {
  throw new Error("dist ausente. Rode `npm run build` primeiro.");
}

const { extractBoletos } = await import(DIST_ENTRY.href);
const selected = options.filter === null ? CASES : CASES.filter(([fixture, profile]) => `${fixture} [${profile}]`.includes(options.filter));
if (selected.length === 0) {
  throw new Error(`Nenhum caso corresponde a "${options.filter}".`);
}

const rows = [];
for (const [fixture, performance] of selected) {
  const data = new Uint8Array(readFileSync(join(FIXTURE_DIRECTORY, fixture)));
  const timings = [];
  let snapshot = null;
  for (let attempt = 0; attempt < options.repeats; attempt += 1) {
    const startedAt = process.hrtime.bigint();
    const result = await extractBoletos(data, { performance });
    timings.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
    snapshot ??= withoutTiming(result);
  }
  const name = `${fixture} [${performance}]`;
  rows.push({ case: name, bestMs: Number(Math.min(...timings).toFixed(1)), snapshot });
  console.log(`  ${name.padEnd(38)} ${Math.min(...timings).toFixed(0).padStart(7)} ms  ${snapshot.status.padEnd(10)} ${snapshot.results.length} resultado(s)`);
}

const totalMs = rows.reduce((sum, row) => sum + row.bestMs, 0);
console.log(`\ntotal ${totalMs.toFixed(0)} ms`);

if (options.save !== null) {
  mkdirSync(RESULT_DIRECTORY, { recursive: true });
  writeFileSync(join(RESULT_DIRECTORY, `${options.save}.json`), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`gravado em bench/results/${options.save}.json`);
}

if (options.compare !== null) {
  const baseline = new Map(loadResults(options.compare).map((row) => [row.case, row]));
  let differences = 0;
  let baselineTotal = 0;
  console.log(`\ncomparando com ${options.compare}\n`);
  console.log(`${"caso".padEnd(38)} ${"antes".padStart(9)} ${"depois".padStart(9)} ${"delta".padStart(8)}   saída`);
  for (const row of rows) {
    const previous = baseline.get(row.case);
    if (previous === undefined) {
      console.log(`${row.case.padEnd(38)} ${"—".padStart(9)} ${String(row.bestMs).padStart(9)} ${"—".padStart(8)}   caso novo`);
      continue;
    }
    baselineTotal += previous.bestMs;
    const identical = JSON.stringify(previous.snapshot) === JSON.stringify(row.snapshot);
    if (!identical) {
      differences += 1;
    }
    const delta = `${((row.bestMs / previous.bestMs - 1) * 100).toFixed(0)}%`;
    console.log(`${row.case.padEnd(38)} ${String(previous.bestMs).padStart(9)} ${String(row.bestMs).padStart(9)} ${delta.padStart(8)}   ${identical ? "idêntica" : "*** DIFERENTE ***"}`);
  }
  if (baselineTotal > 0) {
    console.log(`\ntotal ${baselineTotal.toFixed(0)} ms -> ${totalMs.toFixed(0)} ms  (${((totalMs / baselineTotal - 1) * 100).toFixed(0)}%)`);
  }
  console.log(differences === 0 ? "todas as saídas idênticas" : `${differences} caso(s) com saída diferente`);
  if (differences > 0) {
    process.exitCode = 1;
  }
}
