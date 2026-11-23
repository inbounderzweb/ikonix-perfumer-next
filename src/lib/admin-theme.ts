export const THEME_COOKIE = "ikx_admin_theme";
export type Theme = "light" | "dark" | "system";
export const parseTheme = (v: string | undefined): Theme => (v === "dark" || v === "light" ? v : "system");
