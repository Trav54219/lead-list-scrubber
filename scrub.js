// Scrub a lead list before upload: remove anyone on a do-not-contact list, duplicates,
// invalid and role addresses, and too many people per company. Every removed row says why.
// Pure and dependency-free: runs in the browser and in Node.

export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me", "gmx.com", "gmx.net", "mail.com",
  "yandex.com", "zoho.com", "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "cox.net", "bellsouth.net",
  "charter.net", "earthlink.net", "optonline.net", "frontier.com", "windstream.net", "rocketmail.com", "hey.com",
  "yahoo.co.uk", "hotmail.co.uk", "btinternet.com", "web.de", "orange.fr", "free.fr", "libero.it", "qq.com", "163.com",
]);

export const ROLE_PREFIXES = new Set([
  "info", "sales", "support", "admin", "administrator", "contact", "contactus", "hello", "hi", "office", "team", "hr",
  "careers", "jobs", "recruiting", "billing", "accounts", "accounting", "marketing", "noreply", "no-reply", "donotreply",
  "help", "service", "services", "customerservice", "enquiries", "inquiries", "enquiry", "inquiry", "webmaster",
  "postmaster", "reception", "frontdesk", "orders", "press", "media", "legal", "privacy", "abuse", "general", "mail",
]);

const LEGAL = /[\s,]+(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|llp|lp|pllc|gmbh|pty ltd|pty)\.?$/i;

// ── Normalizers ─────────────────────────────────────────────────────────────
export function normEmail(e) {
  let s = String(e ?? "").trim().toLowerCase().replace(/^mailto:/, "").replace(/^<|>$/g, "");
  const at = s.lastIndexOf("@");
  if (at < 1) return null;
  let local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null;
  local = local.replace(/\+.*$/, ""); // plus-addressing: jane+news@ is jane@
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  return `${local}@${domain === "googlemail.com" ? "gmail.com" : domain}`;
}

