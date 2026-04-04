import "dotenv/config";
import path from "path";
import { readdir } from "fs/promises";
import { processPdf } from "./pdf-processor.js";
import { initOcrWorker, ocrImageFile, terminateOcrWorker } from "./ocr-processor.js";
import { processImagesWithOpenAI } from "./openai-processor.js";
import { generateMarkdown } from "./markdown-generator.js";
import { logHeader, logPageOcr, logSummary, logError, logInfo } from "./logger.js";
import type {
  ProcessingConfig,
  Engine,
  DocumentResult,
  ImageEntry,
  ProcessingStats,
} from "./types.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"]);
const PDF_EXTENSIONS = new Set([".pdf"]);

function parsePageRange(value: string): { start: number; end: number } {
  const match = value.match(/^(\d+)-(\d+)$/);
  if (!match) {
    console.error(`Error: --page must be in format START-END, e.g. "12-16", got "${value}"\n`);
    process.exit(1);
  }
  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  if (start < 1 || end < start) {
    console.error(`Error: --page range invalid. Start must be >= 1 and end >= start, got "${value}"\n`);
    process.exit(1);
  }
  return { start, end };
}

function parseArgs(): Partial<ProcessingConfig> & { inputProvided: boolean } {
  const args = process.argv.slice(2);
  const config: Record<string, string> = {};
  let inputProvided = false;
  let pageRange: { start: number; end: number } | undefined;
  let imageRange: { startFile: string; endFile: string } | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input" && args[i + 1]) {
      config.input = args[++i];
      inputProvided = true;
    } else if (arg === "--engine" && args[i + 1]) {
      config.engine = args[++i];
    } else if (arg === "--batch-size" && args[i + 1]) {
      config.batchSize = args[++i];
    } else if (arg === "--parallel" && args[i + 1]) {
      config.parallel = args[++i];
    } else if (arg === "--retries" && args[i + 1]) {
      config.retries = args[++i];
    } else if (arg === "--page" && args[i + 1]) {
      pageRange = parsePageRange(args[++i]);
    } else if (arg === "--range" && args[i + 1] && args[i + 2]) {
      imageRange = { startFile: args[++i], endFile: args[++i] };
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (!inputProvided) {
    console.error("Error: --input <folder> is required.\n");
    printUsage();
    process.exit(1);
  }

  const engine = (config.engine ?? "local") as Engine;
  if (engine !== "local" && engine !== "openai") {
    console.error(`Error: --engine must be "local" or "openai", got "${engine}"\n`);
    process.exit(1);
  }

  return {
    inputProvided: true,
    inputDir: path.resolve(config.input!),
    outputDir: path.resolve("data/output"),
    language: "eng",
    nativeTextThreshold: 50,
    renderDpi: 300,
    engine,
    batchSize: parseInt(config.batchSize ?? "5", 10),
    parallel: parseInt(config.parallel ?? "3", 10),
    retries: parseInt(config.retries ?? "1", 10),
    pageRange,
    imageRange,
  };
}

function printUsage(): void {
  console.log(`
Usage: pnpm tsx src/index.ts --input <folder> [options]

Required:
  --input <folder>      Path to folder containing PDFs or images

Options:
  --engine <engine>     Extraction engine: "local" or "openai" (default: local)
  --batch-size <n>      Images per OpenAI API call (default: 5)
  --parallel <n>        Parallel OpenAI API calls (default: 3)
  --retries <n>         Retry attempts for failed pages (default: 1)
  --page <start-end>    Process only specific PDF pages, e.g. --page 12-16
  --range <start> <end> Process a range of image files, e.g. --range img-4.jpg img-7.jpg
  -h, --help            Show this help message

Examples:
  pnpm tsx src/index.ts --input data/images
  pnpm tsx src/index.ts --input data/input
  pnpm tsx src/index.ts --input data/input --page 12-16
  pnpm tsx src/index.ts --input data/images --range scan-4.png scan-9.png
  pnpm tsx src/index.ts --input data/images --engine openai --batch-size 5 --parallel 3
  pnpm tsx src/index.ts --input data/input --engine openai --batch-size 10 --parallel 2 --retries 2
`);
}

type DetectedType = "pdf" | "images";

