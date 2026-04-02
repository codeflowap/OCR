import type { PageContent, DocumentResult } from "./types.js";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function generateMarkdown(
  doc: DocumentResult,
  outputDir: string
): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const mdFileName =
    path.basename(doc.sourceFile, path.extname(doc.sourceFile)) + ".md";
  const outputPath = path.join(outputDir, mdFileName);

  const lines: string[] = [];

  // Document title
  const title = path.basename(doc.sourceFile, path.extname(doc.sourceFile));
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(
    `> Processed from \`${doc.sourceFile}\` in ${(doc.processingTimeMs / 1000).toFixed(1)}s`
  );
  lines.push("");

  for (const page of doc.pages) {
    lines.push(`---`);
    lines.push("");
    lines.push(`## Page ${page.pageNumber}`);

    // Metadata comment
    const meta: string[] = [`source: ${page.source}`];
    if (page.confidence !== undefined) {
      meta.push(`confidence: ${page.confidence.toFixed(1)}%`);
    }
    if (page.error) {
      meta.push(`error: ${page.error}`);
    }
    lines.push(`<!-- ${meta.join(" | ")} -->`);
    lines.push("");

    if (page.error && !page.text) {
      lines.push(`*Extraction failed: ${page.error}*`);
    } else if (page.source === "openai") {
      // OpenAI already returns structured Markdown — pass through
      lines.push(page.text);
    } else {
      // Local OCR or native text — apply heuristic formatting
      lines.push(structurePageText(page.text));
    }

    lines.push("");
  }

  const markdown = lines.join("\n");
  await writeFile(outputPath, markdown, "utf-8");
  return outputPath;
}

function structurePageText(rawText: string): string {
  const lines = rawText.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Skip standalone page numbers
    if (/^\s*\d{1,4}\s*$/.test(line)) continue;

    // Detect chapter headers
    if (/^(CHAPTER|Chapter)\s+\d+/.test(line.trim()) && line.trim().length < 80) {
      if (inCodeBlock) {
        result.push("```");
        inCodeBlock = false;
      }
      result.push(`### ${line.trim()}`);
      continue;
    }

    // Detect section headings (e.g., "12.3 Unit testing...")
    if (/^\d+\.\d+\s+[A-Z]/.test(line.trim()) && line.trim().length < 100) {
      if (inCodeBlock) {
        result.push("```");
        inCodeBlock = false;
      }
      result.push(`### ${line.trim()}`);
      continue;
    }

    // Detect code blocks
    const isCodeLine = detectCodeLine(line);

    if (isCodeLine && !inCodeBlock) {
      result.push("```");
      inCodeBlock = true;
    } else if (!isCodeLine && inCodeBlock && line.trim().length > 0) {
      result.push("```");
      result.push("");
      inCodeBlock = false;
    }

    // Detect bullet points (OCR sometimes misreads bullet chars)
    if (/^\s*[m=\-\*\u2022\u25aa]\s+/.test(line) && !inCodeBlock) {
      line = line.replace(/^\s*[m=\-\*\u2022\u25aa]\s+/, "- ");
    }

    result.push(line);
  }

  if (inCodeBlock) {
    result.push("```");
  }

  return result.join("\n");
}

function detectCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;

  // Lines with 4+ spaces of leading indentation
  if (/^ {4,}/.test(line) && trimmed.length > 0) return true;

  // Common code patterns
  const codePatterns = [
    /^(import |from |def |class |return |if |for |while |try:|except:)/,
    /^(const |let |var |function |export |async )/,
    /[{}();]$/,
    /^\s*(#|\/\/)/,
    /=\s*(input|getpass|None|True|False)\b/,
    /^\s*\w+\.\w+\(/,
    /^![\w]/,
    /^%%writefile/,
  ];

  return codePatterns.some((p) => p.test(trimmed));
}
