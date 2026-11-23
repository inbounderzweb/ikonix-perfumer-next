#!/usr/bin/env node
// Ikonix Perfumer legacy catalogue extractor (read-only GET requests against the legacy API).
//
// Usage:  node scripts/ikonix-extract/extract.mjs [--skip-details] [--concurrency=4]
//
// Credentials come from .env (API_BASE_URL, API_BEARER_TOKEN, API_COOKIE). They are never logged.
// Resumable: API responses and original image bytes are cached on disk; re-running skips what is done.
// On HTTP 401/403 it stops and asks for fresh credentials; it never tries to re-authenticate.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'public/ikonix');
const PRODUCTS_DIR = path.join(OUT, 'products');
const CATEGORIES_DIR = path.join(OUT, 'categories');
const LOGS = path.join(OUT, 'logs');
// Source backup lives outside the app (sibling folder) so it is never deployed or served.
// originals/: downloaded JPEG/PNG plus <file>.webp conversions. api-raw/: unmodified API responses.
const BACKUP = process.env.IKONIX_BACKUP_DIR ?? path.resolve(ROOT, '../ikonix-source-backup');
const RAW_DIR = path.join(BACKUP, 'api-raw');
const CACHE = path.join(BACKUP, 'originals');
const STATE_FILE = path.join(LOGS, 'image-state.json');

const SITE = 'https://ikonixperfumer.com';
const UPLOADS = `${SITE}/beta/assets/uploads/`;
const PRODUCT_URL = (id) => `${SITE}/product-details/${id}`;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const CONCURRENCY = Number(args.concurrency ?? 4);
const API_DELAY_MS = 250;
const IMG_DELAY_MS = 100;
const WEBP_MIN_PSNR = 40; // dB; below this the WebP is considered a visible quality loss

// ---------- env (only API_* keys; the rest of .env is not read) ----------
function loadApiEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^(API_[A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
  if (!env.API_BASE_URL || !env.API_BEARER_TOKEN) throw new Error('API_BASE_URL / API_BEARER_TOKEN missing in .env');
  return env;
}
const ENV = loadApiEnv();

// ---------- logging ----------
fs.mkdirSync(LOGS, { recursive: true });
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const logStream = fs.createWriteStream(path.join(LOGS, `extract-${runId}.log`), { flags: 'a' });
function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  logStream.write(line + '\n');
  if (level !== 'debug') console.log(line);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class AuthError extends Error {}

function headers(kind) {
  const h = { 'user-agent': UA, referer: `${SITE}/`, 'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8' };
  if (ENV.API_COOKIE) h.cookie = ENV.API_COOKIE;
  if (kind === 'api') {
    h.accept = 'application/json, text/plain, */*';
    h.authorization = `Bearer ${ENV.API_BEARER_TOKEN}`;
  } else {
    h.accept = 'image/avif,image/webp,image/*,*/*;q=0.8';
  }
  return h;
}

async function fetchWithRetry(url, kind, { tries = 4 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: headers(kind), signal: AbortSignal.timeout(60_000) });
      if (res.status === 401 || res.status === 403) {
        const body = (await res.text()).slice(0, 200);
        throw new AuthError(`HTTP ${res.status} for ${url} :: ${body}`);
      }
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      lastErr = e;
      const wait = 1000 * 2 ** (attempt - 1);
      log('warn', `retry ${attempt}/${tries} ${url} (${e.message}); waiting ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fsp.rename(tmp, file);
}

// ---------- phase 1: product list ----------
async function getList() {
  const file = path.join(RAW_DIR, 'products-list.json');
  if (fs.existsSync(file) && !args['refresh-list']) {
    log('info', 'product list: using cached raw response');
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  }
  const res = await fetchWithRetry(`${ENV.API_BASE_URL}/products`, 'api');
  if (!res.ok) throw new Error(`product list HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== true || !Array.isArray(json.data)) throw new Error('product list: unexpected response shape');
  await writeJson(file, json);
  log('info', `product list: fetched ${json.data.length} products`);
  return json;
}

