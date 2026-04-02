# OCR Tool

A TypeScript CLI tool that extracts text from PDF files and images, producing structured Markdown output. Supports two extraction engines:

- **Local** (default) - Uses tesseract.js for offline OCR, no API key needed
- **OpenAI** - Uses GPT-4o vision for higher quality extraction, requires an API key

## Prerequisites

- Node.js 20+
- pnpm

## Setup

```bash
# Install dependencies
pnpm install

# (Optional) For OpenAI engine, create a .env file with your API key
cp .env.example .env
# Then edit .env and set OPENAI_API_KEY=sk-...
```

## Usage

The tool takes a single required flag `--input <folder>` pointing to a folder of PDFs or images. It auto-detects the content type.

### Basic commands

```bash
# Extract text from images using local OCR (tesseract.js)
pnpm tsx src/index.ts --input data/images

# Extract text from PDFs using local OCR
pnpm tsx src/index.ts --input data/input

# Extract text from images using OpenAI GPT-4o vision
pnpm tsx src/index.ts --input data/images --engine openai

# Extract text from PDFs using OpenAI
pnpm tsx src/index.ts --input data/input --engine openai
```

### npm script shortcuts

```bash
pnpm run ocr:images          # local OCR on data/images/
pnpm run ocr:pdf             # local OCR on data/input/
pnpm run ocr:images:openai   # OpenAI on data/images/
pnpm run ocr:pdf:openai      # OpenAI on data/input/
```

### All flags

| Flag | Default | Description |
|------|---------|-------------|
| `--input <folder>` | (required) | Path to folder containing PDFs or images |
| `--engine <local\|openai>` | `local` | Extraction engine to use |
| `--batch-size <n>` | `5` | Number of images per OpenAI API call |
| `--parallel <n>` | `3` | Number of parallel OpenAI API calls |
| `--retries <n>` | `1` | Number of retry attempts for failed pages |
| `-h, --help` | | Show help message |

### OpenAI batching example

With 28 images, `--batch-size 5` and `--parallel 3`:

```bash
pnpm tsx src/index.ts --input data/images --engine openai --batch-size 5 --parallel 3 --retries 2
```

- Images are split into batches of 5: [1-5], [6-10], [11-15], [16-20], [21-25], [26-28]
- 3 batches run in parallel at a time
- If any pages fail in a batch, only the failed pages are retried (up to `--retries` times)
- Successful pages from the original call are preserved

## Output

All extracted pages are combined into a **single Markdown file** per document in `data/output/`. Pages are separated by `---` dividers with `## Page N` headings:

```markdown
# Document Title

> Processed from `filename.pdf` in 22.8s

---

## Page 1
<!-- source: ocr | confidence: 91.2% -->

[extracted text here]

---

## Page 2
<!-- source: openai -->

[extracted text here]
```

## Folder structure

```
data/
  input/     # Drop PDF files here
  images/    # Drop page images here (JPG, PNG, TIFF, BMP, WEBP)
  output/    # Generated Markdown files appear here
```

## How the engines compare

| | Local (tesseract.js) | OpenAI (GPT-4o) |
|---|---|---|
| Cost | Free | Paid (per API call) |
| Speed | ~3-8s per page | ~2-5s per page (batched) |
| Quality | Good for clean text | Excellent, understands layout |
| Offline | Yes | No |
| Code blocks | Heuristic detection | LLM understands structure |
| Tables | Basic | Good preservation |

## Project structure

```
src/
  index.ts              # CLI entry point, arg parsing, orchestration
  types.ts              # TypeScript interfaces
  logger.ts             # Structured terminal logging with progress
  image-preprocessor.ts # Sharp-based image prep for local OCR
  ocr-processor.ts      # Tesseract.js wrapper (local engine)
  openai-processor.ts   # OpenAI vision API with batching/parallelism/retry
  pdf-processor.ts      # PDF text extraction + page rendering
  markdown-generator.ts # Combines pages into single structured Markdown
```
