// Browser checks of the RepoCity company page, rerunnable: `node tests/pruefen.cjs`.
// Serves site/ with its _headers, then for four viewports and both languages checks every
// anchor, the tab bars, the presentations (sped up through the Chrome DevTools Protocol, the
// durations in the stylesheet stay as they are), back and forward, reduced motion, console
// errors, horizontal scroll and whether a fixed bar covers anything; then the audit request form
// at /anfrage/ with the real /api/* handler (`--nur-anfrage` checks only the form). Screenshots
// land in tests/bilder/. Exit code 1 when any check fails.
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { start } = require("./server.cjs");

const ROOT = path.resolve(__dirname, "..", "site");
const BILDER = path.join(__dirname, "bilder");
const TEILE = ["crm", "cockpit", "radarauditor", "marketing", "telefon", "mail", "webseiten"];
const REITER = ["projekt", "ablauf", "skills", "praesentation"];
const GROESSEN = [
  { name: "1440x900", width: 1440, height: 900, breit: true },
  { name: "1280x720", width: 1280, height: 720, breit: true },
  { name: "390x844", width: 390, height: 844, breit: false },
  { name: "360x740", width: 360, height: 740, breit: false },
];
const SPRACHEN = [
  { code: "de", pfad: "/" },
  { code: "en", pfad: "/en/" },
];
const TEMPO = 40;

let bestanden = 0;
const fehler = [];

function pruefe(bedingung, beschreibung) {
  if (bedingung) bestanden += 1;
  else fehler.push(beschreibung);
}

function erwartet(anker) {
  const name = anker.replace(/^#/, "");
  if (name === "" || name === "uebersicht") return { ansicht: "uebersicht", reiter: "uebersicht" };
  if (name === "praesentation") return { ansicht: "uebersicht", reiter: "praesentation" };
  if (TEILE.includes(name)) return { ansicht: name, reiter: "praesentation" };
  const [teil, reiter] = name.split("-");
  return { ansicht: teil, reiter };
}

function alleAnker() {
  const liste = ["", "#uebersicht", "#praesentation"];
  for (const t of TEILE) {
    liste.push("#" + t);
    for (const r of REITER) liste.push(`#${t}-${r}`);
  }
  return liste;
}

// Reads the state the page shows: data attributes, the visible panel and the selected tab.
async function zustand(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const sichtbar = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const tafeln = [...document.querySelectorAll("[data-tafel]")].filter(sichtbar).map((t) => t.id);
    const dock = [...document.querySelectorAll(".dock")].find(sichtbar);
    const gewaehlt = dock ? [...dock.querySelectorAll('[role="tab"][aria-selected="true"]')].map((t) => t.dataset.reiter) : [];
    return { ansicht: html.dataset.ansicht, reiter: html.dataset.reiter, tafeln, gewaehlt, hash: location.hash };
  });
}

async function keinQuerscrollen(page, wo) {
  const breite = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  pruefe(breite.s <= breite.c, `${wo}: horizontal scroll (${breite.s} > ${breite.c})`);
}

// At the bottom of the page nothing visible may sit under the fixed tab bar.
async function nichtsVerdeckt(page, wo) {
  const verdeckt = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const dock = [...document.querySelectorAll(".dock")].find((d) => d.getClientRects().length > 0);
    if (!dock) return ["no visible tab bar"];
    const leiste = dock.querySelector(".dock__leiste").getBoundingClientRect();
    const kandidaten = document.querySelectorAll("main a, main button, main p, main li, main h1, main h2, main h3, footer a, footer span, footer p");
    const treffer = [];
    for (const el of kandidaten) {
      if (el.closest(".dock")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
      if (r.bottom > leiste.top + 1 && r.top < leiste.bottom && r.right > leiste.left && r.left < leiste.right) {
        treffer.push((el.textContent || el.tagName).trim().slice(0, 40));
      }
    }
    window.scrollTo(0, 0);
    return treffer;
  });
  pruefe(verdeckt.length === 0, `${wo}: covered by the tab bar: ${verdeckt.join(" | ")}`);
}

