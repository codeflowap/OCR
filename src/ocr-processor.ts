import Tesseract from "tesseract.js";
import { preprocessForOcr, preprocessBuffer } from "./image-preprocessor.js";
import type { PageContent } from "./types.js";

let worker: Tesseract.Worker | null = null;

export async function initOcrWorker(language: string = "eng"): Promise<void> {
  worker = await Tesseract.createWorker(language);
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    preserve_interword_spaces: "1",
  });
}

export async function ocrImageFile(
  imagePath: string,
  pageNumber: number
): Promise<PageContent> {
  if (!worker) throw new Error("OCR worker not initialized. Call initOcrWorker() first.");

  const preprocessed = await preprocessForOcr(imagePath);
  const { data } = await worker.recognize(preprocessed);

  return {
    pageNumber,
    text: data.text,
    source: "ocr",
    confidence: data.confidence,
  };
}

export async function ocrImageBuffer(
  buffer: Buffer,
  pageNumber: number
): Promise<PageContent> {
  if (!worker) throw new Error("OCR worker not initialized. Call initOcrWorker() first.");

  const preprocessed = await preprocessBuffer(buffer);
  const { data } = await worker.recognize(preprocessed);

  return {
    pageNumber,
    text: data.text,
    source: "ocr",
    confidence: data.confidence,
  };
}

export async function terminateOcrWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
