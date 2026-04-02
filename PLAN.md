OCR App - TypeScript PDF/Image to Markdown Converter
Context
The /Users/ahmadpour/OCR directory currently has three empty-ish folders (pdf-input/, images-of-pdf/ with 28 book page JPEGs, results/) and a README. The goal is to build a TypeScript CLI app that extracts text from PDFs and images via OCR and produces structured Markdown files. Two extraction engines: local OCR (tesseract.js) and OpenAI vision API (user's choice via --engine flag). OpenAI engine supports batching multiple images per call, parallel calls, and automatic retry of failed pages.

Project Structure

OCR/
├── src/
│   ├── index.ts              # CLI entry point, argument parsing, orchestration
│   ├── pdf-processor.ts      # PDF text extraction (pdfjs-dist) + render-to-image fallback
│   ├── ocr-processor.ts      # Tesseract.js OCR wrapper (local engine)
│   ├── openai-processor.ts   # OpenAI vision API: batching, parallelism, retry
│   ├── image-preprocessor.ts # Sharp-based image prep for local OCR
│   ├── markdown-generator.ts # Text → Markdown with heuristic formatting
│   ├── logger.ts             # Structured console logging with runtime stats
│   └── types.ts              # TypeScript interfaces
├── data/
│   ├── input/                # Drop PDFs here (moved from pdf-input/)
│   ├── images/               # Page images for OCR (moved from images-of-pdf/)
│   └── output/               # Generated .md files (moved from results/)
├── .env                      # OPENAI_API_KEY=sk-...
├── .env.example              # Template showing required env vars
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md                 # Full usage instructions
Tech Stack
Package	Purpose	Why
pdfjs-dist	PDF text extraction + page rendering	Mozilla's PDF engine, works in Node.js
canvas	Node.js Canvas API	Required by pdfjs-dist for server-side rendering
tesseract.js	Local OCR engine	WebAssembly-based, no system installs needed
sharp	Image preprocessing	Improves OCR accuracy (grayscale, threshold, sharpen)
openai	OpenAI SDK	Send images/PDFs to GPT-4o vision for extraction
dotenv	Env var loading	Load OPENAI_API_KEY from .env file
tsx	TypeScript runner	Run .ts files directly during development
typescript	Compiler	Type safety + build to JS
CLI Design
Flags:

--input <folder> (required) — path to folder; auto-detects PDFs vs images
--engine <local|openai> (optional, default: local) — extraction engine
--batch-size <n> (optional, default: 5) — how many images to send per OpenAI call
--parallel <n> (optional, default: 3) — how many OpenAI calls to run in parallel
--retries <n> (optional, default: 1) — how many times to retry failed pages

# Local OCR on images
pnpm tsx src/index.ts --input data/images

# Local OCR on PDFs
pnpm tsx src/index.ts --input data/input

# OpenAI: 3 parallel calls, 5 images per call, 1 retry
pnpm tsx src/index.ts --input data/images --engine openai --batch-size 5 --parallel 3

# OpenAI with custom settings
pnpm tsx src/index.ts --input data/input --engine openai --batch-size 10 --parallel 2 --retries 2
npm script shortcuts:


"ocr:images":        "tsx src/index.ts --input data/images",
"ocr:pdf":           "tsx src/index.ts --input data/input",
"ocr:images:openai": "tsx src/index.ts --input data/images --engine openai",
"ocr:pdf:openai":    "tsx src/index.ts --input data/input --engine openai"
OpenAI Batching & Retry Strategy
Batching: Given 28 images, --batch-size 5 and --parallel 3:

Images split into batches: [1-5], [6-10], [11-15], [16-20], [21-25], [26-28]
3 batches sent in parallel at a time → 2 rounds of parallel calls
Each API call includes multiple images in a single gpt-4o message
Retry logic per batch:

Send batch of 5 images to OpenAI → receive results
LLM returns structured response with per-page extraction
Parse response: identify which pages succeeded vs failed
Keep successful pages' results
Collect only the failed pages → retry them in a new smaller batch
Merge retry results with original successes
After --retries exhausted, mark remaining failures as errors in output
Logging
Rich terminal output showing runtime progress:


══════════════════════════════════════════════════
  OCR Tool v1.0
  Engine:     openai (gpt-4o)
  Input:      data/images (28 images detected)
  Batch size: 5 | Parallel: 3 | Retries: 1
  Output:     data/output/
══════════════════════════════════════════════════

[1/6] Sending batch pages 1-5 to OpenAI...
[2/6] Sending batch pages 6-10 to OpenAI...
[3/6] Sending batch pages 11-15 to OpenAI...
  ✓ Batch 1 complete: 5/5 pages extracted (3.2s)
  ✓ Batch 2 complete: 5/5 pages extracted (4.1s)
  ✗ Batch 3 partial:  3/5 pages extracted, 2 failed (3.8s)
    → Retrying pages 13, 14...
[4/6] Sending batch pages 16-20 to OpenAI...
[5/6] Sending batch pages 21-25 to OpenAI...
  ✓ Retry batch 3: 2/2 pages recovered (2.1s)
  ✓ Batch 4 complete: 5/5 pages extracted (3.5s)
[6/6] Sending batch pages 26-28 to OpenAI...
  ✓ Batch 5 complete: 5/5 pages extracted (3.9s)
  ✓ Batch 6 complete: 3/3 pages extracted (2.4s)

══════════════════════════════════════════════════
  Summary
──────────────────────────────────────────────────
  Total pages:    28
  Successful:     28 (100%)
  Failed:         0
  Retries used:   1 (recovered 2 pages)
  Total time:     22.8s
  Output file:    data/output/MLOps Engineering at Scale.md
══════════════════════════════════════════════════
For local OCR, similar style:


[1/28] OCR page 1: MLOps...-images-267.jpg (conf: 91.2%) — 1.8s
[2/28] OCR page 2: MLOps...-images-268.jpg (conf: 88.7%) — 2.1s
...
Implementation Steps
Step 1: Project setup
Reorganize folders: pdf-input/ → data/input/, images-of-pdf/ → data/images/, results/ → data/output/
Create package.json (ESM, all npm scripts)
Create tsconfig.json (ES2022, strict, ESNext modules, bundler resolution)
Create .gitignore (node_modules, dist, data/output, .env)
Create .env.example
Install deps: pnpm add pdfjs-dist canvas tesseract.js sharp openai dotenv + pnpm add -D typescript tsx @types/node
Step 2: Create src/types.ts
PageContent — pageNumber, text, source ("native"|"ocr"|"openai"), confidence, error?
DocumentResult — sourceFile, pages[], processingTimeMs, stats (success/fail/retry counts)
ProcessingConfig — inputDir, outputDir, imagesDir, language, nativeTextThreshold, renderDpi, engine, batchSize, parallel, retries
BatchResult — pages[] with success/fail status per page
Step 3: Create src/logger.ts
logHeader(config) — print startup banner with all settings
logBatchStart(batchNum, total, pageRange) — "[1/6] Sending batch..."
logBatchComplete(batchNum, success, failed, timeMs) — "✓ Batch 1 complete..."
logRetry(batchNum, failedPages) — "→ Retrying pages..."
logPageOcr(current, total, filename, confidence, timeMs) — local OCR per-page line
logSummary(result) — final stats box
Step 4: Create src/image-preprocessor.ts
preprocessForOcr(imagePath) → Buffer
preprocessBuffer(buffer) → Buffer
Pipeline: grayscale → normalize → sharpen → threshold(140) → PNG
Step 5: Create src/ocr-processor.ts
initOcrWorker(language) — create reusable tesseract worker
ocrImageFile(path, pageNum) → PageContent
ocrImageBuffer(buffer, pageNum) → PageContent
terminateOcrWorker() — cleanup
Step 6: Create src/openai-processor.ts
initOpenAI() — create OpenAI client, validate API key
extractBatch(images: {path, pageNum}[], config) → BatchResult
Base64-encode all images in the batch
Build a single gpt-4o message with multiple image_url content blocks
System prompt asks for structured output: "For each page, extract text as Markdown. Separate pages with <!-- PAGE N --> markers."
Parse response to split per-page results
Return which pages succeeded and which failed
processWithBatching(allImages, config) → PageContent[]
Split images into batches of config.batchSize
Run config.parallel batches concurrently using Promise pool
For each batch: call extractBatch → collect results
Gather failed pages across all batches
If failures exist and retries remain: re-batch failed pages and retry
Merge all results, sorted by page number
Step 7: Create src/pdf-processor.ts
processPdf(pdfPath, config) → PageContent[]
Per page: try native text; if < threshold, render to image
Collect rendered images → dispatch to local OCR or OpenAI batching
Step 8: Create src/markdown-generator.ts
Produces a single .md file per document (all pages combined, never one file per page)
generateMarkdown(doc, outputDir) → outputPath
Output format per page inside the file:

---
## Page 1
<!-- source: ocr | confidence: 91.2% -->

[extracted text here]

---
## Page 2
...
structurePageText(rawText, source) — apply heuristics only for local OCR; pass-through for OpenAI
--- horizontal rule as divider between every page for clear separation
Step 9: Create src/index.ts
Load dotenv
Parse all flags: --input, --engine, --batch-size, --parallel, --retries
Auto-detect folder content type
Validate env (OPENAI_API_KEY for openai engine)
Log startup header
Route to processPdfs() or processImages()
Log summary at end
Per-page error handling with continue-on-failure
try/finally for worker cleanup
Step 10: Create README.md
Full usage documentation with all flags
Setup instructions
Examples for all modes
Explanation of batching/parallelism/retry for OpenAI
Project structure
Verification
pnpm install — all deps install cleanly
pnpm run ocr:images — processes 28 JPEGs with local tesseract, logs per-page progress
pnpm run ocr:images:openai — processes with OpenAI, shows batch/parallel/retry logs
Check data/output/ for generated .md files
Verify summary stats are printed at end