// ---------- phase 2: product details ----------
async function getDetails(list) {
  const details = {};
  const failed = [];
  if (args['skip-details']) return { details, failed };
  let fetched = 0;
  for (const p of list) {
    const file = path.join(RAW_DIR, 'products', `${p.id}.json`);
    if (fs.existsSync(file)) {
      details[p.id] = JSON.parse(await fsp.readFile(file, 'utf8'));
      continue;
    }
    try {
      const res = await fetchWithRetry(`${ENV.API_BASE_URL}/products/${p.id}`, 'api');
      const json = await res.json();
      if (!res.ok || json.status !== true) throw new Error(`HTTP ${res.status} status=${json.status} ${json.message ?? ''}`);
      await writeJson(file, json);
      details[p.id] = json;
      fetched++;
      if (fetched % 50 === 0) log('info', `details: ${fetched} fetched this run`);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      failed.push({ id: p.id, url: `${ENV.API_BASE_URL}/products/${p.id}`, error: e.message });
      log('error', `detail ${p.id} failed: ${e.message}`);
    }
    await sleep(API_DELAY_MS);
  }
  log('info', `details: ${Object.keys(details).length}/${list.length} available, ${failed.length} failed`);
  return { details, failed };
}

// ---------- helpers ----------
const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const num = (v) => (v === null || v === undefined || String(v).trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));
const clean = (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v ?? null);

function parseMoreImages(raw) {
  if (Array.isArray(raw)) return { list: raw, error: null };
  if (!raw) return { list: [], error: null };
  try { const v = JSON.parse(raw); return { list: Array.isArray(v) ? v : [], error: Array.isArray(v) ? null : 'not an array' }; }
  catch (e) { return { list: [], error: e.message }; }
}

// Values parsed from the product's own description text. Each is null when the sentence pattern is absent.
function deriveFromDescription(desc) {
  const d = desc ?? '';
  const pick = (re) => { const m = d.match(re); return m ? m[1].trim().replace(/\.$/, '') : null; };
  const list = (s) => (s ? s.split(/,\s*|\s+and\s+/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean) : []);
  const head = d.match(/^(.+?) by (.+?) is an? (.+?) fragrance for (.+?)\./);
  return {
    inspiredByFragrance: head ? head[1].trim() : null,
    inspiredByBrand: head ? head[2].trim() : null,
    fragranceFamily: head ? head[3].trim() : null,
    genderText: head ? head[4].trim() : null,
    launchYear: num(pick(/was launched in (\d{4})/)),
    perfumers: list(pick(/The noses? behind this fragrance (?:is|are) ([^.]+)/)),
    fragranceNotes: {
      top: list(pick(/Top notes? (?:are|is) ([^;.]+)/i)),
      middle: list(pick(/(?:middle|heart) notes? (?:are|is) ([^;.]+)/i)),
      base: list(pick(/base notes? (?:are|is) ([^;.]+)/i)),
    },
  };
}
function genderFromText(t) {
  if (!t) return null;
  const s = t.toLowerCase();
  const w = /women/.test(s), m = /\bmen\b/.test(s.replace('women', ''));
  return w && m ? 'Unisex' : w ? 'Women' : m ? 'Men' : null;
}

// ---------- phase 3: images ----------
let state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
let stateDirty = 0;
async function saveState(force = false) {
  if (!force && ++stateDirty % 25 !== 0) return;
  await writeJson(STATE_FILE, state);
}