async function detectFolderContent(
  inputDir: string
): Promise<{ type: DetectedType; files: string[] }> {
  let allFiles: string[];
  try {
    allFiles = await readdir(inputDir);
  } catch {
    console.error(`Error: Cannot read directory "${inputDir}"`);
    process.exit(1);
  }

  const pdfFiles = allFiles.filter((f) =>
    PDF_EXTENSIONS.has(path.extname(f).toLowerCase())
  );
  const imageFiles = allFiles.filter((f) =>
    IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase())
  );

  if (pdfFiles.length > 0 && imageFiles.length === 0) {
    return { type: "pdf", files: pdfFiles };
  }
  if (imageFiles.length > 0 && pdfFiles.length === 0) {
    return { type: "images", files: imageFiles.sort() };
  }
  if (pdfFiles.length > 0 && imageFiles.length > 0) {
    console.error(
      `Error: Folder contains both PDFs (${pdfFiles.length}) and images (${imageFiles.length}).` +
        `\nPlease separate them into different folders.`
    );
    process.exit(1);
  }

  console.error(
    `Error: No PDF or image files found in "${inputDir}".` +
      `\nSupported formats: PDF, JPG, JPEG, PNG, TIFF, BMP, WEBP`
  );
  process.exit(1);
}

function expandImageRange(startFile: string, endFile: string): string[] {
  // Extract prefix, numeric part, and extension from filenames
  // Supports patterns like: ggg-4.jpg, scan_001.png, page12.tiff
  const pattern = /^(.*?)(\d+)(\.\w+)$/;
  const startMatch = startFile.match(pattern);
  const endMatch = endFile.match(pattern);

  if (!startMatch || !endMatch) {
    console.error(
      `Error: --range files must contain a numeric part.\n` +
        `  Got: "${startFile}" and "${endFile}"\n` +
        `  Expected pattern: <prefix><number>.<ext> (e.g. ggg-4.jpg)`
    );
    process.exit(1);
  }

  const [, startPrefix, startNumStr, startExt] = startMatch;
  const [, endPrefix, endNumStr, endExt] = endMatch;

  if (startPrefix !== endPrefix || startExt !== endExt) {
    console.error(
      `Error: --range files must share the same prefix and extension.\n` +
        `  Start: prefix="${startPrefix}", ext="${startExt}"\n` +
        `  End:   prefix="${endPrefix}", ext="${endExt}"`
    );
    process.exit(1);
  }

  const startNum = parseInt(startNumStr, 10);
  const endNum = parseInt(endNumStr, 10);

  if (endNum < startNum) {
    console.error(
      `Error: --range end number (${endNum}) must be >= start number (${startNum}).`
    );
    process.exit(1);
  }

  // Preserve zero-padding from the original filenames
  const padLength = Math.max(startNumStr.length, endNumStr.length);
  const files: string[] = [];
  for (let n = startNum; n <= endNum; n++) {
    files.push(`${startPrefix}${String(n).padStart(padLength, "0")}${startExt}`);
  }

  return files;
}

function groupImagesByDocument(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const file of files) {
    // Try to extract document name before "-images-NNN" suffix
    const match = file.match(/^(.+?)-images-\d+\.\w+$/);
    const key = match ? match[1] : path.basename(file, path.extname(file));

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(file);
  }

  // Sort files within each group by page number
  for (const [, docFiles] of groups) {
    docFiles.sort((a, b) => {
      const numA = parseInt(a.match(/-(\d+)\.\w+$/)?.[1] ?? "0", 10);
      const numB = parseInt(b.match(/-(\d+)\.\w+$/)?.[1] ?? "0", 10);
      return numA - numB;
    });
  }

  return groups;
}

