import OpenAI from "openai";
import { readFile } from "fs/promises";
import path from "path";
import type { PageContent, ImageEntry, BatchResult, ProcessingConfig } from "./types.js";
import {
  logBatchStart,
  logBatchComplete,
  logRetry,
  logRetryResult,
  logError,
} from "./logger.js";

let client: OpenAI | null = null;

export function initOpenAI(): void {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY not found. Set it in your .env file or environment variables."
    );
  }
  client = new OpenAI({ apiKey });
}

async function imageToBase64(imagePath: string): Promise<string> {
  const buffer = await readFile(imagePath);
  return buffer.toString("base64");
}

function bufferToBase64(buffer: Buffer): Promise<string> {
  return Promise.resolve(buffer.toString("base64"));
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
  };
  return mimeMap[ext] ?? "image/jpeg";
}

async function extractBatch(
  images: ImageEntry[]
): Promise<BatchResult> {
  if (!client) throw new Error("OpenAI client not initialized. Call initOpenAI() first.");

  const pageList = images.map((img) => `Page ${img.pageNumber}`).join(", ");

  const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `You are extracting text from ${images.length} document page(s): ${pageList}.\n\nFor EACH page image provided (in order), extract ALL text preserving the document structure.\nUse Markdown formatting: headings (#, ##, ###), code blocks (\`\`\`), bullet lists (-), numbered lists, tables, etc.\n\nSeparate each page's content with this exact marker on its own line:\n<!-- PAGE N -->\nwhere N is the page number.\n\nStart with <!-- PAGE ${images[0].pageNumber} --> before the first page's content.`,
    },
  ];

  for (const img of images) {
    const base64 = await imageToBase64(img.path);
    const mime = getMimeType(img.path);
    contentParts.push({
      type: "image_url",
      image_url: {
        url: `data:${mime};base64,${base64}`,
        detail: "high",
      },
    });
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: contentParts,
        },
      ],
      max_tokens: 16000,
    });

    const fullText = response.choices[0]?.message?.content ?? "";
    return parseBatchResponse(fullText, images);
  } catch (err) {
    // Entire batch failed
    return {
      succeeded: [],
      failed: images,
    };
  }
}

