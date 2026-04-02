import { readFile } from "fs/promises";
import type { PageContent, ProcessingConfig } from "./types.js";
import { ocrImageBuffer } from "./ocr-processor.js";
import { processBuffersWithOpenAI } from "./openai-processor.js";
import { logPageNative, logPageRender, logPageOcr } from "./logger.js";

export async function processPdf(
  pdfPath: string,
  config: ProcessingConfig
): Promise<{ pages: PageContent[]; retriesUsed: number; pagesRecovered: number }> {
  // Dynamic imports for ESM compatibility
  const pdfjs = await import("pdfjs-dist");
  const { createCanvas } = await import("canvas");

  const data = new Uint8Array(await readFile(pdfPath));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const totalPages = pdf.numPages;

  console.log(`  Processing ${totalPages} pages...`);

  const pages: PageContent[] = [];
  const scannedBuffers: { buffer: Buffer; pageNumber: number }[] = [];
  let retriesUsed = 0;
  let pagesRecovered = 0;

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);

    // Try native text extraction first
    const textContent = await page.getTextContent();
    const nativeText = textContent.items
      .filter((item: any): item is { str: string } => "str" in item)
      .map((item: any) => item.str)
      .join(" ");

    if (nativeText.trim().length >= config.nativeTextThreshold) {
      logPageNative(i, totalPages, nativeText.length);
      pages.push({
        pageNumber: i,
        text: nativeText,
        source: "native",
      });
    } else {
      // Render page to image
      logPageRender(i, totalPages);
      const scale = config.renderDpi / 72;
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext("2d");

      await page.render({
        canvas: canvas as any,
        canvasContext: context as any,
        viewport,
      }).promise;

      const imageBuffer = canvas.toBuffer("image/png");

      if (config.engine === "local") {
        const startTime = Date.now();
        const result = await ocrImageBuffer(imageBuffer, i);
        const timeMs = Date.now() - startTime;
        logPageOcr(i, totalPages, `page-${i}.png`, result.confidence, timeMs);
        pages.push(result);
      } else {
        // Collect for batch processing with OpenAI
        scannedBuffers.push({ buffer: imageBuffer, pageNumber: i });
      }
    }

    page.cleanup();
  }

  // Process scanned pages with OpenAI in batches
  if (config.engine === "openai" && scannedBuffers.length > 0) {
    console.log(`\n  Sending ${scannedBuffers.length} scanned pages to OpenAI...\n`);
    const openaiResult = await processBuffersWithOpenAI(scannedBuffers, config);
    pages.push(...openaiResult.pages);
    retriesUsed = openaiResult.retriesUsed;
    pagesRecovered = openaiResult.pagesRecovered;
  }

  // Sort by page number
  pages.sort((a, b) => a.pageNumber - b.pageNumber);

  return { pages, retriesUsed, pagesRecovered };
}
