#!/usr/bin/env node
// Validates public/ikonix against the cached raw API data. Read-only except for writing
// the `validation` section into export/extraction-report.json. No network access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'public/ikonix');
const PRODUCTS_DIR = path.join(OUT, 'products');
const EXPORT = path.join(OUT, 'export');
const BACKUP = process.env.IKONIX_BACKUP_DIR ?? path.resolve(ROOT, '../ikonix-source-backup');
const ORIGINALS = path.join(BACKUP, 'originals');
const UPLOADS = 'https://ikonixperfumer.com/beta/assets/uploads/';
const state = JSON.parse(fs.readFileSync(path.join(OUT, 'logs/image-state.json'), 'utf8'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const issues = { invalidJson: [], missingImageFiles: [], unreadableImages: [], wrongImageOwner: [], productionBackupMismatch: [], backupMissingOrCorrupt: [], categoryImageProblems: [], pricingMismatches: [], variantMismatches: [], fieldMismatches: [], missingProducts: [], extraFolders: [], duplicateIds: [], duplicateSlugs: [], duplicateNames: [], exportMismatches: [], productsWithoutImages: [], unreportedMissingImages: [] };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { issues.invalidJson.push({ file: path.relative(ROOT, f), error: e.message }); return null; } };
let imageReferences = 0;

// Every backed-up original must still hash to what was recorded at download; every WebP conversion must exist.
let backupOriginalsVerified = 0, backupWebpVerified = 0;
for (const [file, st] of Object.entries(state)) {
  if (st.status !== 'ok') continue;
  const orig = path.join(ORIGINALS, file);
  if (!fs.existsSync(orig)) { issues.backupMissingOrCorrupt.push({ file, problem: 'original missing' }); continue; }
  if (sha(orig) !== st.sha256) { issues.backupMissingOrCorrupt.push({ file, problem: 'original sha256 changed' }); continue; }
  backupOriginalsVerified++;
  if (st.output === 'webp') {
    if (!fs.existsSync(orig + '.webp')) issues.backupMissingOrCorrupt.push({ file, problem: 'webp conversion missing' });
    else backupWebpVerified++;
  }
}
// A production file must be byte-identical to the backup file it was produced from.
const backupSourceFor = (src) => path.join(ORIGINALS, src) + (state[src]?.output === 'webp' ? '.webp' : '');

const list = readJson(path.join(BACKUP, 'api-raw/products-list.json')).data;
const apiById = new Map(list.map((p) => [p.id, p]));
const report = readJson(path.join(EXPORT, 'extraction-report.json'));
const all = readJson(path.join(EXPORT, 'all-products.json'));
readJson(path.join(EXPORT, 'categories.json'));
readJson(path.join(EXPORT, 'brands.json'));
const failedFiles = new Set((report?.failedImageDownloads ?? []).map((f) => f.file));

const folders = fs.readdirSync(PRODUCTS_DIR).filter((d) => fs.statSync(path.join(PRODUCTS_DIR, d)).isDirectory());
const seenIds = new Map(), seenSlugs = new Map(), seenNames = new Map();
const fileOwner = new Map(); // local image path -> product id
let imageFilesChecked = 0;
const products = [];

for (const folder of folders) {
  const dir = path.join(PRODUCTS_DIR, folder);
  const p = readJson(path.join(dir, 'product.json'));
  const orig = readJson(path.join(dir, 'original-api-response.json'));
  if (!p || !orig) continue;
  products.push(p);
  if (p.slug !== folder) issues.fieldMismatches.push({ id: p.id, field: 'slug', expected: folder, actual: p.slug });
  for (const [m, k, v] of [[seenIds, 'id', p.id], [seenSlugs, 'slug', p.slug], [seenNames, 'name', p.name.trim().toLowerCase()]]) {
    if (m.has(v)) (k === 'id' ? issues.duplicateIds : k === 'slug' ? issues.duplicateSlugs : issues.duplicateNames).push({ value: v, ids: [m.get(v), p.id] });
    else m.set(v, p.id);
  }
  const api = apiById.get(p.id);
  if (!api) { issues.extraFolders.push(folder); continue; }
  if (JSON.stringify(orig.listEntry) !== JSON.stringify(api)) issues.fieldMismatches.push({ id: p.id, field: 'original-api-response.listEntry' });
  for (const [field, a, b] of [['name', p.name, api.name], ['description', p.description, api.description], ['category.id', p.category.id, api.category_id], ['subtitle', p.subtitle, api.subtitle], ['inStockRaw', p.inventory.inStockRaw, api.in_stock]])
    if (a !== b) issues.fieldMismatches.push({ id: p.id, field, expected: b, actual: a });

  // variants + pricing preserved exactly
  const av = api.variants ?? [];
  if (av.length !== p.variants.length) issues.variantMismatches.push({ id: p.id, expected: av.length, actual: p.variants.length });
  av.forEach((v, i) => {
    const pv = p.variants[i];
    if (!pv || pv.id !== v.vid || pv.size !== v.weight) issues.variantMismatches.push({ id: p.id, vid: v.vid, actualVid: pv?.id });
    if (!pv || pv.regularPrice !== Number(v.price) || pv.salePrice !== Number(v.sale_price)) issues.pricingMismatches.push({ id: p.id, vid: v.vid, api: [v.price, v.sale_price], local: [pv?.regularPrice, pv?.salePrice] });
  });

  // images: exist, decode, belong to this product's folder, match the source file they were made from
  const expected = [['main', api.image, p.images.main]];
  const gal = (JSON.parse(api.more_images || '[]') || []).filter((f) => f && f.trim());
  gal.forEach((f, i) => expected.push([`gallery-${i}`, f, p.images.gallery[i] ?? null]));
  av.forEach((v) => expected.push([`variant-${v.vid}`, v.image, p.images.variants[v.vid] ?? null]));
  if (!p.images.main && !p.images.gallery.length) issues.productsWithoutImages.push({ id: p.id, slug: p.slug });
  for (const [role, src, local] of expected) {
    if (!src) continue;
    imageReferences++;
    if (!local) {
      const reported = failedFiles.has(src) || p.extraction.warnings.some((w) => w.includes(src));
      if (!reported) issues.unreportedMissingImages.push({ id: p.id, role, src });
      continue;
    }
    if (!local.startsWith(`/ikonix/products/${p.slug}/images/`)) issues.wrongImageOwner.push({ id: p.id, role, local });
    if (fileOwner.has(local) && fileOwner.get(local) !== p.id) issues.wrongImageOwner.push({ id: p.id, role, local, alsoUsedBy: fileOwner.get(local) });
    fileOwner.set(local, p.id);
    const abs = path.join(ROOT, 'public', local);
    if (!fs.existsSync(abs)) { issues.missingImageFiles.push({ id: p.id, role, local }); continue; }
    if (!p.source.originalImageUrls.includes(UPLOADS + src)) issues.wrongImageOwner.push({ id: p.id, role, src, problem: 'source url not recorded' });
    const st = state[src];
    const bsrc = backupSourceFor(src);
    if (!fs.existsSync(bsrc) || sha(abs) !== sha(bsrc)) issues.productionBackupMismatch.push({ id: p.id, role, local, src });
    try {
      const meta = await sharp(abs).metadata();
      imageFilesChecked++;
      const rotated = st && st.output === 'webp' && [5, 6, 7, 8].includes(st.orientation); // webp was auto-oriented
      const [w, h] = rotated ? [st.height, st.width] : [st?.width, st?.height];
      if (!st || meta.width !== w || meta.height !== h) issues.wrongImageOwner.push({ id: p.id, role, local, problem: `dimensions ${meta.width}x${meta.height} != source ${w}x${h}` });
    } catch (e) { issues.unreadableImages.push({ id: p.id, role, local, error: e.message }); }
  }
  // no stray files in images/
  const referenced = new Set(expected.map((e) => e[2]).filter(Boolean).map((l) => path.basename(l)));
  const imgDir = path.join(dir, 'images');
  if (fs.existsSync(imgDir)) for (const f of fs.readdirSync(imgDir)) if (!referenced.has(f)) issues.wrongImageOwner.push({ id: p.id, problem: `unreferenced file images/${f}` });
}

for (const id of apiById.keys()) if (!seenIds.has(id)) issues.missingProducts.push(id);

// Category images
const cats = readJson(path.join(EXPORT, 'categories.json'))?.categories ?? [];
const catSources = new Map(list.map((p) => [p.category_id, p.category_image]));
for (const c of cats) {
  const src = catSources.get(c.id);
  if (!src) continue;
  imageReferences++;
  if (!c.image) { issues.categoryImageProblems.push({ id: c.id, problem: 'no local image', reportedFailed: failedFiles.has(src) }); continue; }
  const abs = path.join(ROOT, 'public', c.image);
  if (!fs.existsSync(abs)) { issues.categoryImageProblems.push({ id: c.id, problem: 'file missing', local: c.image }); continue; }
  try { await sharp(abs).metadata(); imageFilesChecked++; } catch (e) { issues.unreadableImages.push({ category: c.id, local: c.image, error: e.message }); continue; }
  if (sha(abs) !== sha(backupSourceFor(src))) issues.productionBackupMismatch.push({ category: c.id, local: c.image, src });
}

// exports agree with per-product files
const byId = new Map(products.map((p) => [p.id, p]));
if (!all || all.products.length !== products.length) issues.exportMismatches.push({ file: 'all-products.json', problem: `count ${all?.products.length} vs ${products.length} folders` });
for (const p of all?.products ?? []) {
  const local = byId.get(p.id);
  const strip = (x) => JSON.stringify({ ...x, extraction: { ...x.extraction, extractedAt: null } });
  if (!local || strip(local) !== strip(p)) issues.exportMismatches.push({ file: 'all-products.json', id: p.id });
}
const csv = fs.readFileSync(path.join(EXPORT, 'all-products.csv'), 'utf8');
const csvRows = csv.replace(/^﻿/, '').split(/\r\n(?=\d+,)/).length - 1; // header + rows; descriptions may contain newlines
if (csvRows !== products.length) issues.exportMismatches.push({ file: 'all-products.csv', problem: `${csvRows} rows vs ${products.length} products` });

const summary = {
  checkedAt: new Date().toISOString(),
  productsInApi: apiById.size,
  productFolders: folders.length,
  validProductJson: products.length,
  imageReferencesInApi: imageReferences,
  imageFilesVerified: imageFilesChecked,
  backupOriginalsVerified,
  backupWebpVerified,
  backupDir: BACKUP,
  passed: Object.entries(issues).every(([k, v]) => v.length === 0 || k === 'duplicateNames'),
  issueCounts: Object.fromEntries(Object.entries(issues).map(([k, v]) => [k, v.length])),
  notes: ['duplicateNames lists distinct product IDs whose names collide; they are kept as separate products with id-suffixed slugs (see duplicateNameGroups).'],
  issues,
};
if (report) { report.validation = summary; fs.writeFileSync(path.join(EXPORT, 'extraction-report.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ ...summary, issues: undefined }, null, 2));
process.exitCode = summary.passed ? 0 : 1;
