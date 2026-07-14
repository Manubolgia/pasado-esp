/* Pasado — trainer logic: Leitner-style SRS over verb×tense items and sentences. */

const $ = (id) => document.getElementById(id);
const VMAP = Object.fromEntries(VERBS.map((v) => [v.inf, v]));
const TENSE_NAME = { pret: "pretérito", imp: "imperfecto" };

/* ---------- persistent state ---------- */

const KEY = "pasado.v1";
let S = { theme: null, conj: {}, sent: {} };
try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
const save = () => localStorage.setItem(KEY, JSON.stringify(S));

/* Leitner boxes: minutes until next review per box. Wrong answers drop to box 0. */
const INTERVALS = [1, 10, 1440, 3 * 1440, 7 * 1440, 16 * 1440, 35 * 1440];
const now = () => Date.now();

function grade(rec, result) {
  // result: "ok" | "accent" | "bad"
  if (result === "ok") rec.box = Math.min(rec.box + 1, INTERVALS.length - 1);
  else if (result === "bad") rec.box = 0;
  rec.due = now() + INTERVALS[rec.box] * 60000;
}

function pickItem(store, allKeys) {
  const due = allKeys.filter((k) => store[k] && store[k].due <= now());
  if (due.length) {
    due.sort((a, b) => store[a].due - store[b].due);
    return due[Math.floor(Math.random() * Math.min(3, due.length))];
  }
  const fresh = allKeys.filter((k) => !store[k]);
  if (fresh.length) return fresh[0];
  // nothing due: review the weakest items anyway
  const sorted = [...allKeys].sort((a, b) => store[a].box - store[b].box);
  const pool = sorted.slice(0, Math.max(5, Math.ceil(sorted.length / 4)));
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------- answer checking ---------- */

const deaccent = (s) => s.normalize("NFD").replace(/\u0301/g, "").normalize("NFC");
const clean = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

function regularizedPret(v, p) {
  // what the form would be if the verb were fully regular (for targeted feedback)
  const stem = v.inf.slice(0, -2);
  return stem + (v.inf.endsWith("ar") ? PRET_AR : PRET_ERIR)[p];
}

function checkAnswer(v, tense, p, raw) {
  const input = clean(raw);
  const correct = conjugate(v, tense, p);
  if (input === correct) return { result: "ok" };
  if (input && deaccent(input) === deaccent(correct))
    return { result: "accent", msg: "Casi: falta la tilde.", correct };
  const other = conjugate(v, tense === "pret" ? "imp" : "pret", p);
  if (input === other)
    return { result: "bad", msg: `Esa es la forma del ${TENSE_NAME[tense === "pret" ? "imp" : "pret"]}.`, correct };
  if (tense === "pret" && input === regularizedPret(v, p) && input !== correct)
    return { result: "bad", msg: `«${v.inf}» es irregular en el pretérito.`, correct };
  return { result: "bad", correct };
}

function renderFeedback(el, check, extraHtml = "") {
  const ok = check.result === "ok";
  const accent = check.result === "accent";
  el.innerHTML =
    `<span class="verdict ${ok ? "ok" : "bad"}">${ok ? "Correcto" : accent ? "Casi" : "No"}</span>` +
    (ok ? "" : `<p class="correct-form">${check.correct}</p>`) +
    (check.msg ? `<p class="why">${check.msg}</p>` : "") +
    extraHtml;
  el.hidden = false;
}

/* ---------- conjugation drill ---------- */

const DRILL_VERBS = VERBS.filter((v) => v.drill !== false);
const CONJ_KEYS = [];
DRILL_VERBS.forEach((v) => { CONJ_KEYS.push(v.inf + "|pret", v.inf + "|imp"); });
const PERSON_WEIGHTS = [3, 2, 3, 2, 1, 3];

function weightedPerson() {
  const total = PERSON_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < 6; i++) { r -= PERSON_WEIGHTS[i]; if (r < 0) return i; }
  return 0;
}

let conjCur = null;

function conjMeta() {
  const due = CONJ_KEYS.filter((k) => S.conj[k] && S.conj[k].due <= now()).length;
  const seen = CONJ_KEYS.filter((k) => S.conj[k]).length;
  $("conjMeta").textContent = `${seen}/${CONJ_KEYS.length} formas vistas · ${due} para repasar`;
}

