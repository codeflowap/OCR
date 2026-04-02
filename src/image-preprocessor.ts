import sharp from "sharp";

export async function preprocessForOcr(imagePath: string): Promise<Buffer> {
  return sharp(imagePath)
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .threshold(140)
    .png()
    .toBuffer();
}

export async function preprocessBuffer(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .threshold(140)
    .png()
    .toBuffer();
}
