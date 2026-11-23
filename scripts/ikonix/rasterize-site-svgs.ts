// The design export ships several homepage graphics as SVG files that are really one large embedded PNG/JPEG
// (makeperfume.svg alone is 19.8 MB). Browsers download them in full, next/image cannot resize SVGs, and React
// preloads plain <img> tags, so they delay the hero. This renders each SVG once (vector overlays, rounded
// corners and text included, so it looks identical) to a WebP sized for its largest on-screen use (~2x).
// Originals are left untouched. Output: public/ikonix/site/raster/<name>.webp
// Usage: npx tsx scripts/ikonix/rasterize-site-svgs.ts
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = path.join(process.cwd(), "public/ikonix/site");
const OUT = path.join(DIR, "raster");

// [file, output width in px]: about 2x the largest displayed width, capped at the embedded image's own size.
const JOBS: [string, number][] = [
  ["makeperfume.svg", 1000], // shown up to 440 px wide
  ["BrandShowcaseBanner.svg", 2880], // full-width desktop banner, embedded image is 2880 px
  ["BrandShowcaseBanner_mobile.svg", 1086], // full-width mobile banner, embedded image is 1086 px
  ["instapage.svg", 1080], // up to ~400 px wide
  ["info.svg", 1080], ["info1.svg", 1080], ["info2.svg", 1080], // collection tiles, up to ~420 px wide
  ["test1.svg", 200], ["test2.svg", 200], ["test3.svg", 200], // 64 px avatars, embedded image is 200 px
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [file, width] of JOBS) {
    const src = path.join(DIR, file);
    const svg = fs.readFileSync(src);
    const meta = await sharp(svg, { unlimited: true }).metadata(); // trusted local design files; librsvg otherwise rejects the huge data: URI
    if (!meta.width || !meta.height) throw new Error(`${file}: no intrinsic size`);
    const density = Math.min(2400, (72 * width) / meta.width); // render the vector at the target size, not upscaled
    const out = path.join(OUT, file.replace(/\.svg$/, ".webp"));
    const info = await sharp(svg, { density, unlimited: true, limitInputPixels: false }).resize({ width }).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(out);
    console.log(`${file.padEnd(32)} ${(svg.length / 1024).toFixed(0).padStart(6)} KB → ${path.basename(out).padEnd(32)} ${(info.size / 1024).toFixed(0).padStart(5)} KB  ${info.width}x${info.height}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
