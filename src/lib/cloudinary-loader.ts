// next/image loader for Cloudinary delivery URLs: Cloudinary resizes and picks the format (f_auto,q_auto),
// so nothing is cached on the app server's disk. Safe for the client bundle (no secrets).
export const CLOUDINARY_HOST = "res.cloudinary.com";

export const isCloudinary = (src: string) => src.startsWith(`https://${CLOUDINARY_HOST}/`) && src.includes("/image/upload/");

export default function cloudinaryLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  const t = `f_auto,q_${quality ?? "auto"},c_limit,w_${width}`;
  return src.replace("/image/upload/", `/image/upload/${t}/`);
}

/** Square-cropped thumbnail URL for admin grids (non-Cloudinary urls are returned unchanged). */
export const thumb = (url: string, size = 320) =>
  isCloudinary(url) ? url.replace("/image/upload/", `/image/upload/f_auto,q_auto,c_fill,g_auto,w_${size},h_${size}/`) : url;