export function normDomain(d) {
  let s = String(d ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^[a-z]+:\/\//, "").split(/[/?#:\s]/)[0].replace(/^www\d*\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

export function normCompany(c) {
  let s = String(c ?? "").toLowerCase().replace(/&/g, " and ").replace(/[™®©]/g, "");
  for (let i = 0; i < 3; i++) s = s.replace(LEGAL, "");
  s = s.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
  return s || null;
}

/** acme.com, and its parents for subdomains: mail.acme.co.uk -> [mail.acme.co.uk, acme.co.uk] */
function domainAndParents(d) {
  const parts = d.split(".");
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const cand = parts.slice(i).join(".");
    if (cand.split(".").length < 2) break;
    if (/^(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/.test(cand)) break; // don't match a whole co.uk
    out.push(cand);
  }
  return out;
}

// ── CSV ─────────────────────────────────────────────────────────────────────
export function parseCsv(text) {
  const t = String(text).replace(/^﻿/, "");
  const delim = (t.split(/\r?\n/)[0].match(/;/g) || []).length > (t.split(/\r?\n/)[0].match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}

export function guessColumns(header) {
  const find = (...res) => header.findIndex((h) => res.some((re) => re.test(String(h).trim())));
  return {
    email: find(/^e-?mail$/i, /^e-?mail[\s_]*address$/i, /^work[\s_]*email$/i, /email/i),
    domain: find(/^(website|domain|company[\s_]*(domain|website|url)|url|web)$/i, /domain/i, /website/i),
    company: find(/^company(\s*name)?$/i, /^(organization|organisation|account)(\s*name)?$/i, /company/i),
  };
}

// ── Suppression lists ───────────────────────────────────────────────────────
/**
 * Build a suppression list from a CSV (with a header) or pasted lines (one value each).
 * Each value is sorted into emails, domains or companies by its shape.
 */
export function buildSuppression(name, text) {
  const list = { name, emails: new Set(), domains: new Set(), companies: new Set() };
  const rows = parseCsv(text);
  if (!rows.length) return list;
  const cols = guessColumns(rows[0]);
  const hasHeader = cols.email >= 0 || cols.domain >= 0 || cols.company >= 0;
  const addValue = (v) => {
    const raw = String(v ?? "").trim();
    if (!raw) return;
    if (raw.includes("@")) {
      const e = normEmail(raw);
      if (e) list.emails.add(e);
      return;
    }
    const d = !/\s/.test(raw) && normDomain(raw);
    if (d && /\.[a-z]{2,}$/.test(d)) list.domains.add(d);
    else {
      const c = normCompany(raw);
      if (c) list.companies.add(c);
    }
  };
  if (hasHeader) {
    for (const r of rows.slice(1)) {
      if (cols.email >= 0) addValue(r[cols.email]);
      if (cols.domain >= 0) { const d = normDomain(r[cols.domain]); if (d) list.domains.add(d); }
      if (cols.company >= 0) { const c = normCompany(r[cols.company]); if (c) list.companies.add(c); }
    }
  } else {
    for (const r of rows) for (const v of r) addValue(v);
  }
  return list;
}

// ── Scrub ───────────────────────────────────────────────────────────────────
export const DEFAULTS = {
  dedupe: true,          // same email (after normalizing) twice: keep the first
  invalid: true,         // no usable email
  role: true,            // info@, sales@ ...
  freeMail: false,       // gmail.com, yahoo.com ... (off: some lists sell to owners who use Gmail)
  perCompany: 0,         // 0 = no cap; otherwise keep the first N people per company domain
  domainMatchesSubdomains: true,
};

export function scrub(rows, cols, suppressions = [], opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const [header, ...body] = rows;
  const kept = [header];
  const removed = [[...header, "removed_reason"]];
  const reasons = new Map();
  const bySource = new Map(suppressions.map((s) => [s.name, 0]));
  const seenEmail = new Map();
  const perCo = new Map();
  const note = (key) => reasons.set(key, (reasons.get(key) || 0) + 1);

  body.forEach((r, idx) => {
    const rowNum = idx + 2; // spreadsheet row, header is row 1
    const rawEmail = cols.email >= 0 ? r[cols.email] : "";
    const email = cols.email >= 0 ? normEmail(rawEmail) : null;
    const local = email ? email.split("@")[0] : null;
    const emailDomain = email ? email.split("@")[1] : null;
    const siteDomain = cols.domain >= 0 ? normDomain(r[cols.domain]) : null;
    const company = cols.company >= 0 ? normCompany(r[cols.company]) : null;
    const domains = [...new Set([emailDomain, siteDomain].filter(Boolean))];
    let why = null;
    let key = null;

    if (o.invalid && cols.email >= 0 && !email) {
      why = String(rawEmail ?? "").trim() ? `invalid email "${String(rawEmail).trim()}"` : "no email";
      key = "Invalid or missing email";
    }
    if (!why) {
      for (const s of suppressions) {
        if (email && s.emails.has(email)) { why = `on ${s.name} (email)`; break; }
        const hit = domains.flatMap((d) => (o.domainMatchesSubdomains ? domainAndParents(d) : [d])).find((d) => s.domains.has(d));
        if (hit) { why = `on ${s.name} (domain ${hit})`; break; }
        if (company && s.companies.has(company)) { why = `on ${s.name} (company "${company}")`; break; }
      }
      if (why) {
        key = `Suppressed: ${why.match(/^on (.*) \(/)[1]}`;
        bySource.set(why.match(/^on (.*) \(/)[1], (bySource.get(why.match(/^on (.*) \(/)[1]) || 0) + 1);
      }
    }
    if (!why && o.role && local && ROLE_PREFIXES.has(local.replace(/[._-]?\d+$/, ""))) {
      why = `role address ${local}@`;
      key = "Role address (info@, sales@ ...)";
    }
    if (!why && o.freeMail && emailDomain && FREE_MAIL.has(emailDomain)) {
      why = `personal email domain ${emailDomain}`;
      key = "Personal email domain";
    }
    if (!why && o.dedupe && email) {
      if (seenEmail.has(email)) {
        why = `duplicate of row ${seenEmail.get(email)}`;
        key = "Duplicate email";
      } else seenEmail.set(email, rowNum);
    }
    if (!why && o.perCompany > 0) {
      const coKey = (emailDomain && !FREE_MAIL.has(emailDomain) ? emailDomain : null) || siteDomain || company;
      if (coKey) {
        const n = (perCo.get(coKey) || 0) + 1;
        perCo.set(coKey, n);
        if (n > o.perCompany) {
          why = `over ${o.perCompany} per company (${coKey})`;
          key = `Over ${o.perCompany} per company`;
        }
      }
    }

    if (why) {
      removed.push([...r, why]);
      note(key);
    } else kept.push(r);
  });

  return {
    kept,
    removed,
    stats: {
      input: body.length,
      kept: kept.length - 1,
      removed: removed.length - 1,
      reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
      bySource: [...bySource.entries()],
    },
  };
}
