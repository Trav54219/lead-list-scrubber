import { buildSuppression, guessColumns, parseCsv, scrub, toCsv } from "./scrub.js";

const $ = (id) => document.getElementById(id);
const PREVIEW = 200;
let main = null;
let mainName = "leads.csv";
const files = []; // { name, text }
let result = null;

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}

function dropzone(zone, input, onFiles) {
  input.addEventListener("change", () => onFiles([...input.files]));
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    onFiles([...e.dataTransfer.files]);
  });
}

function fillSelect(sel, header, index) {
  sel.replaceChildren(el("option", { value: "-1" }, "(none)"), ...header.map((h, i) => el("option", { value: String(i) }, h || `Column ${i + 1}`)));
  sel.value = String(index);
}

dropzone($("drop-main"), $("file-main"), async ([f]) => {
  if (!f) return;
  main = parseCsv(await f.text());
  mainName = f.name.replace(/\.(csv|txt)$/i, "");
  const g = guessColumns(main[0] || []);
  fillSelect($("col-email"), main[0], g.email);
  fillSelect($("col-domain"), main[0], g.domain);
  fillSelect($("col-company"), main[0], g.company);
  $("main-name").textContent = `${f.name}: ${(main.length - 1).toLocaleString()} rows.`;
  $("main-info").hidden = false;
  run();
});

dropzone($("drop-supp"), $("file-supp"), async (list) => {
  for (const f of list) files.push({ name: f.name, text: await f.text() });
  run();
});

function suppressions() {
  const out = files.map((f) => buildSuppression(f.name, f.text));
  if ($("paste-supp").value.trim()) out.push(buildSuppression("pasted list", $("paste-supp").value));
  return out;
}

function renderSuppList(sups) {
  $("supp-list").replaceChildren(...sups.map((s, i) => {
    const n = (k, one, many) => k && `${k.toLocaleString()} ${k === 1 ? one : many}`;
    const parts = [
      n(s.emails.size, "email", "emails"),
      n(s.domains.size, "domain", "domains"),
      n(s.companies.size, "company", "companies"),
    ].filter(Boolean);
    const isFile = i < files.length;
    return el("li", {},
      el("b", {}, s.name), ` ${parts.join(", ") || "nothing usable found"}`,
      isFile ? el("button", { type: "button", class: "x", "aria-label": `remove ${s.name}`, onclick: () => { files.splice(i, 1); run(); } }, "×") : null);
  }));
}

function run() {
  const sups = suppressions();
  renderSuppList(sups);
  if (!main || main.length < 2) return;
  const cols = { email: +$("col-email").value, domain: +$("col-domain").value, company: +$("col-company").value };
  result = scrub(main, cols, sups, {
    dedupe: $("opt-dedupe").checked,
    invalid: $("opt-invalid").checked,
    role: $("opt-role").checked,
    freeMail: $("opt-free").checked,
    domainMatchesSubdomains: $("opt-sub").checked,
    perCompany: Math.max(0, parseInt($("opt-cap").value, 10) || 0),
  });
  const s = result.stats;
  $("big-counts").replaceChildren(
    el("div", {}, el("b", {}, s.input.toLocaleString()), el("span", {}, "in")),
    el("div", { class: "pass" }, el("b", {}, s.kept.toLocaleString()), el("span", {}, "to send")),
    el("div", { class: "fail" }, el("b", {}, s.removed.toLocaleString()), el("span", {}, "removed")));
  $("reasons").replaceChildren(...(s.reasons.length ? s.reasons : [["Nothing to remove", 0]]).map(([k, v]) =>
    el("tr", {}, el("td", {}, k), el("td", { class: "n" }, v ? v.toLocaleString() : ""))));
  const head = result.removed[0];
  $("rm-head").replaceChildren(el("tr", {}, el("th", {}, "removed_reason"), head.slice(0, -1).map((h) => el("th", {}, h))));
  const body = result.removed.slice(1);
  $("rm-body").replaceChildren(...body.slice(0, PREVIEW).map((r) =>
    el("tr", {}, el("td", { class: "reason" }, r[r.length - 1]), r.slice(0, -1).map((c) => el("td", {}, c)))));
  $("rm-more").textContent = body.length > PREVIEW ? `Showing ${PREVIEW} of ${body.length.toLocaleString()}. The download has all of them.` : body.length ? "" : "No rows removed.";
  $("results").hidden = false;
}

function download(rows, name) {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv" });
  el("a", { href: URL.createObjectURL(blob), download: name }).click();
}
$("dl-kept").addEventListener("click", () => result && download(result.kept, `${mainName}-clean.csv`));
$("dl-removed").addEventListener("click", () => result && download(result.removed, `${mainName}-removed.csv`));

let t;
$("paste-supp").addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 250); });
["col-email", "col-domain", "col-company", "opt-dedupe", "opt-invalid", "opt-role", "opt-free", "opt-sub", "opt-cap"].forEach((id) =>
  $(id).addEventListener("change", run));
$("opt-cap").addEventListener("input", run);