async function ueberblickPasst(page, wo, breit) {
  const befund = await page.evaluate((istBreit) => {
    const dock = [...document.querySelectorAll(".dock")].find((d) => d.getClientRects().length > 0);
    const dockOben = dock.querySelector(".dock__leiste").getBoundingClientRect().top;
    const boxen = [...document.querySelectorAll(".knoten")].map((k) => ({ id: k.dataset.teil, r: k.getBoundingClientRect() }));
    const mitte = document.querySelector(".mitte").getBoundingClientRect();
    const probleme = [];
    const schneidet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (let i = 0; i < boxen.length; i++) {
      const a = boxen[i];
      if (a.r.left < 0 || a.r.right > innerWidth) probleme.push(a.id + " outside the width");
      if (schneidet(a.r, mitte)) probleme.push(a.id + " overlaps the mark");
      if (istBreit && a.r.bottom > dockOben) probleme.push(a.id + " below the tab bar");
      for (let j = i + 1; j < boxen.length; j++) if (schneidet(a.r, boxen[j].r)) probleme.push(a.id + " overlaps " + boxen[j].id);
    }
    return probleme;
  }, breit);
  pruefe(befund.length === 0, `${wo}: overview layout: ${befund.join(", ")}`);
}

async function filmPasst(page, wo) {
  const befund = await page.evaluate(() => {
    const film = [...document.querySelectorAll("[data-film]")].find((f) => f.getClientRects().length > 0);
    if (!film) return "no visible film";
    const dock = [...document.querySelectorAll(".dock")].find((d) => d.getClientRects().length > 0);
    const dockOben = dock.querySelector(".dock__leiste").getBoundingClientRect().top;
    const unten = film.getBoundingClientRect().bottom;
    return unten <= dockOben + 1 ? "" : `film bottom ${Math.round(unten)} > tab bar ${Math.round(dockOben)}`;
  });
  pruefe(befund === "", `${wo}: ${befund}`);
}

async function neueSeite(browser, groesse, extra) {
  const context = await browser.newContext({ viewport: { width: groesse.width, height: groesse.height }, ...extra });
  const page = await context.newPage();
  const meldungen = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") meldungen.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => meldungen.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => meldungen.push("requestfailed: " + r.url()));
  page.on("response", (r) => { if (r.status() >= 400) meldungen.push(`HTTP ${r.status()}: ${r.url()}`); });
  return { context, page, meldungen };
}

async function schnell(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: TEMPO });
  return cdp;
}

async function ankerPruefen(browser, basis, groesse, sprache) {
  const { context, page, meldungen } = await neueSeite(browser, groesse, {});
  let n = 0;
  for (const anker of alleAnker()) {
    n += 1;
    const wo = `${sprache.code} ${groesse.name} ${anker || "(none)"}`;
    await page.goto(`${basis}${sprache.pfad}?n=${n}${anker}`, { waitUntil: "load" });
    await page.waitForTimeout(60);
    const soll = erwartet(anker);
    const ist = await zustand(page);
    pruefe(ist.ansicht === soll.ansicht && ist.reiter === soll.reiter, `${wo}: state ${ist.ansicht}/${ist.reiter}, expected ${soll.ansicht}/${soll.reiter}`);
    const tafel = soll.ansicht === "uebersicht" ? (soll.reiter === "uebersicht" ? "tafel-uebersicht" : "tafel-firma-praesentation") : `tafel-${soll.ansicht}-${soll.reiter}`;
    pruefe(ist.tafeln.length === 1 && ist.tafeln[0] === tafel, `${wo}: visible panels ${ist.tafeln.join(",")}, expected ${tafel}`);
    pruefe(ist.gewaehlt.length === 1 && ist.gewaehlt[0] === soll.reiter, `${wo}: selected tab ${ist.gewaehlt.join(",")}`);
    const sprung = await page.evaluate((code) => document.querySelector(`a[data-sprache="${code === "de" ? "en" : "de"}"]`).getAttribute("href"), sprache.code);
    const zielPfad = sprache.code === "de" ? "/en/" : "/";
    pruefe(sprung === zielPfad + (anker || ""), `${wo}: language switch points to ${sprung}`);
    await keinQuerscrollen(page, wo);
    if (soll.reiter === "uebersicht") await ueberblickPasst(page, wo, groesse.breit);
    if (soll.reiter === "praesentation") await filmPasst(page, wo);
    await nichtsVerdeckt(page, wo);
  }
  pruefe(meldungen.length === 0, `${sprache.code} ${groesse.name}: console or network: ${meldungen.slice(0, 5).join(" | ")}`);
  await context.close();
}