async function processImagesMode(
  config: ProcessingConfig,
  imageFiles: string[]
): Promise<void> {
  const groups = groupImagesByDocument(imageFiles);

  for (const [docName, docFiles] of groups) {
    const startTime = Date.now();
    console.log(`Processing document: ${docName} (${docFiles.length} pages)\n`);

    const images: ImageEntry[] = docFiles.map((f, i) => ({
      path: path.join(config.inputDir, f),
      pageNumber: i + 1,
      filename: f,
    }));

    let pages;
    let retriesUsed = 0;
    let pagesRecovered = 0;

    if (config.engine === "openai") {
      const result = await processImagesWithOpenAI(images, config);
      pages = result.pages;
      retriesUsed = result.retriesUsed;
      pagesRecovered = result.pagesRecovered;
    } else {
      // Local OCR
      await initOcrWorker(config.language);
      pages = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const pageStart = Date.now();
        try {
          const result = await ocrImageFile(img.path, img.pageNumber);
          const timeMs = Date.now() - pageStart;
          logPageOcr(i + 1, images.length, img.filename, result.confidence, timeMs);
          pages.push(result);
        } catch (err) {
          const timeMs = Date.now() - pageStart;
          logError(`Page ${img.pageNumber} failed: ${err}`);
          pages.push({
            pageNumber: img.pageNumber,
            text: "",
            source: "ocr" as const,
            error: `OCR failed: ${err}`,
          });
        }
      }
      await terminateOcrWorker();
    }

    const processingTimeMs = Date.now() - startTime;
    const stats: ProcessingStats = {
      totalPages: docFiles.length,
      successful: pages.filter((p) => !p.error).length,
      failed: pages.filter((p) => !!p.error).length,
      retriesUsed,
      pagesRecovered,
    };

    const doc: DocumentResult = {
      sourceFile: docName,
      pages,
      processingTimeMs,
      stats,
    };

    const outputPath = await generateMarkdown(doc, config.outputDir);
    logSummary(stats, processingTimeMs, outputPath);
  }
}

async function processPdfMode(
  config: ProcessingConfig,
  pdfFiles: string[]
): Promise<void> {
  if (config.engine === "local") {
    await initOcrWorker(config.language);
  }

  try {
    for (const file of pdfFiles) {
      const startTime = Date.now();
      console.log(`Processing: ${file}\n`);

      const pdfPath = path.join(config.inputDir, file);
      const { pages, retriesUsed, pagesRecovered } = await processPdf(pdfPath, config);

      const processingTimeMs = Date.now() - startTime;
      const stats: ProcessingStats = {
        totalPages: pages.length,
        successful: pages.filter((p) => !p.error).length,
        failed: pages.filter((p) => !!p.error).length,
        retriesUsed,
        pagesRecovered,
      };

      const doc: DocumentResult = {
        sourceFile: file,
        pages,
        processingTimeMs,
        stats,
      };

      const outputPath = await generateMarkdown(doc, config.outputDir);
      logSummary(stats, processingTimeMs, outputPath);
    }
  } finally {
    if (config.engine === "local") {
      await terminateOcrWorker();
    }
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs();
  const config = parsed as ProcessingConfig;

  // Validate OpenAI key early
  if (config.engine === "openai" && !process.env.OPENAI_API_KEY) {
    console.error(
      'Error: OPENAI_API_KEY not found.\nSet it in a .env file or export it: export OPENAI_API_KEY="sk-..."'
    );
    process.exit(1);
  }

  const { type, files } = await detectFolderContent(config.inputDir);

  // Apply --range filter for image mode
  let filteredFiles = files;
  if (config.imageRange) {
    if (type !== "images") {
      console.error("Error: --range can only be used with image folders, not PDFs.\n");
      process.exit(1);
    }
    const expanded = expandImageRange(config.imageRange.startFile, config.imageRange.endFile);
    // Only keep files that actually exist in the folder
    const fileSet = new Set(files);
    const missing: string[] = [];
    filteredFiles = [];
    for (const f of expanded) {
      if (fileSet.has(f)) {
        filteredFiles.push(f);
      } else {
        missing.push(f);
      }
    }
    if (filteredFiles.length === 0) {
      console.error(`Error: None of the files in range ${config.imageRange.startFile} to ${config.imageRange.endFile} were found in the folder.\n`);
      process.exit(1);
    }
    if (missing.length > 0) {
      console.log(`  Note: ${missing.length} file(s) in range not found, skipping: ${missing.join(", ")}\n`);
    }
  }

  if (config.pageRange && type !== "pdf") {
    console.error("Error: --page can only be used with PDF folders, not images.\n");
    process.exit(1);
  }

  logHeader(config, filteredFiles.length, type === "pdf" ? "PDFs" : "images");

  if (type === "pdf") {
    await processPdfMode(config, filteredFiles);
  } else {
    await processImagesMode(config, filteredFiles);
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
