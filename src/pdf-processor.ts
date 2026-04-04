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
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("canvas");

  const data = new Uint8Array(await readFile(pdfPath));
  const pdf = await pdfjs.getDocument({ data }).promise;
  const totalPages = pdf.numPages;

  const startPage = config.pageRange ? Math.min(config.pageRange.start, totalPages) : 1;
  const endPage = config.pageRange ? Math.min(config.pageRange.end, totalPages) : totalPages;

  if (config.pageRange) {
    console.log(`  Processing pages ${startPage}-${endPage} of ${totalPages} total...`);
  } else {
    console.log(`  Processing ${totalPages} pages...`);
  }

  const pages: PageContent[] = [];
  const scannedBuffers: { buffer: Buffer; pageNumber: number }[] = [];
  let retriesUsed = 0;
  let pagesRecovered = 0;

  for (let i = startPage; i <= endPage; i++) {
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

      try {
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
      } catch (renderErr) {
        // pdfjs render can fail on pages with embedded images in Node.js
        // Fall back to whatever native text we have, even if below threshold
        if (nativeText.trim().length > 0) {
          console.log(`  [${i}/${totalPages}] Render failed, using partial native text (${nativeText.trim().length} chars)`);
          pages.push({
            pageNumber: i,
            text: nativeText,
            source: "native",
          });
        } else {
          console.log(`  [${i}/${totalPages}] Render failed, no text available: ${renderErr}`);
          pages.push({
            pageNumber: i,
            text: "",
            source: "ocr" as const,
            error: `Render failed: ${renderErr}`,
          });
        }
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