async function psnr(origBuf, webpBuf) {
  const a = await sharp(origBuf).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(webpBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return -1;
  let se = 0;
  for (let i = 0; i < a.data.length; i++) { const d = a.data[i] - b.data[i]; se += d * d; }
  const mse = se / a.data.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

// Download (cached) and convert one source file. Returns state entry.
async function processImage(file) {
  const cached = state[file];
  const cachePath = path.join(CACHE, file);
  if (cached?.status === 'ok' && fs.existsSync(cachePath)) return cached;

  const url = UPLOADS + encodeURIComponent(file);
  let buf;
  if (fs.existsSync(cachePath)) {
    buf = await fsp.readFile(cachePath);
  } else {
    const res = await fetchWithRetry(url, 'image');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    buf = Buffer.from(await res.arrayBuffer());
    if (!ct.startsWith('image/')) throw new Error(`not an image (content-type ${ct}, ${buf.length} bytes)`);
    await fsp.mkdir(CACHE, { recursive: true });
    await fsp.writeFile(cachePath, buf);
    await sleep(IMG_DELAY_MS);
  }
  const meta = await sharp(buf).metadata(); // throws if corrupt
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const isPng = meta.format === 'png';
  const webp = await sharp(buf).rotate()
    .webp(isPng ? { lossless: true, effort: 4 } : { quality: 90, effort: 4, smartSubsample: true })
    .toBuffer();
  const score = isPng ? Infinity : await psnr(buf, webp);
  const useWebp = score >= WEBP_MIN_PSNR && webp.length < buf.length;
  const entry = {
    status: 'ok', url, sha256, bytes: buf.length, format: meta.format, width: meta.width, height: meta.height,
    orientation: meta.orientation ?? null, hasAlpha: !!meta.hasAlpha,
    output: useWebp ? 'webp' : 'original', webpBytes: webp.length,
    psnr: Number.isFinite(score) ? Math.round(score * 100) / 100 : 'lossless',
    reason: useWebp ? null : score < WEBP_MIN_PSNR ? `psnr ${score.toFixed(2)} < ${WEBP_MIN_PSNR}` : 'webp not smaller than original',
  };
  if (useWebp) await fsp.writeFile(cachePath + '.webp', webp);
  state[file] = entry;
  await saveState();
  return entry;
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  });
  await Promise.all(workers);
}

async function placeImage(file, destNoExt) {
  const e = state[file];
  const src = path.join(CACHE, file) + (e.output === 'webp' ? '.webp' : '');
  const ext = e.output === 'webp' ? 'webp' : (path.extname(file).slice(1).toLowerCase() || e.format);
  const dest = `${destNoExt}.${ext}`;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
  return dest;
}
const publicPath = (abs) => '/' + path.relative(path.join(ROOT, 'public'), abs).split(path.sep).join('/');

