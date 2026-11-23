import type { Metadata } from "next";
import { Breadcrumb } from "@/components/store/breadcrumb";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Get in touch with Ikonix Perfumer for custom fragrances, orders and store visits in Bengaluru.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <section className="mx-auto w-[90%] pb-20 text-[#3b312e] lg:w-[80%]">
      <Breadcrumb className="mt-[8px] pt-4" items={[{ label: "Home", href: "/" }, { label: "Contact us" }]} />
      <h1 className="pt-0 pb-6 text-center font-heading text-[32px] font-normal text-[#8C7367] md:text-[36px]">Contact us</h1>
      <div className="grid grid-cols-1 items-center gap-10 rounded-[24px] bg-[#EDE2DD] p-6 md:p-8 lg:grid-cols-[1.05fr_0.95fr] lg:p-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ikonix/site/contact.svg" alt="Customer Support Illustration" className="order-2 mx-auto w-full max-w-[520px] object-contain lg:order-1 lg:mx-0" />
        <ContactForm />
      </div>
    </section>
  );
}
