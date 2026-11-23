"use client";
import Image, { type ImageProps } from "next/image";
import cloudinaryLoader, { isCloudinary } from "@/lib/cloudinary-loader";

/** next/image that serves Cloudinary-hosted product photos through Cloudinary's own resizer. */
export default function StoreImage(props: ImageProps) {
  const cloud = typeof props.src === "string" && isCloudinary(props.src);
  // eslint-disable-next-line jsx-a11y/alt-text
  return <Image {...props} loader={cloud ? cloudinaryLoader : undefined} />;
}