async function warteAufHash(page, hash, ms) {
  try {
    await page.waitForFunction((h) => location.hash === h, hash, { timeout: ms });
    return true;
  } catch {
    return false;
  }
}

async function filmePruefen(browser, basis, groesse, sprache) {
  const { context, page, meldungen } = await neueSeite(browser, groesse, {});
  const filme = [["#praesentation", "#uebersicht", "firma"], ...TEILE.map((t) => [`#${t}`, `#${t}-projekt`, t])];
  for (const [start, ende, id] of filme) {
    const wo = `${sprache.code} ${groesse.name} film ${id}`;
    await page.goto(`${basis}${sprache.pfad}?f=${id}${start}`, { waitUntil: "load" });
    const laeuft = await page.evaluate((f) => {
      const film = document.querySelector(`[data-film="${f}"]`);
      return !film.classList.contains("ist-pausiert") && film.querySelector(".szene.ist-aktiv") === film.querySelector(".szene");
    }, id);
    pruefe(laeuft, `${wo}: does not autostart on the first scene`);
    const cdp = await schnell(page);
    pruefe(await warteAufHash(page, ende, 20000), `${wo}: did not switch to ${ende} at the end`);
    const nach = await zustand(page);
    const soll = erwartet(ende);
    pruefe(nach.ansicht === soll.ansicht && nach.reiter === soll.reiter, `${wo}: after the end ${nach.ansicht}/${nach.reiter}`);
    await page.goBack();
    pruefe(await warteAufHash(page, start, 3000), `${wo}: back does not return to ${start}`);
    const zurueck = await zustand(page);
    pruefe(zurueck.reiter === "praesentation", `${wo}: back shows ${zurueck.reiter}`);
    await cdp.detach();
  }
  pruefe(meldungen.length === 0, `${sprache.code} ${groesse.name} films: console or network: ${meldungen.slice(0, 5).join(" | ")}`);
  await context.close();
}