function conjNext() {
  const key = pickItem(S.conj, CONJ_KEYS);
  const [inf, tense] = key.split("|");
  conjCur = { key, v: VMAP[inf], tense, p: weightedPerson() };
  $("conjTense").textContent = TENSE_NAME[tense];
  $("conjPerson").textContent = PERSONS[conjCur.p] + " ·";
  $("conjVerb").textContent = inf;
  $("conjGloss").textContent = conjCur.v.en;
  $("conjInput").value = "";
  $("conjInput").disabled = false;
  $("conjFeedback").hidden = true;
  $("conjNext").hidden = true;
  conjMeta();
  $("conjInput").focus();
}

function conjCheck() {
  if (!conjCur || !$("conjNext").hidden) return;
  const raw = $("conjInput").value;
  if (!clean(raw)) return;
  const check = checkAnswer(conjCur.v, conjCur.tense, conjCur.p, raw);
  const rec = S.conj[conjCur.key] || (S.conj[conjCur.key] = { box: 0, due: 0 });
  grade(rec, check.result);
  save();
  renderFeedback($("conjFeedback"), check);
  $("conjInput").disabled = true;
  $("conjNext").hidden = false;
  $("conjNext").focus();
}

/* ---------- sentence mode (pretérito o imperfecto) ---------- */

const SENT_KEYS = SENTENCES.map((_, i) => String(i));
let sentCur = null;

function sentMeta() {
  const due = SENT_KEYS.filter((k) => S.sent[k] && S.sent[k].due <= now()).length;
  const seen = SENT_KEYS.filter((k) => S.sent[k]).length;
  $("sentMeta").textContent = `${seen}/${SENT_KEYS.length} frases vistas · ${due} para repasar`;
}

function sentNext() {
  const key = pickItem(S.sent, SENT_KEYS);
  const s = SENTENCES[Number(key)];
  sentCur = { key, s, v: VMAP[s.v], choseWrong: false };
  const hint = s.hint ? `, ${s.hint}` : "";
  $("sentText").innerHTML =
    `${s.b ? s.b + " " : ""}<span class="blank" id="sentBlank">&nbsp;</span> ${s.a}`;
  $("sentHint").textContent = `(${s.v}${hint})`;
  $("sentChoice").hidden = false;
  for (const b of $("sentChoice").children) b.disabled = false;
  $("sentAnswer").hidden = true;
  $("sentFeedback").hidden = true;
  $("sentNext").hidden = true;
  $("sentInput").value = "";
  $("sentInput").disabled = false;
  sentMeta();
}

function sentChoose(t) {
  if (!sentCur || !$("sentAnswer").hidden) return;
  const s = sentCur.s;
  const cue = CUES[s.c];
  const right = t === s.t;
  sentCur.choseWrong = !right;
  const fb = $("sentFeedback");
  fb.innerHTML =
    `<span class="verdict ${right ? "ok" : "bad"}">${right ? "Sí" : "No"} — es ${TENSE_NAME[s.t]}</span>` +
    `<br><span class="cue-label">${cue.label}</span>` +
    `<p class="why">${cue.why}</p>`;
  fb.hidden = false;
  $("sentChoice").hidden = true;
  $("sentAnswer").hidden = false;
  $("sentInput").focus();
}

function sentCheck() {
  if (!sentCur || !$("sentNext").hidden) return;
  const raw = $("sentInput").value;
  if (!clean(raw)) return;
  const s = sentCur.s;
  const check = checkAnswer(sentCur.v, s.t, s.p, raw);
  const rec = S.sent[sentCur.key] || (S.sent[sentCur.key] = { box: 0, due: 0 });
  grade(rec, sentCur.choseWrong ? "bad" : check.result);
  save();
  const cue = CUES[s.c];
  renderFeedback(
    $("sentFeedback"),
    check,
    `<br><span class="cue-label">${cue.label}</span><p class="why">${cue.why}</p>`
  );
  const blank = $("sentBlank");
  blank.textContent = check.correct || conjugate(sentCur.v, s.t, s.p);
  blank.classList.add("filled");
  $("sentInput").disabled = true;
  $("sentAnswer").hidden = true;
  $("sentNext").hidden = false;
  $("sentNext").focus();
}

/* ---------- reference tab ---------- */

