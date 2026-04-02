export type Engine = "local" | "openai";

export interface PageContent {
  pageNumber: number;
  text: string;
  source: "native" | "ocr" | "openai";
  confidence?: number;
  error?: string;
}

export interface ProcessingStats {
  totalPages: number;
  successful: number;
  failed: number;
  retriesUsed: number;
  pagesRecovered: number;
}

export interface DocumentResult {
  sourceFile: string;
  pages: PageContent[];
  processingTimeMs: number;
  stats: ProcessingStats;
}

export interface ProcessingConfig {
  inputDir: string;
  outputDir: string;
  language: string;
  nativeTextThreshold: number;
  renderDpi: number;
  engine: Engine;
  batchSize: number;
  parallel: number;
  retries: number;
}

export interface ImageEntry {
  path: string;
  pageNumber: number;
  filename: string;
}

export interface BatchResult {
  succeeded: PageContent[];
  failed: ImageEntry[];
}