async function pauseUndZurueck(browser, basis, groesse, sprache) {
  const { context, page, meldungen } = await neueSeite(browser, groesse, {});
  const wo = `${sprache.code} ${groesse.name}`;
  await page.goto(`${basis}${sprache.pfad}#crm`, { waitUntil: "load" });
  await page.click('[data-film="crm"] .film__knopf');
  const cdp = await schnell(page);
  await page.waitForTimeout(2500);
  pruefe((await zustand(page)).hash === "#crm", `${wo}: a paused film switched tabs`);
  await page.click('[data-film="crm"] .film__knopf');
  pruefe(await warteAufHash(page, "#crm-projekt", 20000), `${wo}: a resumed film did not switch at the end`);
  await cdp.detach();

  // Back and forward through overview, part, tab.
  await page.goto(`${basis}${sprache.pfad}?h=1`, { waitUntil: "load" });
  await page.click('.knoten[data-teil="cockpit"]');
  pruefe(await warteAufHash(page, "#cockpit", 3000), `${wo}: node click does not open #cockpit`);
  pruefe((await zustand(page)).reiter === "praesentation", `${wo}: node opens a part outside its presentation`);
  await page.click('.dock[data-dock="teil"] [data-reiter="ablauf"]');
  pruefe(await warteAufHash(page, "#cockpit-ablauf", 3000), `${wo}: tab click does not set #cockpit-ablauf`);
  await page.goBack();
  pruefe(await warteAufHash(page, "#cockpit", 3000), `${wo}: back from a tab`);
  await page.goBack();
  const anfang = await zustand(page);
  pruefe(anfang.ansicht === "uebersicht" && anfang.reiter === "uebersicht", `${wo}: back to the overview shows ${anfang.ansicht}/${anfang.reiter}`);
  await page.goForward();
  pruefe(await warteAufHash(page, "#cockpit", 3000), `${wo}: forward`);
  await page.goForward();
  pruefe(await warteAufHash(page, "#cockpit-ablauf", 3000), `${wo}: forward to the tab`);
  pruefe((await zustand(page)).tafeln[0] === "tafel-cockpit-ablauf", `${wo}: forward shows the wrong panel`);

  // Keyboard: arrow keys move along the tab bar.
  await page.focus('.dock[data-dock="teil"] [data-reiter="ablauf"]');
  await page.keyboard.press("ArrowRight");
  pruefe(await warteAufHash(page, "#cockpit-skills", 3000), `${wo}: arrow key does not move to the next tab`);
  pruefe(meldungen.length === 0, `${wo} pause/back: console or network: ${meldungen.slice(0, 5).join(" | ")}`);
  await context.close();
}

async function wenigerBewegung(browser, basis, groesse, sprache) {
  const { context, page, meldungen } = await neueSeite(browser, groesse, { reducedMotion: "reduce" });
  const wo = `${sprache.code} ${groesse.name} reduced motion`;
  for (const [start, id] of [["#praesentation", "firma"], ["#telefon", "telefon"]]) {
    await page.goto(`${basis}${sprache.pfad}?r=${id}${start}`, { waitUntil: "load" });
    const cdp = await schnell(page);
    await page.waitForTimeout(2500);
    const st = await zustand(page);
    pruefe(st.hash === start && st.reiter === "praesentation", `${wo} ${id}: switched by itself to ${st.hash}`);
    const pausiert = await page.evaluate((f) => document.querySelector(`[data-film="${f}"]`).classList.contains("ist-pausiert"), id);
    pruefe(pausiert, `${wo} ${id}: plays by itself`);
    const zweite = page.locator(`[data-film="${id}"] .film__kapitel li:nth-child(2) button`);
    await zweite.click();
    const aktiv = await page.evaluate((f) => {
      const film = document.querySelector(`[data-film="${f}"]`);
      return [...film.querySelectorAll(".szene")].findIndex((s) => s.classList.contains("ist-aktiv"));
    }, id);
    pruefe(aktiv === 1, `${wo} ${id}: chapter button does not change the scene`);
    await cdp.detach();
  }
  await page.goto(`${basis}${sprache.pfad}?r=u`, { waitUntil: "load" });
  const signal = await page.evaluate(async () => {
    const s = document.querySelector(".umlauf__signal");
    if (!s) return "none";
    const a = getComputedStyle(s).left + getComputedStyle(s).top;
    await new Promise((r) => setTimeout(r, 800));
    return a === getComputedStyle(s).left + getComputedStyle(s).top ? "still" : "moving";
  });
  pruefe(signal !== "moving", `${wo}: the overview signal moves`);
  pruefe(meldungen.length === 0, `${wo}: console or network: ${meldungen.slice(0, 5).join(" | ")}`);
  await context.close();
}

