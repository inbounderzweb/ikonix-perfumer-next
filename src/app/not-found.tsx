import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto flex min-h-[70vh] w-[90%] flex-col items-center justify-center py-24 text-center">
      <h1 className="font-heading text-[36px] text-[#8C7367]">Page not found</h1>
      <p className="mt-3 font-fancy text-[#53443D]">The page you are looking for doesn’t exist or has moved.</p>
      <Link href="/shop" className="mt-8 rounded-full bg-[#b49d91] px-10 py-3 font-fancy text-[#3f342c]">Back to Shop</Link>
    </section>
  );
}
