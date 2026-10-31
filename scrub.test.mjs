import { test } from "node:test";
import assert from "node:assert/strict";
import { normEmail, normDomain, normCompany, buildSuppression, parseCsv, scrub, guessColumns, toCsv } from "./scrub.js";

test("normalizers", () => {
  assert.equal(normEmail(" Jane.Doe+News@Acme.COM "), "jane.doe@acme.com");
  assert.equal(normEmail("j.a.n.e@googlemail.com"), "jane@gmail.com");
  assert.equal(normEmail("not an email"), null);
  assert.equal(normEmail("jane@acme"), null);
  assert.equal(normDomain("https://www.Acme.com/about"), "acme.com");
  assert.equal(normDomain("sarah@acme.io"), "acme.io");
  assert.equal(normCompany("Acme Roofing, LLC"), normCompany("ACME ROOFING"));
  assert.equal(normCompany("The Smith & Jones Co."), "smith and jones");
});

test("suppression lists sort pasted values by shape", () => {
  const s = buildSuppression("dnc", "bob@acme.com\nbeta.io\nGamma Industries, Inc.\n");
  assert.ok(s.emails.has("bob@acme.com"));
  assert.ok(s.domains.has("beta.io"));
  assert.ok(s.companies.has("gamma industries"));
});

test("suppression CSV with a header uses its columns", () => {
  const s = buildSuppression("customers.csv", "Company,Website\nDelta Co,https://www.delta.com\n");
  assert.ok(s.domains.has("delta.com"));
  assert.ok(s.companies.has("delta"));
});

const LIST = `First Name,Email,Company,Website
Ann,ann@acme.com,Acme LLC,acme.com
Bob,bob@beta.io,Beta,beta.io
Cy,Ann@ACME.com,Acme,acme.com
Di,info@delta.com,Delta,delta.com
Ed,ed@mail.gamma.co.uk,Gamma Industries Inc,gamma.co.uk
Fay,fay@gmail.com,Fay's Bakery,
Gus,not-an-email,Gus Co,
Hal,hal@acme.com,Acme,acme.com
Ivy,ivy@acme.com,Acme,acme.com
Jo,jo@zeta.com,Zeta,zeta.com`;

test("scrub removes each kind of row, with the reason, and keeps the rest in order", () => {
  const rows = parseCsv(LIST);
  const cols = guessColumns(rows[0]);
  assert.deepEqual(cols, { email: 1, domain: 3, company: 2 });
  const dnc = buildSuppression("dnc.txt", "beta.io\ngamma.co.uk");
  const customers = buildSuppression("customers.csv", "Company\nZeta");
  const r = scrub(rows, cols, [dnc, customers], { perCompany: 2 });
  const why = Object.fromEntries(r.removed.slice(1).map((x) => [x[0], x[x.length - 1]]));
  assert.equal(why.Bob, "on dnc.txt (domain beta.io)");
  assert.equal(why.Ed, "on dnc.txt (domain gamma.co.uk)"); // subdomain mail.gamma.co.uk matches
  assert.equal(why.Jo, 'on customers.csv (company "zeta")');
  assert.equal(why.Cy, "duplicate of row 2");
  assert.equal(why.Di, "role address info@");
  assert.equal(why.Gus, 'invalid email "not-an-email"');
  assert.equal(why.Ivy, "over 2 per company (acme.com)");
  assert.deepEqual(r.kept.slice(1).map((x) => x[0]), ["Ann", "Fay", "Hal"]);
  assert.equal(r.stats.input, 10);
  assert.equal(r.stats.kept + r.stats.removed, 10);
});

test("free mail is kept by default and removable on request", () => {
  const rows = parseCsv(LIST);
  const cols = guessColumns(rows[0]);
  assert.ok(scrub(rows, cols).kept.some((x) => x[0] === "Fay"));
  assert.ok(scrub(rows, cols, [], { freeMail: true }).removed.some((x) => x[0] === "Fay"));
});

test("semicolon CSVs (European Excel) parse, and output round-trips", () => {
  const rows = parseCsv("Email;Company\nann@acme.com;Acme\n");
  assert.deepEqual(rows[1], ["ann@acme.com", "Acme"]);
  const r = scrub(parseCsv(LIST), guessColumns(parseCsv(LIST)[0]));
  assert.deepEqual(parseCsv(toCsv(r.removed)), r.removed);
});