function buildReference() {
  const row = (cells, tag = "td") => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  const table = (head, rows) =>
    `<table>${row(head, "th")}${rows.map((r) => row(r)).join("")}</table>`;

  const endings = table(
    ["", "-ar pret.", "-er/-ir pret.", "-ar imp.", "-er/-ir imp."],
    PERSONS.map((p, i) => [p, PRET_AR[i], PRET_ERIR[i], IMP_AR[i], IMP_ERIR[i]])
  );

  const strongs = VERBS.filter((v) => v.strong)
    .map((v) => `<li><b>${v.inf}</b> → ${v.strong}- (${conjugate(v, "pret", 0)}, ${conjugate(v, "pret", 2)})</li>`)
    .join("");
  const fulls = ["ser", "ir", "dar", "ver"]
    .map((inf) => {
      const v = VMAP[inf];
      return `<li><b>${inf}</b>: ${[0, 1, 2, 3, 4, 5].map((p) => conjugate(v, "pret", p)).join(", ")}</li>`;
    })
    .join("");
  const stem3 = VERBS.filter((v) => v.stem3)
    .map((v) => `<b>${v.inf}</b> (${conjugate(v, "pret", 2)})`)
    .join(", ");
  const yod = VERBS.filter((v) => v.y || v.uir)
    .map((v) => `<b>${v.inf}</b> (${conjugate(v, "pret", 2)})`)
    .join(", ");

  const cues = Object.values(CUES)
    .map((c) => `<li><b>${c.label}</b> → ${TENSE_NAME[c.t]}<br><span class="why">${c.why}</span></li>`)
    .join("");

  $("refContent").innerHTML = `
    <h2>Terminaciones</h2>${endings}
    <h2>Pretéritos fuertes</h2>
    <p class="why">Raíz irregular + -e, -iste, -o, -imos, -isteis, -ieron (sin tilde; los en -j hacen -eron).</p>
    <ul>${strongs}</ul>
    <h2>Totalmente irregulares</h2><ul>${fulls}</ul>
    <h2>Cambio vocálico (solo 3ª persona)</h2><p>${stem3}</p>
    <h2>i → y (solo 3ª persona)</h2><p>${yod}</p>
    <h2>Imperfecto irregular</h2>
    <p>Solo tres: <b>ser</b> (era…), <b>ir</b> (iba…), <b>ver</b> (veía…).</p>
    <h2>¿Pretérito o imperfecto?</h2><ul>${cues}</ul>
    <h2>Verbos que cambian de significado</h2>
    <ul>
      <li><b>saber</b>: sabía = knew · supe = found out</li>
      <li><b>conocer</b>: conocía = knew · conocí = met</li>
      <li><b>querer</b>: quería = wanted · quise = tried · no quise = refused</li>
      <li><b>poder</b>: podía = was able · pude = managed to · no pude = failed to</li>
    </ul>`;
}

/* ---------- UI wiring ---------- */

function applyTheme() {
  const dark = S.theme ? S.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = dark ? "#181713" : "#f6f2e9";
}
$("themeBtn").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark";
  S.theme = dark ? "light" : "dark";
  save();
  applyTheme();
});

let activeTab = "conj";
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    activeTab = b.dataset.tab;
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
    for (const t of ["conj", "elegir", "ref"]) $("tab-" + t).hidden = t !== activeTab;
    $("accentBar").hidden = activeTab === "ref";
  })
);

$("conjSubmit").addEventListener("click", conjCheck);
$("conjInput").addEventListener("keydown", (e) => { if (e.key === "Enter") conjCheck(); });
$("conjNext").addEventListener("click", conjNext);

for (const b of $("sentChoice").children)
  b.addEventListener("click", () => sentChoose(b.dataset.t));
$("sentSubmit").addEventListener("click", sentCheck);
$("sentInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sentCheck(); });
$("sentNext").addEventListener("click", sentNext);

let lastInput = null;
for (const inp of [$("conjInput"), $("sentInput")])
  inp.addEventListener("focus", () => { lastInput = inp; });
document.querySelectorAll("#accentBar button").forEach((b) =>
  b.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const inp = lastInput || (activeTab === "conj" ? $("conjInput") : $("sentInput"));
    if (inp.disabled) return;
    const start = inp.selectionStart ?? inp.value.length;
    inp.value = inp.value.slice(0, start) + b.textContent + inp.value.slice(inp.selectionEnd ?? start);
    inp.focus();
    inp.setSelectionRange(start + 1, start + 1);
  })
);

applyTheme();
buildReference();
conjNext();
sentNext();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
