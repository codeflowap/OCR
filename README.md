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

# Extract only pages 12-16 from PDFs
pnpm tsx src/index.ts --input data/input --page 12-16

# Extract a range of images by filename (all files in between are inferred)
pnpm tsx src/index.ts --input data/images --range scan-4.png scan-9.png

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
| `--page <start-end>` | all pages | Process only specific PDF pages, e.g. `12-16` |
| `--range <start> <end>` | all images | Process a range of image files by name (see below) |
| `--batch-size <n>` | `5` | Number of images per OpenAI API call |
| `--parallel <n>` | `3` | Number of parallel OpenAI API calls |
| `--retries <n>` | `1` | Number of retry attempts for failed pages |
| `-h, --help` | | Show help message |

### Page and range selection

**`--page` (PDF mode):** Process only a subset of pages from each PDF. Pages are 1-indexed and inclusive:

```bash
# Process pages 12 through 16 only
pnpm tsx src/index.ts --input data/input --page 12-16
```

**`--range` (image mode):** Specify a start and end filename, and all files in between are automatically inferred from the naming pattern. The two files must share the same prefix and extension — only the numeric part changes:

```bash
# If your folder contains: report-3.png, report-4.png, report-5.png, report-6.png, report-7.png
# This processes report-4.png through report-7.png:
pnpm tsx src/index.ts --input data/images --range report-4.png report-7.png

# Works with any prefix and extension:
pnpm tsx src/index.ts --input data/images --range ggg-4.jpg ggg-7.jpg
pnpm tsx src/index.ts --input data/images --range scan_001.tiff scan_005.tiff
```

Zero-padding is preserved: `--range img-004.png img-012.png` generates `img-004.png` through `img-012.png`. Files in the range that don't exist in the folder are skipped with a warning.

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

## Summarize Service

After extracting text with the OCR tool, you can summarize the output `.md` files using an LLM. This is a separate command that reads from `data/output/`, sends each file to the LLM, and saves summaries to `data/output/summarized/`.

### Basic usage

```bash
# Summarize all extracted markdown files (reads OPENAI_API_KEY from .env)
pnpm tsx src/summarize.ts

# Run 4 files in parallel
pnpm tsx src/summarize.ts --batch 4

# Use a different model
pnpm tsx src/summarize.ts --batch 4 --model gpt-4o

# Summarize files from a custom folder with retries
pnpm tsx src/summarize.ts --input data/output --batch 4 --retries 2
```

### npm script shortcut

```bash
pnpm run summarize                  # summarize data/output/*.md
```

### Summarize flags

| Flag | Default | Description |
|------|---------|-------------|
| `--input <folder>` | `data/output` | Source folder containing `.md` files |
| `--batch <n>` | `1` | Number of parallel LLM calls |
| `--retries <n>` | `1` | Retry attempts for failed files |
| `--model <model>` | `gpt-5.4` | OpenAI model to use |
| `-h, --help` | | Show help message |

### How it works

- Reads all `.md` files from the input folder (skipping any existing `*-summary.md` files)
- Sends each file to the LLM with a summarization prompt
- With `--batch 4`, up to 4 files are processed in parallel
- Each summary is saved **immediately** when it completes — if file #3 fails, files #1, #2, and #4 are still saved
- Output goes to `data/output/summarized/<filename>-summary.md`
- Failed files are retried up to `--retries` times before being reported

## Folder structure

```
data/
  input/              # Drop PDF files here
  images/             # Drop page images here (JPG, PNG, TIFF, BMP, WEBP)
  output/             # Generated Markdown files appear here
    summarized/       # LLM summaries of the extracted text
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
  index.ts              # OCR CLI entry point, arg parsing, orchestration
  summarize.ts          # Summarize CLI — sends extracted text to LLM
  types.ts              # TypeScript interfaces
  logger.ts             # Structured terminal logging with progress
  image-preprocessor.ts # Sharp-based image prep for local OCR
  ocr-processor.ts      # Tesseract.js wrapper (local engine)
  openai-processor.ts   # OpenAI vision API with batching/parallelism/retry
  pdf-processor.ts      # PDF text extraction + page rendering
  markdown-generator.ts # Combines pages into single structured Markdown
```