async function bilder(browser, basis) {
  fs.mkdirSync(BILDER, { recursive: true });
  const faelle = [
    ["", "uebersicht"],
    ["#praesentation", "firma-praesentation"],
    ["#crm-projekt", "crm-projekt"],
    ["#crm-ablauf", "crm-ablauf"],
    ["#crm-skills", "crm-skills"],
    ["#crm", "crm-praesentation"],
    ["#telefon-ablauf", "telefon-ablauf"],
    ["#mail-praesentation", "mail-praesentation"],
  ];
  const pfade = [];
  for (const groesse of [GROESSEN[0], GROESSEN[3]]) {
    for (const sprache of SPRACHEN) {
      const context = await browser.newContext({ viewport: { width: groesse.width, height: groesse.height } });
      const page = await context.newPage();
      for (const [anker, name] of faelle) {
        if (sprache.code === "en" && !["uebersicht", "crm-ablauf"].includes(name)) continue;
        await page.goto(`${basis}${sprache.pfad}?b=${name}${anker}`, { waitUntil: "load" });
        await page.waitForTimeout(anker === "" ? 3200 : 2600);
        const datei = path.join(BILDER, `${sprache.code}-${groesse.name}-${name}.png`);
        await page.screenshot({ path: datei });
        pfade.push(datei);
      }
      if (sprache.code === "de") {
        await page.goto(`${basis}${sprache.pfad}?b=voll#crm-ablauf`, { waitUntil: "load" });
        await page.waitForTimeout(400);
        const datei = path.join(BILDER, `de-${groesse.name}-crm-ablauf-ganz.png`);
        await page.screenshot({ path: datei, fullPage: true });
        pfade.push(datei);
      }
      await context.close();
    }
  }
  return pfade;
}

// The audit request form at /anfrage/, served together with the real handler of /api/*; only the
// database is a stand-in inside this process, so nothing reaches Supabase.
const DATENBANK = "https://datenbank.test";
const RADARAUDITOR = "https://radarauditor.speedofthespirit.dev/";
const VERGEBEN = "Vergeben GmbH";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STRENG = /script-src 'self';.*connect-src 'self';/;

function datenbankAttrappe() {
  const aufrufe = [];
  const morgen = new Date();
  morgen.setUTCDate(morgen.getUTCDate() + 1);
  const tag = morgen.toISOString().slice(0, 10);
  const uebermorgen = new Date(morgen.getTime() + 86400000).toISOString().slice(0, 10);
  const termine = [`${tag}T08:00:00Z`, `${tag}T09:00:00Z`, `${tag}T13:00:00Z`, `${uebermorgen}T08:00:00Z`];
  const antworten = {
    audit_slots: (p) => [200, p.p_kind === "video" ? [] : termine.map((starts_at) => ({ starts_at }))],
    request_audit: (p) => (p.p_company === VERGEBEN ? [400, { code: "P0001", message: "Dieser Termin ist leider schon vergeben." }] : [200, { ok: true }]),
  };
  const echt = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith(DATENBANK)) return echt(url, init);
    const name = String(url).split("/rpc/")[1];
    const params = JSON.parse(init.body);
    aufrufe.push({ name, params, headers: init.headers });
    const [status, body] = antworten[name](params);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return aufrufe;
}

async function anfrageSeite(browser, basis, groesse, suche = "") {
  const offen = await neueSeite(browser, groesse, {});
  await offen.page.route(`${RADARAUDITOR}**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>RadarAuditor</p>" }));
  const antwort = await offen.page.goto(`${basis}/anfrage/${suche}`, { waitUntil: "load" });
  return { ...offen, antwort };
}

async function sichtbar(page, selector) {
  return page.locator(selector).isVisible();
}

async function anfrageLeerAbschicken(page, wo) {
  await page.click(".formular__senden");
  const meldung = await page.textContent("[data-meldung]");
  pruefe(meldung === "Bitte prüfen Sie die markierten Felder.", `${wo}: form message after empty send: ${meldung}`);
  for (const feld of ["company", "contact", "email", "phone", "kind", "starts_at"]) {
    pruefe(await sichtbar(page, `#fehler-${feld}`), `${wo}: no error shown at ${feld}`);
  }
  pruefe(!(await sichtbar(page, "#fehler-website")), `${wo}: the optional website shows an error`);
  const fokus = await page.evaluate(() => document.activeElement?.id);
  pruefe(fokus === "feld-company", `${wo}: focus after empty send on ${fokus}, expected the first field`);
  pruefe((await page.getAttribute("#feld-company", "aria-invalid")) === "true", `${wo}: first field not marked invalid`);
}

