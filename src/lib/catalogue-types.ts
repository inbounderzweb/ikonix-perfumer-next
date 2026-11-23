// Plain, serialisable catalogue shapes shared by Server and Client Components. Money is integer paise.

export type ImageDTO = { url: string; width: number; height: number; alt: string };

export type VariantDTO = {
  id: string;
  sku: string;
  label: string; // "30 ml"
  sizeValue: number | null;
  regularPrice: number;
  salePrice: number;
  inStock: boolean;
  image: ImageDTO | null;
};

export type ProductCardDTO = {
  id: string;
  slug: string;
  name: string;
  categoryName: string | null;
  image: ImageDTO | null;
  variant: VariantDTO | null; // first sellable variant (legacy cards show the first size)
  inStock: boolean;
};

export type ProductDetailDTO = ProductCardDTO & {
  description: string | null;
  subtitle: string | null;
  categorySlug: string | null;
  inspiredByName: string | null;
  notes: { top: string[]; middle: string[]; base: string[] };
  images: ImageDTO[]; // main + gallery (variant photos are reached through the variant)
  variants: VariantDTO[];
  seoTitle: string | null;
  seoDescription: string | null;
};

export type CategoryDTO = { id: string; slug: string; name: string };

export const rupees = (paise: number) => Math.round(paise / 100);
export const discountPercent = (regular: number, sale: number) =>
  regular > 0 && sale < regular ? Math.round(((regular - sale) / regular) * 100) : 0;
