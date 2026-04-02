import type { ProcessingConfig, ProcessingStats } from "./types.js";

const LINE = "══════════════════════════════════════════════════";
const THIN = "──────────────────────────────────────────────────";

export function logHeader(config: ProcessingConfig, fileCount: number, fileType: string): void {
  console.log(`\n${LINE}`);
  console.log(`  OCR Tool v1.0`);
  console.log(`  Engine:     ${config.engine}${config.engine === "openai" ? " (gpt-4o)" : " (tesseract.js)"}`);
  console.log(`  Input:      ${config.inputDir} (${fileCount} ${fileType} detected)`);
  if (config.engine === "openai") {
    console.log(`  Batch size: ${config.batchSize} | Parallel: ${config.parallel} | Retries: ${config.retries}`);
  }
  console.log(`  Output:     ${config.outputDir}/`);
  console.log(`${LINE}\n`);
}

export function logBatchStart(batchNum: number, totalBatches: number, pageRange: string): void {
  console.log(`[${batchNum}/${totalBatches}] Sending batch pages ${pageRange} to OpenAI...`);
}

export function logBatchComplete(
  batchNum: number,
  successCount: number,
  totalCount: number,
  failedCount: number,
  timeMs: number
): void {
  const timeStr = (timeMs / 1000).toFixed(1);
  if (failedCount === 0) {
    console.log(`  ✓ Batch ${batchNum} complete: ${successCount}/${totalCount} pages extracted (${timeStr}s)`);
  } else {
    console.log(
      `  ✗ Batch ${batchNum} partial:  ${successCount}/${totalCount} pages extracted, ${failedCount} failed (${timeStr}s)`
    );
  }
}

export function logRetry(failedPages: number[]): void {
  console.log(`    → Retrying pages ${failedPages.join(", ")}...`);
}

export function logRetryResult(recovered: number, total: number, timeMs: number): void {
  const timeStr = (timeMs / 1000).toFixed(1);
  if (recovered === total) {
    console.log(`  ✓ Retry: ${recovered}/${total} pages recovered (${timeStr}s)`);
  } else {
    console.log(`  ✗ Retry: ${recovered}/${total} pages recovered (${timeStr}s)`);
  }
}

export function logPageOcr(
  current: number,
  total: number,
  filename: string,
  confidence: number | undefined,
  timeMs: number
): void {
  const timeStr = (timeMs / 1000).toFixed(1);
  const confStr = confidence !== undefined ? ` (conf: ${confidence.toFixed(1)}%)` : "";
  const shortName = filename.length > 40 ? filename.slice(0, 37) + "..." : filename;
  console.log(`[${current}/${total}] OCR page ${current}: ${shortName}${confStr} — ${timeStr}s`);
}

export function logPageNative(current: number, total: number, charCount: number): void {
  console.log(`[${current}/${total}] Native text extracted (${charCount} chars)`);
}

export function logPageRender(current: number, total: number): void {
  console.log(`[${current}/${total}] Rendering page for OCR...`);
}

export function logInfo(message: string): void {
  console.log(`  ${message}`);
}

export function logError(message: string): void {
  console.error(`  ✗ ${message}`);
}

export function logSummary(stats: ProcessingStats, totalTimeMs: number, outputFile: string): void {
  const timeStr = (totalTimeMs / 1000).toFixed(1);
  const successRate = stats.totalPages > 0 ? ((stats.successful / stats.totalPages) * 100).toFixed(0) : "0";

  console.log(`\n${LINE}`);
  console.log(`  Summary`);
  console.log(`${THIN}`);
  console.log(`  Total pages:    ${stats.totalPages}`);
  console.log(`  Successful:     ${stats.successful} (${successRate}%)`);
  console.log(`  Failed:         ${stats.failed}`);
  if (stats.retriesUsed > 0) {
    console.log(`  Retries used:   ${stats.retriesUsed} (recovered ${stats.pagesRecovered} pages)`);
  }
  console.log(`  Total time:     ${timeStr}s`);
  console.log(`  Output file:    ${outputFile}`);
  console.log(`${LINE}\n`);
}
