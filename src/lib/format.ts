export const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const fmtDate = (d: string | Date, time = false) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", ...(time ? { timeStyle: "short" } : {}), timeZone: "Asia/Kolkata" }).format(new Date(d));

/** Category names always start each word with a capital, whatever case they were entered in. */
export const capFirst = (s: string) => s.replace(/(^|[\s(/-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
