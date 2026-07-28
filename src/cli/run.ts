import { extractBoletoBatch, extractBoletos } from "../extractor";
import { elapsedMilliseconds, startTimer, type MonotonicTimestamp } from "../timing";
import type { BatchExtractOptions, BatchExtractionResult, ExtractOptions, ExtractionResult } from "../types";

export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
}

interface ParsedCliArguments {
  sources: string[];
  options: ExtractOptions;
  concurrency: number;
  pretty: boolean;
}

const HELP = {
  name: "Cerne Boleto",
  usage: "cerne-boleto <document-or-url>... [--performance fast|balanced|accurate] [--passes 1..5]",
  inputFormats: ["pdf", "jpeg", "png"],
  examples: ["cerne-boleto ./boleto.pdf --pretty", "cerne-boleto ./foto-boleto.jpg --performance balanced", "cerne-boleto https://documents.example/boleto.png --first --pretty", "cerne-boleto ./boleto.pdf ./foto-boleto.jpg ./conta.png --concurrency 2 --pretty"],
  options: ["--performance <profile>", "--passes <number>", "--ocr <never|fallback|always>", "--max-pages <number>", "--max-file-size <bytes>", "--max-pixels <number>", "--max-source-pixels <number>", "--timeout-ms <number>", "--concurrency <1..8>", "--first", "--pretty", "--help"],
} as const;

class CliArgumentError extends Error {}

function integer(value: string | undefined, option: string): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    throw new CliArgumentError(`${option} requires a non-negative integer.`);
  }
  return Number(value);
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CliArgumentError(`${option} requires a value.`);
  }
  return value;
}

export function parseCliArguments(args: string[]): ParsedCliArguments | typeof HELP {
  if (args.includes("--help")) {
    return HELP;
  }

  const options: ExtractOptions = {};
  const sources: string[] = [];
  let concurrency = 1;
  let pretty = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (!argument.startsWith("--")) {
      sources.push(argument);
      continue;
    }

    switch (argument) {
      case "--performance":
        options.performance = requiredValue(args, index, argument) as ExtractOptions["performance"];
        index += 1;
        break;
      case "--passes":
        options.passes = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--ocr":
        options.ocr = requiredValue(args, index, argument) as ExtractOptions["ocr"];
        index += 1;
        break;
      case "--max-pages":
        options.maxPages = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--max-file-size":
        options.maxFileSizeBytes = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--max-pixels":
        options.maxPixelsPerPage = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--max-source-pixels":
        options.maxSourceImagePixels = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = integer(requiredValue(args, index, argument), argument);
        index += 1;
        break;
      case "--concurrency":
        concurrency = integer(requiredValue(args, index, argument), argument);
        if (concurrency < 1 || concurrency > 8) {
          throw new CliArgumentError("--concurrency must be an integer between 1 and 8.");
        }
        index += 1;
        break;
      case "--first":
        options.stopAfterFirst = true;
        break;
      case "--pretty":
        pretty = true;
        break;
      default:
        throw new CliArgumentError(`Unknown option: ${argument}.`);
    }
  }

  if (sources.length === 0) {
    throw new CliArgumentError("At least one document path or HTTP(S) URL (PDF, JPEG, or PNG) is required.");
  }

  return { sources, options, concurrency, pretty };
}

function cliError(message: string): ExtractionResult {
  return {
    status: "error",
    success: false,
    precisionScore: 0,
    bestMatch: null,
    results: [],
    metadata: {
      performance: "balanced",
      ocrMode: "fallback",
      passesRequested: 2,
      passesUsed: 0,
      pagesTotal: 0,
      pagesProcessed: 0,
      pagesRendered: 0,
      renderAttempts: 0,
      ocrPages: 0,
      fileSizeBytes: 0,
      maxPixelsPerPage: 12_000_000,
      maxSourceImagePixels: 60_000_000,
      durationMs: 0,
      complete: false,
      confidenceVersion: "1.2.0",
    },
    warnings: [],
    error: { code: "INVALID_INPUT", message },
  };
}

function finalizeCliDuration(result: ExtractionResult | BatchExtractionResult, startedAt: MonotonicTimestamp): void {
  const durationMs = elapsedMilliseconds(startedAt);
  result.metadata.durationMs = durationMs;
  if ("summary" in result) {
    result.summary.durationMs = durationMs;
  }
}

export async function runCli(args: string[], io: CliIo = { stdout: process.stdout }): Promise<number> {
  const startedAt = startTimer();
  try {
    const parsed = parseCliArguments(args);
    if ("name" in parsed) {
      io.stdout.write(`${JSON.stringify(HELP, null, 2)}\n`);
      return 0;
    }

    const result =
      parsed.sources.length === 1
        ? await extractBoletos(parsed.sources[0]!, parsed.options)
        : await extractBoletoBatch(parsed.sources, {
            ...parsed.options,
            concurrency: parsed.concurrency,
          } satisfies BatchExtractOptions);

    finalizeCliDuration(result, startedAt);
    io.stdout.write(`${JSON.stringify(result, null, parsed.pretty ? 2 : undefined)}\n`);
    if (result.status === "success") {
      return 0;
    }
    return result.status === "not_found" ? 2 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid CLI arguments.";
    const result = cliError(message);
    finalizeCliDuration(result, startedAt);
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return 1;
  }
}