async function anfrageArten(page, wo, aufrufe) {
  pruefe(!(await sichtbar(page, "[data-anschrift]")), `${wo}: address shown before Vor Ort`);
  await page.click('label.art:has(input[value="visit"])');
  pruefe(await sichtbar(page, "[data-anschrift]"), `${wo}: Vor Ort does not show the address`);
  pruefe(await page.locator("#feld-address").evaluate((f) => f.required), `${wo}: address not required for Vor Ort`);
  await page.waitForSelector(".termine__tag", { timeout: 5000 });
  const tage = await page.locator(".termine__datum").allTextContents();
  pruefe(tage.length === 2 && tage.every((t) => /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag), \d{2}\.\d{2}\.\d{4}$/.test(t)), `${wo}: day labels ${tage.join(" | ")}`);
  const zeiten = await page.locator(".zeit span").allTextContents();
  pruefe(zeiten.length === 4 && zeiten.every((z) => /^\d{2}:\d{2}–\d{2}:\d{2} Uhr$/.test(z)), `${wo}: slot labels ${zeiten.join(" | ")}`);
  const letzter = aufrufe.filter((a) => a.name === "audit_slots").at(-1);
  pruefe(letzter?.params.p_kind === "visit" && letzter.headers["Content-Profile"] === "crm", `${wo}: audit_slots not asked for visit in schema crm`);
  await page.click('label.art:has(input[value="video"])');
  await page.waitForFunction(() => document.querySelector("[data-termine-stand]").textContent.includes("kein Termin frei"), null, { timeout: 5000 });
  pruefe(!(await sichtbar(page, "[data-anschrift]")), `${wo}: address still shown for Video`);
}

async function anfrageTastatur(page, wo, aufrufe) {
  await page.focus("#feld-company");
  await page.keyboard.type("Dachdeckerei Muster");
  for (const [feld, wert] of [["contact", "Erika Muster"], ["email", "erika@dachdeckerei-muster.de"], ["phone", "0251 123456"], ["website", "dachdeckerei-muster.de"]]) {
    await page.keyboard.press("Tab");
    pruefe(await page.evaluate((id) => document.activeElement?.id === id, `feld-${feld}`), `${wo}: Tab does not reach ${feld}`);
    await page.keyboard.type(wert);
  }
  await page.focus('input[name="kind"][value="video"]');
  await page.keyboard.press("ArrowLeft");
  pruefe(await page.locator('input[name="kind"][value="call"]').isChecked(), `${wo}: arrow key does not choose Telefon`);
  await page.waitForSelector(".zeit input", { timeout: 5000 });
  await page.focus(".zeit input");
  await page.keyboard.press("Space");
  const termin = await page.locator(".zeit input:checked").getAttribute("value");
  pruefe(termin !== null, `${wo}: space does not choose a slot`);
  await page.focus("#feld-phone");
  await Promise.all([page.waitForURL(`${RADARAUDITOR}**`, { timeout: 5000 }).catch(() => null), page.keyboard.press("Enter")]);
  const gesendet = aufrufe.filter((a) => a.name === "request_audit").at(-1)?.params;
  pruefe(gesendet?.p_kind === "call" && gesendet.p_starts_at === termin && gesendet.p_address === null, `${wo}: request_audit got ${JSON.stringify(gesendet)}`);
  pruefe(gesendet?.p_website === "https://dachdeckerei-muster.de/", `${wo}: website sent as ${gesendet?.p_website}`);
  pruefe(gesendet?.p_utm_source === "linkedin" && gesendet.p_utm_campaign === "herbst", `${wo}: markers not sent`);
  pruefe(UUID.test(gesendet?.p_request_key ?? ""), `${wo}: request key ${gesendet?.p_request_key}`);
  pruefe(page.url() === `${RADARAUDITOR}?utm_source=linkedin&utm_campaign=herbst`, `${wo}: after sending at ${page.url()}`);
}

