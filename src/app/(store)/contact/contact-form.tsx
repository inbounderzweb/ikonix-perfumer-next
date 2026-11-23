"use client";

import { useState } from "react";

// Same behaviour as the legacy form: composes an email to the store in the visitor's mail app.
const TO = "ikonixperfumer@gmail.com";
const input = "w-full rounded-[8px] border bg-[#FDFBFA] px-4 py-[10px] focus:outline-none focus:ring-2 focus:ring-[#b49d91]/40";
const label = "font-fancy text-[12px] font-normal tracking-[0.5px] text-[#53443D]";
const empty = { first: "", last: "", email: "", phone: "", comment: "" };

export function ContactForm() {
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="order-1 w-full lg:order-2"
      onSubmit={(e) => {
        e.preventDefault();
        const subject = encodeURIComponent(`Ikonix Contact Form: Message from ${f.first} ${f.last}`.trim());
        const body = encodeURIComponent(`Name: ${f.first} ${f.last}\nEmail: ${f.email}\nPhone: ${f.phone ? `+91 ${f.phone}` : ""}\n\nMessage:\n${f.comment}`);
        window.location.href = `mailto:${TO}?subject=${subject}&body=${body}`;
        setF(empty);
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1"><label htmlFor="first" className={label}>First Name *</label><input id="first" required placeholder="First Name" className={input} value={f.first} onChange={set("first")} autoComplete="given-name" /></div>
        <div className="flex flex-col gap-1"><label htmlFor="last" className={label}>Second Name</label><input id="last" placeholder="Second Name" className={input} value={f.last} onChange={set("last")} autoComplete="family-name" /></div>
        <div className="flex flex-col gap-1"><label htmlFor="email" className={label}>Email *</label><input id="email" type="email" required placeholder="sample@gmail.com" className={input} value={f.email} onChange={set("email")} autoComplete="email" /></div>
        <div className="flex flex-col gap-1">
          <label htmlFor="phone" className={label}>Phone Number</label>
          <div className="flex w-full items-center overflow-hidden rounded-[8px] border bg-[#FDFBFA]">
            <span className="pr-2 pl-4">+91</span>
            <div className="mx-1 h-[24px] w-[1px] bg-[#4B3A34]" />
            <input id="phone" type="tel" inputMode="numeric" pattern="[6-9][0-9]{9}" title="10-digit Indian mobile number" placeholder="0000 000 000"
              className="flex-1 px-2 py-[10px] focus:outline-none" value={f.phone} onChange={set("phone")} autoComplete="tel-national" />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1"><label htmlFor="comment" className={label}>Comment *</label><textarea id="comment" required rows={4} placeholder="Comment" className={`${input} resize-none`} value={f.comment} onChange={set("comment")} /></div>
      <button type="submit" className="mt-6 w-full rounded-xl bg-[#1e2633] px-10 py-3 text-white hover:opacity-90 sm:w-auto sm:px-16">Send Message</button>
    </form>
  );
}