// ---------- main ----------
async function main() {
  log('info', `run ${runId} start (concurrency ${CONCURRENCY})`);
  const listJson = await getList();
  const list = listJson.data;
  const { details, failed: failedDetails } = await getDetails(list);

  // Source record per product: detail response when available, else list entry.
  const records = list.map((p) => {
    const d = details[p.id]?.data;
    const src = d && typeof d === 'object' && !Array.isArray(d) ? d : p;
    const diff = d ? Object.keys({ ...p, ...d }).filter((k) => JSON.stringify(p[k]) !== JSON.stringify(d[k])) : null;
    return { listEntry: p, detail: details[p.id] ?? null, src, diffKeys: diff };
  });

  // Unique slugs: name slug; when several products share it, suffix every member with its id.
  const bySlug = new Map();
  for (const r of records) {
    const base = slugify(r.src.name) || `product-${r.src.id}`;
    if (!bySlug.has(base)) bySlug.set(base, []);
    bySlug.get(base).push(r);
  }
  const duplicateNameGroups = [];
  for (const [base, group] of bySlug) {
    if (group.length === 1) group[0].slug = base;
    else {
      group.forEach((r) => { r.slug = `${base}-${r.src.id}`; });
      duplicateNameGroups.push({ baseSlug: base, products: group.map((r) => ({ id: r.src.id, name: r.src.name, subtitle: r.src.subtitle, slug: r.slug, category: r.src.category_name })) });
    }
  }

  // Collect every image file with its owner(s).
  const owners = new Map(); // file -> [{productId, role}]
  const addOwner = (file, productId, role) => {
    if (!file) return;
    if (!owners.has(file)) owners.set(file, []);
    owners.get(file).push({ productId, role });
  };
  const categoryMap = new Map();
  for (const r of records) {
    const s = r.src;
    addOwner(s.image, s.id, 'main');
    r.more = parseMoreImages(s.more_images);
    r.more.list.forEach((f, i) => addOwner(f, s.id, `gallery-${i}`));
    (s.variants ?? []).forEach((v) => addOwner(v.image, s.id, `variant-${v.vid}`));
    if (!categoryMap.has(s.category_id)) categoryMap.set(s.category_id, { id: s.category_id, name: s.category_name, image: s.category_image, productIds: [] });
    categoryMap.get(s.category_id).productIds.push(s.id);
  }
  for (const c of categoryMap.values()) if (c.image) addOwner(c.image, `category:${c.id}`, 'category');

  const files = [...owners.keys()];
  const failedImages = [];
  let done = 0;
  log('info', `images: ${files.length} unique source files (${files.filter((f) => state[f]?.status === 'ok').length} already done)`);
  try {
    await pool(files, CONCURRENCY, async (file) => {
      try { await processImage(file); }
      catch (e) {
        if (e instanceof AuthError) throw e;
        state[file] = { status: 'failed', url: UPLOADS + encodeURIComponent(file), error: e.message };
        failedImages.push({ file, url: UPLOADS + encodeURIComponent(file), owners: owners.get(file), error: e.message });
        log('error', `image ${file} failed: ${e.message}`);
      }
      if (++done % 100 === 0) log('info', `images: ${done}/${files.length}`);
    });
  } finally { await saveState(true); }

  // Content-level duplicates (different file names, identical bytes).
  const byHash = new Map();
  for (const f of files) { const h = state[f]?.sha256; if (h) { if (!byHash.has(h)) byHash.set(h, []); byHash.get(h).push(f); } }
  const duplicateImageContent = [...byHash.values()].filter((g) => g.length > 1).map((g) => ({ files: g, owners: g.map((f) => owners.get(f)) }));

  // Categories
  const categories = [];
  for (const c of categoryMap.values()) {
    let image = null;
    if (c.image && state[c.image]?.status === 'ok') image = publicPath(await placeImage(c.image, path.join(CATEGORIES_DIR, slugify(c.name), 'image')));
    categories.push({ id: c.id, name: c.name, slug: slugify(c.name), parentId: null, image, sourceImageUrl: c.image ? UPLOADS + c.image : null, productCount: c.productIds.length, productIds: c.productIds });
  }

  // Products
  const products = [];
  for (const r of records) {
    const s = r.src;
    const dir = path.join(PRODUCTS_DIR, r.slug);
    const imgDir = path.join(dir, 'images');
    await fsp.rm(imgDir, { recursive: true, force: true }); // rebuilt from cache each run so stale files cannot linger
    const warnings = [];
    const place = async (file, name) => {
      if (!file) return null;
      if (state[file]?.status !== 'ok') { warnings.push(`image not available: ${file}`); return null; }
      return publicPath(await placeImage(file, path.join(imgDir, name)));
    };
    const main = await place(s.image, 'main');
    const galleryFiles = r.more.list.filter((f) => typeof f === 'string' && f.trim() !== '');
    if (r.more.error) warnings.push(`more_images could not be parsed: ${r.more.error}`);
    const emptyGallerySlots = r.more.list.length - galleryFiles.length;
    const gallery = [];
    for (let i = 0; i < galleryFiles.length; i++) { const p = await place(galleryFiles[i], `image-${String(i + 1).padStart(2, '0')}`); if (p) gallery.push(p); }

    const variants = [];
    for (const v of s.variants ?? []) {
      const regular = num(v.price), sale = num(v.sale_price);
      variants.push({
        id: v.vid,
        size: clean(v.weight),
        sizeValue: num(v.weight),
        sizeUnit: null, // the API returns only the number
        regularPrice: regular,
        salePrice: sale,
        discountPercentage: regular && sale !== null && sale < regular ? Math.round(((regular - sale) / regular) * 10000) / 100 : null,
        image: await place(v.image, `variant-${v.vid}-${slugify(String(v.weight ?? 'na'))}`),
        sourceImageUrl: v.image ? UPLOADS + v.image : null,
      });
    }
    const salePrices = variants.map((v) => v.salePrice).filter((x) => x !== null);
    const regularPrices = variants.map((v) => v.regularPrice).filter((x) => x !== null);
    const derived = deriveFromDescription(s.description);
    const cat = categoryMap.get(s.category_id);

    const originalImageUrls = [s.image, ...galleryFiles, ...(s.variants ?? []).map((v) => v.image)].filter(Boolean).map((f) => UPLOADS + f);
    const product = {
      id: s.id,
      name: s.name,
      slug: r.slug,
      subtitle: s.subtitle ?? null,
      sku: null,
      brand: null,
      category: { id: s.category_id, name: s.category_name, slug: slugify(s.category_name ?? '') },
      subcategory: null,
      description: s.description ?? null,
      shortDescription: null,
      pricing: {
        currency: 'INR',
        regularPrice: null,
        salePrice: null,
        priceRange: regularPrices.length ? {
          minRegularPrice: Math.min(...regularPrices), maxRegularPrice: Math.max(...regularPrices),
          minSalePrice: salePrices.length ? Math.min(...salePrices) : null, maxSalePrice: salePrices.length ? Math.max(...salePrices) : null,
        } : null,
        note: 'Prices exist only per variant in the source API; product-level price fields are null.',
      },
      variants,
      specifications: {
        type: null,
        gender: null,
        size: variants.map((v) => v.size).filter(Boolean),
        weight: null,
        dimensions: null,
        ingredients: [],
        fragranceNotes: derived.fragranceNotes,
      },
      derivedFromDescription: {
        note: 'Parsed from this product\'s own description text; null/empty when the sentence pattern is absent.',
        inspiredByFragrance: derived.inspiredByFragrance,
        inspiredByBrand: derived.inspiredByBrand,
        fragranceFamily: derived.fragranceFamily,
        genderText: derived.genderText,
        gender: genderFromText(derived.genderText),
        launchYear: derived.launchYear,
        perfumers: derived.perfumers,
      },
      inventory: {
        stockStatus: s.in_stock === '1' || s.in_stock === 1 ? 'in_stock' : s.in_stock === '0' || s.in_stock === 0 ? 'out_of_stock' : null,
        inStockRaw: s.in_stock ?? null,
        stockQuantity: null,
      },
      images: { main, gallery, variants: Object.fromEntries(variants.map((v) => [v.id, v.image])) },
      seo: { metaTitle: null, metaDescription: null },
      dates: { createdAt: null, updatedAt: null },
      source: {
        productUrl: PRODUCT_URL(s.id),
        apiUrl: `${ENV.API_BASE_URL}/products/${s.id}`,
        originalImageUrls,
        categoryImageUrl: cat?.image ? UPLOADS + cat.image : null,
        emptyGallerySlots,
      },
      extraction: { status: 'completed', missingFields: [], warnings, extractedAt: new Date().toISOString() },
    };
    const missing = [];
    if (!product.sku) missing.push('sku');
    if (!product.brand) missing.push('brand');
    if (!product.subcategory) missing.push('subcategory');
    if (!clean(product.description)) missing.push('description');
    if (!product.shortDescription) missing.push('shortDescription');
    if (!clean(product.subtitle)) missing.push('subtitle');
    if (!product.images.main) missing.push('images.main');
    if (!product.images.gallery.length) missing.push('images.gallery');
    if (variants.some((v) => !v.image)) missing.push('variants[].image');
    if (variants.some((v) => v.regularPrice === null)) missing.push('variants[].regularPrice');
    if (!product.specifications.fragranceNotes.top.length) missing.push('specifications.fragranceNotes');
    missing.push('stockQuantity', 'weight', 'dimensions', 'ingredients', 'seo.metaTitle', 'seo.metaDescription', 'dates');
    product.extraction.missingFields = missing;
    if (warnings.length) product.extraction.status = 'completed_with_warnings';

    await writeJson(path.join(dir, 'product.json'), product);
    await writeJson(path.join(dir, 'original-api-response.json'), {
      note: 'Unmodified source data. listEntry is this product\'s element from GET /products; detailResponse is GET /products/{id}.',
      listEntry: r.listEntry,
      detailResponse: r.detail,
      fieldsDifferingBetweenListAndDetail: r.diffKeys,
    });
    products.push(product);
  }

  // Remove product folders not produced by this run (e.g. slug changes between runs).
  const keep = new Set(products.map((p) => p.slug));
  for (const d of await fsp.readdir(PRODUCTS_DIR)) if (!keep.has(d)) { await fsp.rm(path.join(PRODUCTS_DIR, d), { recursive: true, force: true }); log('warn', `removed stale folder products/${d}`); }

  // Brands: the API has no brand field; list the inspiration brands parsed from descriptions.
  const brandMap = new Map();
  for (const p of products) {
    const b = p.derivedFromDescription.inspiredByBrand;
    if (!b) continue;
    const key = slugify(b);
    if (!brandMap.has(key)) brandMap.set(key, { slug: key, name: b, nameVariants: new Set(), productIds: [] });
    brandMap.get(key).nameVariants.add(b);
    brandMap.get(key).productIds.push(p.id);
  }
  const brands = {
    note: 'The source API has no brand field (product.brand is null). These are the inspiration brands parsed from product descriptions ("<fragrance> by <brand> is a ..."). Products whose description lacks that sentence are listed under productsWithoutParsedBrand.',
    source: 'derivedFromDescription.inspiredByBrand',
    count: brandMap.size,
    brands: [...brandMap.values()].map((b) => ({ ...b, nameVariants: [...b.nameVariants], productCount: b.productIds.length })).sort((a, b) => a.name.localeCompare(b.name)),
    productsWithoutParsedBrand: products.filter((p) => !p.derivedFromDescription.inspiredByBrand).map((p) => ({ id: p.id, name: p.name, subtitle: p.subtitle })),
  };

  // Exports
  const EXPORT = path.join(OUT, 'export');
  await writeJson(path.join(EXPORT, 'all-products.json'), { generatedAt: new Date().toISOString(), source: `${ENV.API_BASE_URL}/products`, count: products.length, products });
  await writeJson(path.join(EXPORT, 'categories.json'), { note: 'Flat list; the API exposes one category per product and no parent/child hierarchy.', count: categories.length, categories });
  await writeJson(path.join(EXPORT, 'brands.json'), brands);
  await fsp.writeFile(path.join(EXPORT, 'all-products.csv'), toCsv(products));

  const report = {
    generatedAt: new Date().toISOString(),
    runId,
    sourceApi: `${ENV.API_BASE_URL}/products`,
    totals: {
      productsReportedByApi: list.length,
      productsExtracted: products.length,
      productDetailResponsesSaved: Object.keys(details).length,
      variants: products.reduce((a, p) => a + p.variants.length, 0),
      uniqueSourceImages: files.length,
      imagesDownloaded: files.filter((f) => state[f]?.status === 'ok').length,
      imagesFailed: failedImages.length,
      imagesStoredAsWebp: files.filter((f) => state[f]?.output === 'webp').length,
      imagesKeptOriginal: files.filter((f) => state[f]?.status === 'ok' && state[f].output === 'original').length,
      categories: categories.length,
      brandsDerived: brandMap.size,
      completionPercentage: list.length ? Math.round((products.length / list.length) * 10000) / 100 : 0,
    },
    failedProductDetails: failedDetails,
    failedImageDownloads: failedImages,
    keptOriginalImages: files.filter((f) => state[f]?.status === 'ok' && state[f].output === 'original').map((f) => ({ file: f, reason: state[f].reason })),
    duplicateNameGroups,
    duplicateImageContent,
    listDetailMismatches: records.filter((r) => r.diffKeys?.length).map((r) => ({ id: r.src.id, keys: r.diffKeys })),
    productsWithWarnings: products.filter((p) => p.extraction.warnings.length).map((p) => ({ id: p.id, slug: p.slug, warnings: p.extraction.warnings })),
    missingFieldCounts: products.reduce((acc, p) => { for (const f of p.extraction.missingFields) acc[f] = (acc[f] ?? 0) + 1; return acc; }, {}),
    productsMissingInformation: products
      .filter((p) => p.extraction.missingFields.some((f) => ['description', 'subtitle', 'images.main', 'images.gallery', 'variants[].image', 'variants[].regularPrice', 'specifications.fragranceNotes'].includes(f)))
      .map((p) => ({ id: p.id, slug: p.slug, missing: p.extraction.missingFields.filter((f) => ['description', 'subtitle', 'images.main', 'images.gallery', 'variants[].image', 'variants[].regularPrice', 'specifications.fragranceNotes'].includes(f)) })),
    fieldsNotProvidedBySourceApi: ['sku', 'brand', 'subcategory', 'shortDescription', 'stockQuantity', 'weight', 'dimensions', 'ingredients', 'seo.metaTitle', 'seo.metaDescription', 'createdAt', 'updatedAt', 'variant size unit'],
    validation: null, // filled by validate.mjs
  };
  await writeJson(path.join(EXPORT, 'extraction-report.json'), report);
  log('info', `done: ${products.length}/${list.length} products, ${report.totals.imagesDownloaded}/${files.length} images, ${failedImages.length} image failures`);
}