async function anfrageVergeben(page, wo, aufrufe) {
  await page.fill("#feld-company", VERGEBEN);
  await page.fill("#feld-contact", "Max Muster");
  await page.fill("#feld-email", "max@muster.de");
  await page.fill("#feld-phone", "0251 654321");
  await page.click('label.art:has(input[value="visit"])');
  await page.fill("#feld-address", "Musterweg 1, 48143 Münster");
  await page.waitForSelector(".zeit", { timeout: 5000 });
  await page.click(".zeit >> nth=1");
  const vorher = aufrufe.filter((a) => a.name === "audit_slots").length;
  await page.click(".formular__senden");
  await page.waitForFunction(() => !document.querySelector("[data-meldung]").hidden, null, { timeout: 5000 });
  pruefe((await page.textContent("[data-meldung]")) === "Dieser Termin ist leider schon vergeben.", `${wo}: database sentence not shown`);
  await page.waitForTimeout(200);
  pruefe(aufrufe.filter((a) => a.name === "audit_slots").length === vorher + 1, `${wo}: slots not reloaded after a refusal`);
  pruefe(page.url().startsWith(`${basisVon(page)}/anfrage/`), `${wo}: left the page after a refusal`);
  const schluessel = () => aufrufe.filter((a) => a.name === "request_audit").at(-1)?.params.p_request_key;
  const erster = schluessel();
  await page.click(".formular__senden");
  await page.waitForTimeout(300);
  pruefe(UUID.test(erster ?? "") && schluessel() === erster, `${wo}: sending the same input again changed the key`);
  await page.fill("#feld-message", "Bitte vormittags.");
  await page.click(".formular__senden");
  await page.waitForTimeout(300);
  pruefe(UUID.test(schluessel() ?? "") && schluessel() !== erster, `${wo}: a changed input kept the key`);
}

function basisVon(page) {
  return new URL(page.url()).origin;
}

async function anfragePruefen(browser, basis, groesse, aufrufe) {
  const wo = `anfrage ${groesse.name}`;
  const erste = await anfrageSeite(browser, basis, groesse, "?utm_source=linkedin&utm_campaign=herbst");
  const regel = erste.antwort.headers()["content-security-policy"] ?? "";
  pruefe(STRENG.test(regel) && !regel.includes("cloudflareinsights"), `${wo}: policy of /anfrage/ is ${regel}`);
  await keinQuerscrollen(erste.page, wo);
  const ohneName = await erste.page.evaluate(() => [...document.querySelectorAll("form input, form textarea")].filter((f) => f.labels.length === 0).map((f) => f.name));
  pruefe(ohneName.length === 0, `${wo}: fields without label: ${ohneName.join(", ")}`);
  const grenzen = await erste.page.evaluate(async () => {
    const { LIMITS } = await import("/js/anfrage-regeln.js");
    return [...document.querySelectorAll("form input:not([type=radio]), form textarea")].filter((f) => f.maxLength !== LIMITS[f.name]).map((f) => `${f.name} ${f.maxLength}`);
  });
  pruefe(grenzen.length === 0, `${wo}: maxlength differs from the rules: ${grenzen.join(", ")}`);
  const datenschutz = await erste.page.getAttribute(".formular__hinweis a", "href");
  pruefe(datenschutz === "https://speedofthespirit.dev/datenschutz/?utm_source=linkedin&utm_campaign=herbst", `${wo}: privacy link ${datenschutz}`);
  await anfrageLeerAbschicken(erste.page, wo);
  await anfrageArten(erste.page, wo, aufrufe);
  await keinQuerscrollen(erste.page, `${wo} with slots`);
  await anfrageTastatur(erste.page, wo, aufrufe);
  pruefe(erste.meldungen.length === 0, `${wo}: console or network: ${erste.meldungen.slice(0, 5).join(" | ")}`);
  await erste.context.close();
  const zweite = await anfrageSeite(browser, basis, groesse);
  await anfrageVergeben(zweite.page, wo, aufrufe);
  pruefe(zweite.meldungen.filter((m) => !m.includes("/api/anfrage") && !m.includes("status of 422")).length === 0, `${wo} refusal: console or network: ${zweite.meldungen.slice(0, 5).join(" | ")}`);
  await zweite.context.close();
}

