import "dotenv/config";
import path from "path";
import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import OpenAI from "openai";

const LINE = "══════════════════════════════════════════════════";
const THIN = "──────────────────────────────────────────────────";

const SUMMARY_PROMPT = `Summarize the main points that someone by reading this text needs to learn. I want to replace reading the text with the summary which is concise, dense, rich, and useful without overwhelming the summary while being fluent, understandable, and not losing important details.`;

interface SummarizeConfig {
  inputDir: string;
  outputDir: string;
  batch: number;
  retries: number;
  model: string;
}

function parseArgs(): SummarizeConfig {
  const args = process.argv.slice(2);
  const config: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input" && args[i + 1]) {
      config.input = args[++i];
    } else if (arg === "--batch" && args[i + 1]) {
      config.batch = args[++i];
    } else if (arg === "--retries" && args[i + 1]) {
      config.retries = args[++i];
    } else if (arg === "--model" && args[i + 1]) {
      config.model = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  const batch = parseInt(config.batch ?? "1", 10);
  if (batch < 1) {
    console.error("Error: --batch must be >= 1\n");
    process.exit(1);
  }

  return {
    inputDir: path.resolve(config.input ?? "data/output"),
    outputDir: path.resolve(config.input ?? "data/output", "summarized"),
    batch,
    retries: parseInt(config.retries ?? "1", 10),
    model: config.model ?? "gpt-5.4",
  };
}

function printUsage(): void {
  console.log(`
Usage: pnpm tsx src/summarize.ts [options]

Summarizes .md files from data/output/ using an OpenAI LLM and saves
results to data/output/summarized/.

Requires: OPENAI_API_KEY in .env file.

Options:
  --input <folder>    Source folder with .md files (default: data/output)
  --batch <n>         Number of parallel LLM calls (default: 1)
  --retries <n>       Retry attempts for failed files (default: 1)
  --model <model>     OpenAI model to use (default: gpt-5.4)
  -h, --help          Show this help message

Examples:
  pnpm tsx src/summarize.ts
  pnpm tsx src/summarize.ts --batch 4
  pnpm tsx src/summarize.ts --input data/output --batch 4 --retries 2
`);
}

async function summarizeFile(
  client: OpenAI,
  filePath: string,
  model: string
): Promise<string> {
  const content = await readFile(filePath, "utf-8");

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: `${SUMMARY_PROMPT}\n\n<text>\n${content}\n</text>`,
      },
    ],
  });

  return response.choices[0]?.message?.content ?? "";
}

interface FileResult {
  filename: string;
  status: "success" | "failed";
  outputPath?: string;
  error?: string;
  timeMs: number;
}

async function processFile(
  client: OpenAI,
  config: SummarizeConfig,
  filename: string,
  index: number,
  total: number
): Promise<FileResult> {
  const filePath = path.join(config.inputDir, filename);
  const outName = filename.replace(/\.md$/, "-summary.md");
  const outPath = path.join(config.outputDir, outName);
  const startTime = Date.now();

  console.log(`[${index}/${total}] Summarizing: ${filename}...`);

  let lastError = "";
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    if (attempt > 0) {
      console.log(`  [${index}/${total}] Retry ${attempt}/${config.retries} for ${filename}...`);
    }
    try {
      const summary = await summarizeFile(client, filePath, config.model);

      if (!summary.trim()) {
        lastError = "Empty response from LLM";
        continue;
      }

      // Save immediately on success
      await writeFile(outPath, summary, "utf-8");
      const timeMs = Date.now() - startTime;

      console.log(`  [${index}/${total}] Saved: ${outName} (${(timeMs / 1000).toFixed(1)}s)`);
      return { filename, status: "success", outputPath: outPath, timeMs };
    } catch (err) {
      lastError = String(err);
    }
  }

  const timeMs = Date.now() - startTime;
  console.log(`  [${index}/${total}] FAILED: ${filename} — ${lastError}`);
  return { filename, status: "failed", error: lastError, timeMs };
}

async function main(): Promise<void> {
  const config = parseArgs();

  // Validate API key
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      'Error: OPENAI_API_KEY not found.\nSet it in your .env file: OPENAI_API_KEY=sk-...'
    );
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Find .md files (exclude summarized/ subfolder contents)
  let allFiles: string[];
  try {
    allFiles = await readdir(config.inputDir);
  } catch {
    console.error(`Error: Cannot read directory "${config.inputDir}"`);
    process.exit(1);
  }

  const mdFiles = allFiles
    .filter((f) => f.endsWith(".md") && !f.endsWith("-summary.md"))
    .sort();

  if (mdFiles.length === 0) {
    console.error(`Error: No .md files found in "${config.inputDir}"`);
    process.exit(1);
  }

  // Ensure output dir exists
  await mkdir(config.outputDir, { recursive: true });

  // Header
  const totalStart = Date.now();
  console.log(`\n${LINE}`);
  console.log(`  Summarize Tool v1.0`);
  console.log(`  Model:      ${config.model}`);
  console.log(`  Input:      ${config.inputDir} (${mdFiles.length} files)`);
  console.log(`  Output:     ${config.outputDir}/`);
  console.log(`  Parallel:   ${config.batch} | Retries: ${config.retries}`);
  console.log(`${LINE}\n`);

  // Process files in parallel batches
  const results: FileResult[] = [];
  let fileIndex = 1;

  for (let i = 0; i < mdFiles.length; i += config.batch) {
    const chunk = mdFiles.slice(i, i + config.batch);

    const batchStartIndex = fileIndex;
    const promises = chunk.map((filename, j) =>
      processFile(client, config, filename, batchStartIndex + j, mdFiles.length)
    );
    fileIndex += chunk.length;

    const batchResults = await Promise.allSettled(promises);

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else {
        results.push({
          filename: chunk[results.length % chunk.length] ?? "unknown",
          status: "failed",
          error: String(result.reason),
          timeMs: 0,
        });
      }
    }
  }

  // Summary
  const totalTimeMs = Date.now() - totalStart;
  const succeeded = results.filter((r) => r.status === "success");
  const failed = results.filter((r) => r.status === "failed");

  console.log(`\n${LINE}`);
  console.log(`  Summary`);
  console.log(`${THIN}`);
  console.log(`  Total files:    ${mdFiles.length}`);
  console.log(`  Successful:     ${succeeded.length} (${mdFiles.length > 0 ? ((succeeded.length / mdFiles.length) * 100).toFixed(0) : 0}%)`);
  console.log(`  Failed:         ${failed.length}`);
  console.log(`  Total time:     ${(totalTimeMs / 1000).toFixed(1)}s`);
  console.log(`  Output folder:  ${config.outputDir}`);

  if (succeeded.length > 0) {
    console.log(`${THIN}`);
    console.log(`  Saved files:`);
    for (const r of succeeded) {
      console.log(`    ${r.filename.replace(/\.md$/, "-summary.md")} (${(r.timeMs / 1000).toFixed(1)}s)`);
    }
  }

  if (failed.length > 0) {
    console.log(`${THIN}`);
    console.log(`  Failed files:`);
    for (const r of failed) {
      console.log(`    ${r.filename}: ${r.error}`);
    }
  }

  console.log(`${LINE}\n`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