function toCsv(products) {
  const maxV = Math.max(0, ...products.map((p) => p.variants.length));
  const cols = ['id', 'name', 'slug', 'subtitle', 'category_id', 'category_name', 'stock_status', 'in_stock_raw',
    'description', 'inspired_by_fragrance', 'inspired_by_brand', 'fragrance_family', 'gender_derived', 'launch_year',
    'notes_top', 'notes_middle', 'notes_base', 'currency', 'min_sale_price', 'max_sale_price', 'main_image', 'gallery_images',
    'variant_count'];
  for (let i = 1; i <= maxV; i++) cols.push(`variant_${i}_id`, `variant_${i}_size`, `variant_${i}_regular_price`, `variant_${i}_sale_price`, `variant_${i}_discount_pct`, `variant_${i}_image`);
  cols.push('product_url', 'original_image_urls', 'extraction_status');
  const esc = (v) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = products.map((p) => {
    const d = p.derivedFromDescription, n = p.specifications.fragranceNotes;
    const r = [p.id, p.name, p.slug, p.subtitle, p.category.id, p.category.name, p.inventory.stockStatus, p.inventory.inStockRaw,
      p.description, d.inspiredByFragrance, d.inspiredByBrand, d.fragranceFamily, d.gender, d.launchYear,
      n.top.join('; '), n.middle.join('; '), n.base.join('; '), p.pricing.currency,
      p.pricing.priceRange?.minSalePrice, p.pricing.priceRange?.maxSalePrice, p.images.main, p.images.gallery.join(' | '), p.variants.length];
    for (let i = 0; i < maxV; i++) { const v = p.variants[i]; r.push(v?.id, v?.size, v?.regularPrice, v?.salePrice, v?.discountPercentage, v?.image); }
    r.push(p.source.productUrl, p.source.originalImageUrls.join(' | '), p.extraction.status);
    return r.map(esc).join(',');
  });
  return '﻿' + [cols.join(','), ...rows].join('\r\n') + '\r\n';
}

main().catch(async (e) => {
  await saveState(true).catch(() => {});
  if (e instanceof AuthError) {
    log('error', `STOPPED: ${e.message}. Credentials expired or access was refused. Put a fresh API_BEARER_TOKEN (and API_COOKIE if needed) in .env and re-run; completed work is cached and will be skipped.`);
    process.exitCode = 2;
  } else {
    log('error', `FAILED: ${e.stack}`);
    process.exitCode = 1;
  }
}).finally(() => logStream.end());