async function anfrageBilder(browser, basis) {
  fs.mkdirSync(BILDER, { recursive: true });
  const pfade = [];
  for (const groesse of [GROESSEN[0], GROESSEN[2]]) {
    const { context, page } = await anfrageSeite(browser, basis, groesse);
    await page.waitForTimeout(300);
    let datei = path.join(BILDER, `anfrage-${groesse.name}.png`);
    await page.screenshot({ path: datei, fullPage: true });
    pfade.push(datei);
    await page.fill("#feld-company", "Dachdeckerei Muster");
    await page.fill("#feld-contact", "Erika Muster");
    await page.fill("#feld-email", "erika@");
    await page.click('label.art:has(input[value="visit"])');
    await page.waitForSelector(".zeit", { timeout: 5000 });
    await page.click(".zeit >> nth=1");
    await page.click(".formular__senden");
    await page.waitForTimeout(200);
    datei = path.join(BILDER, `anfrage-${groesse.name}-ausgefuellt.png`);
    await page.screenshot({ path: datei, fullPage: true });
    pfade.push(datei);
    await context.close();
  }
  return pfade;
}

async function seitePruefen(browser, basis) {
  for (const groesse of GROESSEN) {
    for (const sprache of SPRACHEN) {
      await ankerPruefen(browser, basis, groesse, sprache);
      await filmePruefen(browser, basis, groesse, sprache);
      await pauseUndZurueck(browser, basis, groesse, sprache);
      await wenigerBewegung(browser, basis, groesse, sprache);
    }
  }
}

(async () => {
  const aufrufe = datenbankAttrappe();
  const { handleRequest } = await import("../server/anfrage.mjs");
  const env = { SUPABASE_URL: DATENBANK, SUPABASE_ANON_KEY: "oeffentlich" };
  const { server, port } = await start(ROOT, { api: (request) => handleRequest(request, env) });
  const basis = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  const nurAnfrage = process.argv.includes("--nur-anfrage");
  try {
    if (!nurAnfrage) await seitePruefen(browser, basis);
    for (const groesse of GROESSEN) await anfragePruefen(browser, basis, groesse, aufrufe);
    const ohneBilder = process.argv.includes("--ohne-bilder");
    const pfade = ohneBilder ? [] : [...(nurAnfrage ? [] : await bilder(browser, basis)), ...(await anfrageBilder(browser, basis))];
    console.log(`checks passed: ${bestanden}, failed: ${fehler.length}`);
    for (const f of fehler.slice(0, 60)) console.log("FAIL " + f);
    if (fehler.length > 60) console.log(`... and ${fehler.length - 60} more`);
    for (const p of pfade) console.log("screenshot " + path.relative(process.cwd(), p));
    process.exitCode = fehler.length === 0 ? 0 : 1;
  } finally {
    await browser.close();
    server.close();
  }
})();
