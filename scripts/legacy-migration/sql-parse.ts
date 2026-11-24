// Minimal, dependency-free reader for the legacy MySQL dump (mysqldump INSERT format).
// Read-only: it only parses text. It never connects to any database.
import fs from "node:fs";

export type Row = Record<string, string | number | null>;
export type Tables = Record<string, Row[]>;

/** Parses every `INSERT INTO `t` (cols) VALUES (...),(...);` statement of a mysqldump file. */
export function parseDump(file: string): Tables {
  const sql = fs.readFileSync(file, "utf8");
  const tables: Tables = {};
  const head = /INSERT INTO `(\w+)` \(([^)]*)\) VALUES\s*/g;
  let m: RegExpExecArray | null;
  while ((m = head.exec(sql))) {
    const cols = m[2].split(",").map((c) => c.trim().replace(/`/g, ""));
    const { rows, end } = parseTuples(sql, head.lastIndex, cols);
    (tables[m[1]] ??= []).push(...rows);
    head.lastIndex = end;
  }
  return tables;
}

const ESC: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0", b: "\b", Z: "\x1a" };

function parseTuples(s: string, start: number, cols: string[]) {
  const rows: Row[] = [];
  let i = start;
  for (;;) {
    while (/\s/.test(s[i])) i++;
    if (s[i] !== "(") throw new Error(`Expected "(" at offset ${i}`);
    i++;
    const vals: (string | number | null)[] = [];
    for (;;) {
      while (s[i] === " ") i++;
      if (s[i] === "'") {
        i++;
        let out = "";
        for (;;) {
          const c = s[i++];
          if (c === "\\") { const n = s[i++]; out += ESC[n] ?? n; }
          else if (c === "'") { if (s[i] === "'") { out += "'"; i++; } else break; }
          else out += c;
        }
        vals.push(out);
      } else {
        let j = i;
        while (s[j] !== "," && s[j] !== ")") j++;
        const tok = s.slice(i, j).trim();
        vals.push(tok === "NULL" ? null : Number.isNaN(Number(tok)) ? tok : Number(tok));
        i = j;
      }
      if (s[i] === ",") { i++; continue; }
      if (s[i] === ")") { i++; break; }
      throw new Error(`Unexpected "${s[i]}" at offset ${i}`);
    }
    if (vals.length !== cols.length) throw new Error(`Column count mismatch (${vals.length} vs ${cols.length}) near offset ${i}`);
    rows.push(Object.fromEntries(cols.map((c, k) => [c, vals[k]])));
    while (/\s/.test(s[i])) i++;
    if (s[i] === ",") { i++; continue; }
    if (s[i] === ";") return { rows, end: i + 1 };
    throw new Error(`Unexpected "${s[i]}" after tuple at offset ${i}`);
  }
}
