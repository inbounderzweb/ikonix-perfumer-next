/** Orders placed on this site: IKX-YYMMDD-NNNNN. */
export const ORDER_NUMBER_RE = /^IKX-\d{6}-\d{5}$/;
/** Orders imported from the previous website (read-only history): IKX-L-NNNNNN. */
export const LEGACY_ORDER_NUMBER_RE = /^IKX-L-\d{6}$/;
/** Order numbers that may be *viewed*. Payment, notification and admin write paths keep using ORDER_NUMBER_RE only. */
export const isViewableOrderNumber = (s: string) => ORDER_NUMBER_RE.test(s) || LEGACY_ORDER_NUMBER_RE.test(s);
export const isLegacyOrderNumber = (s: string) => LEGACY_ORDER_NUMBER_RE.test(s);
