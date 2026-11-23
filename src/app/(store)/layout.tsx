import { CartProvider } from "@/components/store/cart-context";
import { Header } from "@/components/store/header";
import { Footer } from "@/components/store/footer";

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return (
    <CartProvider>
      <Header />
      <main className="min-h-[60vh] pt-[54px] md:pt-[82px]">{children}</main>
      <Footer />
    </CartProvider>
  );
}