async function extractBatchFromBuffers(
  buffers: { buffer: Buffer; pageNumber: number }[]
): Promise<BatchResult> {
  if (!client) throw new Error("OpenAI client not initialized. Call initOpenAI() first.");

  const pageList = buffers.map((b) => `Page ${b.pageNumber}`).join(", ");
  const entries: ImageEntry[] = buffers.map((b) => ({
    path: "",
    pageNumber: b.pageNumber,
    filename: `page-${b.pageNumber}.png`,
  }));

  const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `You are extracting text from ${buffers.length} document page(s): ${pageList}.\n\nFor EACH page image provided (in order), extract ALL text preserving the document structure.\nUse Markdown formatting: headings (#, ##, ###), code blocks (\`\`\`), bullet lists (-), numbered lists, tables, etc.\n\nSeparate each page's content with this exact marker on its own line:\n<!-- PAGE N -->\nwhere N is the page number.\n\nStart with <!-- PAGE ${buffers[0].pageNumber} --> before the first page's content.`,
    },
  ];

  for (const b of buffers) {
    const base64 = await bufferToBase64(b.buffer);
    contentParts.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${base64}`,
        detail: "high",
      },
    });
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: contentParts,
        },
      ],
      max_tokens: 16000,
    });

    const fullText = response.choices[0]?.message?.content ?? "";
    return parseBatchResponse(fullText, entries);
  } catch (err) {
    return {
      succeeded: [],
      failed: entries,
    };
  }
}

function parseBatchResponse(
  fullText: string,
  images: ImageEntry[]
): BatchResult {
  const succeeded: PageContent[] = [];
  const failed: ImageEntry[] = [];

  // Split by <!-- PAGE N --> markers
  const pageMarkerRegex = /<!--\s*PAGE\s+(\d+)\s*-->/g;
  const markers: { pageNumber: number; index: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = pageMarkerRegex.exec(fullText)) !== null) {
    markers.push({
      pageNumber: parseInt(match[1], 10),
      index: match.index + match[0].length,
    });
  }

  // Extract text between markers
  const extractedPages = new Set<number>();
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index;
    const end = i + 1 < markers.length ? fullText.lastIndexOf("<!--", markers[i + 1].index) : fullText.length;
    const pageText = fullText.slice(start, end).trim();
    const pageNum = markers[i].pageNumber;

    if (pageText.length > 0) {
      succeeded.push({
        pageNumber: pageNum,
        text: pageText,
        source: "openai",
      });
      extractedPages.add(pageNum);
    }
  }

  // If no markers found but we have text and only one image, use the whole response
  if (markers.length === 0 && fullText.trim().length > 0 && images.length === 1) {
    succeeded.push({
      pageNumber: images[0].pageNumber,
      text: fullText.trim(),
      source: "openai",
    });
    extractedPages.add(images[0].pageNumber);
  }

  // Any image whose page number wasn't extracted is a failure
  for (const img of images) {
    if (!extractedPages.has(img.pageNumber)) {
      failed.push(img);
    }
  }

  return { succeeded, failed };
}

export async function processImagesWithOpenAI(
  images: ImageEntry[],
  config: ProcessingConfig
): Promise<{ pages: PageContent[]; retriesUsed: number; pagesRecovered: number }> {
  initOpenAI();

  const allPages: PageContent[] = [];
  let retriesUsed = 0;
  let pagesRecovered = 0;

  // Split into batches
  const batches: ImageEntry[][] = [];
  for (let i = 0; i < images.length; i += config.batchSize) {
    batches.push(images.slice(i, i + config.batchSize));
  }

  const totalBatches = batches.length;
  let allFailed: ImageEntry[] = [];

  // Process batches with parallelism
  for (let i = 0; i < batches.length; i += config.parallel) {
    const chunk = batches.slice(i, i + config.parallel);
    const batchPromises = chunk.map((batch, j) => {
      const batchNum = i + j + 1;
      const firstPage = batch[0].pageNumber;
      const lastPage = batch[batch.length - 1].pageNumber;
      logBatchStart(batchNum, totalBatches, `${firstPage}-${lastPage}`);

      const startTime = Date.now();
      return extractBatch(batch).then((result) => {
        const timeMs = Date.now() - startTime;
        logBatchComplete(
          batchNum,
          result.succeeded.length,
          batch.length,
          result.failed.length,
          timeMs
        );
        return result;
      });
    });

    const results = await Promise.all(batchPromises);

    for (const result of results) {
      allPages.push(...result.succeeded);
      allFailed.push(...result.failed);
    }
  }

  // Retry failed pages
  let retryAttempt = 0;
  while (allFailed.length > 0 && retryAttempt < config.retries) {
    retryAttempt++;
    retriesUsed++;

    const failedPageNums = allFailed.map((f) => f.pageNumber);
    logRetry(failedPageNums);

    const retryBatches: ImageEntry[][] = [];
    for (let i = 0; i < allFailed.length; i += config.batchSize) {
      retryBatches.push(allFailed.slice(i, i + config.batchSize));
    }

    const retryFailed: ImageEntry[] = [];
    const startTime = Date.now();

    for (let i = 0; i < retryBatches.length; i += config.parallel) {
      const chunk = retryBatches.slice(i, i + config.parallel);
      const results = await Promise.all(chunk.map((batch) => extractBatch(batch)));
      for (const result of results) {
        allPages.push(...result.succeeded);
        pagesRecovered += result.succeeded.length;
        retryFailed.push(...result.failed);
      }
    }

    const timeMs = Date.now() - startTime;
    logRetryResult(failedPageNums.length - retryFailed.length, failedPageNums.length, timeMs);

    allFailed = retryFailed;
  }

  // Mark remaining failures
  for (const failed of allFailed) {
    allPages.push({
      pageNumber: failed.pageNumber,
      text: "",
      source: "openai",
      error: `Failed after ${config.retries} retries`,
    });
  }

  // Sort by page number
  allPages.sort((a, b) => a.pageNumber - b.pageNumber);

  return { pages: allPages, retriesUsed, pagesRecovered };
}

export async function processBuffersWithOpenAI(
  buffers: { buffer: Buffer; pageNumber: number }[],
  config: ProcessingConfig
): Promise<{ pages: PageContent[]; retriesUsed: number; pagesRecovered: number }> {
  initOpenAI();

  const allPages: PageContent[] = [];
  let retriesUsed = 0;
  let pagesRecovered = 0;

  // Split into batches
  const batches: { buffer: Buffer; pageNumber: number }[][] = [];
  for (let i = 0; i < buffers.length; i += config.batchSize) {
    batches.push(buffers.slice(i, i + config.batchSize));
  }

  const totalBatches = batches.length;
  let allFailedIndices: number[] = [];

  for (let i = 0; i < batches.length; i += config.parallel) {
    const chunk = batches.slice(i, i + config.parallel);
    const batchPromises = chunk.map((batch, j) => {
      const batchNum = i + j + 1;
      const firstPage = batch[0].pageNumber;
      const lastPage = batch[batch.length - 1].pageNumber;
      logBatchStart(batchNum, totalBatches, `${firstPage}-${lastPage}`);

      const startTime = Date.now();
      return extractBatchFromBuffers(batch).then((result) => {
        const timeMs = Date.now() - startTime;
        logBatchComplete(
          batchNum,
          result.succeeded.length,
          batch.length,
          result.failed.length,
          timeMs
        );
        return { result, batch };
      });
    });

    const results = await Promise.all(batchPromises);

    for (const { result, batch } of results) {
      allPages.push(...result.succeeded);
      const succeededNums = new Set(result.succeeded.map((p) => p.pageNumber));
      for (const b of batch) {
        if (!succeededNums.has(b.pageNumber)) {
          allFailedIndices.push(
            buffers.findIndex((buf) => buf.pageNumber === b.pageNumber)
          );
        }
      }
    }
  }

  // Retry failed pages
  let retryAttempt = 0;
  while (allFailedIndices.length > 0 && retryAttempt < config.retries) {
    retryAttempt++;
    retriesUsed++;

    const failedBuffers = allFailedIndices.map((idx) => buffers[idx]);
    const failedPageNums = failedBuffers.map((b) => b.pageNumber);
    logRetry(failedPageNums);

    const retryBatches: { buffer: Buffer; pageNumber: number }[][] = [];
    for (let i = 0; i < failedBuffers.length; i += config.batchSize) {
      retryBatches.push(failedBuffers.slice(i, i + config.batchSize));
    }

    const newFailedIndices: number[] = [];
    const startTime = Date.now();

    for (let i = 0; i < retryBatches.length; i += config.parallel) {
      const chunk = retryBatches.slice(i, i + config.parallel);
      const results = await Promise.all(
        chunk.map((batch) => extractBatchFromBuffers(batch))
      );
      for (const result of results) {
        allPages.push(...result.succeeded);
        pagesRecovered += result.succeeded.length;
        for (const f of result.failed) {
          newFailedIndices.push(
            buffers.findIndex((buf) => buf.pageNumber === f.pageNumber)
          );
        }
      }
    }

    const timeMs = Date.now() - startTime;
    logRetryResult(failedPageNums.length - newFailedIndices.length, failedPageNums.length, timeMs);

    allFailedIndices = newFailedIndices;
  }

  // Mark remaining failures
  for (const idx of allFailedIndices) {
    allPages.push({
      pageNumber: buffers[idx].pageNumber,
      text: "",
      source: "openai",
      error: `Failed after ${config.retries} retries`,
    });
  }

  allPages.sort((a, b) => a.pageNumber - b.pageNumber);

  return { pages: allPages, retriesUsed, pagesRecovered };
}
