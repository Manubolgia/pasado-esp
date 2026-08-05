/* Pasado — trainer logic: Leitner-style SRS over sentences with a verb blank. */

const $ = (id) => document.getElementById(id);
const VMAP = Object.fromEntries(VERBS.map((v) => [v.inf, v]));
const TENSE_NAME = {
  pret: "pretérito indefinido",
  imp: "pretérito imperfecto",
  perf: "pretérito perfecto",
  plusc: "pluscuamperfecto",
  subj: "imperfecto de subjuntivo",
};
const TENSE_SHORT = {
  pret: "indefinido",
  imp: "imperfecto",
  perf: "perfecto",
  plusc: "pluscuamp.",
  subj: "subjuntivo",
};

/* ---------- persistent state ---------- */

const KEY = "pasado.v1";
let S = { theme: null, esc: {}, eleg: {}, tsel: null };
try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {}
// migrate from the old modes: sentence progress feeds the writing mode
if (S.sent) { S.esc = S.sent; delete S.sent; }
delete S.conj;
if (!S.tsel) S.tsel = Object.fromEntries(TENSES.map((t) => [t, true]));
const save = () => localStorage.setItem(KEY, JSON.stringify(S));

/* Leitner boxes: minutes until next review per box. Wrong answers drop to box 0. */
const INTERVALS = [1, 10, 1440, 3 * 1440, 7 * 1440, 16 * 1440, 35 * 1440];
const now = () => Date.now();

function grade(rec, result) {
  // result: "ok" | "bad"
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
  if (fresh.length) return fresh[Math.floor(Math.random() * Math.min(5, fresh.length))];
  // nothing due: review the weakest items anyway
  const sorted = [...allKeys].sort((a, b) => store[a].box - store[b].box);
  const pool = sorted.slice(0, Math.max(5, Math.ceil(sorted.length / 4)));
  return pool[Math.floor(Math.random() * pool.length)];
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- answer checking ---------- */

const deaccent = (s) => s.normalize("NFD").replace(/\u0301/g, "").normalize("NFC");
const clean = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
// what the learner typed goes back into the feedback as HTML, so escape it
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// every accepted spelling of a form (imperfect subjunctive has -ra and -se)
function acceptedForms(v, tense, p) {
  if (tense === "subj") return [subjunctive(v, p, false), subjunctive(v, p, true)];
  return [conjugate(v, tense, p)];
}

function regularizedPret(v, p) {
  // what the form would be if the verb were fully regular (for targeted feedback)
  const stem = v.inf.slice(0, -2);
  return stem + (v.inf.endsWith("ar") ? PRET_AR : PRET_ERIR)[p];
}

// one-line explanation of how the correct form is built
function explainForm(v, tense, p) {
  const correct = conjugate(v, tense, p);
  if (tense === "perf" || tense === "plusc") {
    const [aux, part] = correct.split(" ");
    return `${tense === "perf" ? "Presente" : "Imperfecto"} de haber («${aux}») + participio «${part}»${v.part ? " (irregular)" : ""}.`;
  }
  if (tense === "subj") {
    return `3ª pl. del indefinido («${conjugate(v, "pret", 5)}») − ron + -ra/-se: «${correct}» o «${subjunctive(v, p, true)}».`;
  }
  if (tense === "imp") {
    if (v.imp) return `Imperfecto irregular — solo ser (era), ir (iba) y ver (veía).`;
    return `Imperfecto regular: raíz «${v.inf.slice(0, -2)}-» + «-${(v.inf.endsWith("ar") ? IMP_AR : IMP_ERIR)[p]}». Nunca falla: solo ser, ir y ver son irregulares.`;
  }
  if (v.pret) return `«${v.inf}» es totalmente irregular: ${[0, 1, 2, 3, 4, 5].map((q) => conjugate(v, "pret", q)).join(", ")}.`;
  if (v.strong) return `Pretérito fuerte: raíz «${v.strong}-» + -e, -iste, -o, -imos, -isteis, ${v.strong.endsWith("j") ? "-eron" : "-ieron"} — sin tilde en yo/él.`;
  if (v.stem3 && (p === 2 || p === 5)) return `Cambio vocálico solo en 3ª persona: raíz «${v.stem3}-» → «${correct}».`;
  if ((v.y || v.uir) && (p === 2 || p === 5)) return `Entre vocales la i se convierte en y: «${correct}».`;
  let orth = "";
  if (p === 0) {
    if (v.inf.endsWith("car")) orth = " (-car → -qué)";
    else if (v.inf.endsWith("gar")) orth = " (-gar → -gué)";
    else if (v.inf.endsWith("zar")) orth = " (-zar → -cé)";
  }
  return `Indefinido regular: raíz + «-${(v.inf.endsWith("ar") ? PRET_AR : v.y ? PRET_Y : v.uir ? PRET_UIR : PRET_ERIR)[p]}»${orth}.`;
}

// the full verdict for one typed answer; `typed` echoes it back so a wrong answer
// can be shown next to the correct form instead of just vanishing
function checkAnswer(v, tense, p, raw) {
  const check = diagnose(v, tense, p, raw);
  if (check.result === "bad") check.typed = clean(raw);
  return check;
}

// the answer the sentence is asking for, formatted for display
function correctForm(v, tense, p) {
  const forms = acceptedForms(v, tense, p);
  return tense === "subj" ? `${forms[0]} / ${forms[1]}` : forms[0];
}

function diagnose(v, tense, p, raw) {
  const input = clean(raw);
  const forms = acceptedForms(v, tense, p);
  const correct = correctForm(v, tense, p);
  const why = explainForm(v, tense, p);
  // accents are optional: «vivio» is accepted, «vivió» is remarked as la correcta.
  const missingAccent = (f) => input !== f && deaccent(input) === deaccent(f);

  if (forms.includes(input)) {
    const other = forms.find((f) => f !== input);
    return { result: "ok", msg: other ? `También válida: «${other}».` : undefined };
  }
  if (input && forms.some(missingAccent)) {
    const target = forms.find(missingAccent);
    return { result: "ok", accent: true, msg: `Con tilde es «${target}».` };
  }

  // In Galicia the indefinido routinely replaces the perfecto (viví por he vivido).
  // Accept it as correct, but flag the compound as the standard form.
  if (tense === "perf") {
    const pret = conjugate(v, "pret", p);
    if (input === pret || missingAccent(pret))
      return {
        result: "ok",
        msg: `En Galicia se usa el indefinido, pero la forma estándar aquí es el perfecto «${forms[0]}».`,
      };
  }

  // same person, different tense
  for (const t of TENSES)
    if (t !== tense && acceptedForms(v, t, p).includes(input))
      return { result: "bad", msg: `«${esc(input)}» existe, pero no es lo que pide este contexto.`, correct, why };

  // right tense, wrong person
  for (let q = 0; q < 6; q++)
    if (q !== p && acceptedForms(v, tense, q).includes(input))
      return { result: "bad", msg: `Ese es «${PERSONS[q]}», pero pedía «${PERSONS[p]}».`, correct, why };

  // compound tenses: diagnose auxiliary and participle separately
  if (tense === "perf" || tense === "plusc") {
    const [aux, part] = forms[0].split(" ");
    const toks = input.split(" ");
    if (toks.length === 1 && toks[0] === part)
      return { result: "bad", msg: `Falta el auxiliar: «${forms[0]}».`, correct, why };
    if (toks.length === 2) {
      const msgs = [];
      if (deaccent(toks[0]) !== deaccent(aux))
        msgs.push(`El auxiliar de «${PERSONS[p]}» es «${aux}» (haber en ${tense === "perf" ? "presente" : "imperfecto"}).`);
      if (toks[1] !== part)
        msgs.push(v.part
          ? `El participio de «${v.inf}» es irregular: «${part}».`
          : `Participio regular: raíz + ${v.inf.endsWith("ar") ? "-ado" : "-ido"} → «${part}».`);
      if (msgs.length) return { result: "bad", msg: msgs.join(" "), correct, why };
    }
  }

  if (tense === "pret" && input === regularizedPret(v, p))
    return { result: "bad", msg: `«${v.inf}» es irregular aquí.`, correct, why };

  return { result: "bad", correct, why };
}

function renderFeedback(el, check, extraHtml = "") {
  const ok = check.result === "ok";
  el.innerHTML =
    `<span class="verdict ${ok ? "ok" : "bad"}">${ok ? "Correcto" : "No"}</span>` +
    (ok
      ? ""
      : (check.typed ? `<p class="typed">escribiste <s>${esc(check.typed)}</s></p>` : "") +
        `<p class="correct-form">${check.correct}</p>`) +
    (check.msg ? `<p class="why">${check.msg}</p>` : "") +
    (check.why ? `<p class="why">${check.why}</p>` : "") +
    extraHtml;
  el.hidden = false;
}

/* The correct form lands below the input, which on a phone sits right at the
   bottom of the visible area once the keyboard has been up. Pull it into view so
   a wrong answer never scrolls past unseen. `nearest` scrolls the minimum needed,
   and pins the top edge when the feedback is taller than the screen — so the
   verdict and the correct form are what stays visible either way. */
function showFeedback(el) {
  requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }));
}

/* «continuar» appears under the answer and takes focus so Enter moves on. That
   leaves it exposed to the tail of the very keypress that submitted the answer:
   a held Enter auto-repeats onto the fresh button, and an impatient second tap
   lands on it too — either way the next sentence replaces the feedback before it
   can be read. Swallow key repeats, and ignore activations in the first moments
   after an answer is shown. (The single-press case is handled at the source, by
   preventDefault on the input's Enter — see the keydown listener below.) */
const CONTINUE_LOCK = 600;
let continueArmed = 0;
const armContinue = () => { continueArmed = now() + CONTINUE_LOCK; };

function onContinue(btn, fn) {
  btn.addEventListener("keydown", (e) => { if (e.repeat) e.preventDefault(); });
  btn.addEventListener("click", () => { if (now() >= continueArmed) fn(); });
}

/* ---------- sentence pool shared by both modes ---------- */

const SENT_KEYS = SENTENCES.map((_, i) => String(i));
const activeKeys = () => SENT_KEYS.filter((k) => S.tsel[SENTENCES[Number(k)].t]);

const sentenceHTML = (s) =>
  `${s.b ? s.b + " " : ""}<span class="blank">&nbsp;</span> ${s.a}`;

const hintText = (s) => `(${s.v}${s.hint ? ", " + s.hint : ""})`;

function cueHtml(s) {
  const cue = CUES[s.c];
  return `<br><span class="cue-label">${cue.label}</span><p class="why">${cue.why}</p>`;
}

function fillBlank(textEl, s) {
  const blank = textEl.querySelector(".blank");
  blank.textContent = conjugate(VMAP[s.v], s.t, s.p);
  blank.classList.add("filled");
}

function metaLine(el, store) {
  const keys = activeKeys();
  const due = keys.filter((k) => store[k] && store[k].due <= now()).length;
  const seen = keys.filter((k) => store[k]).length;
  el.textContent = `${seen}/${keys.length} frases vistas · ${due} para repasar`;
}

/* tense filter chips, rendered identically in both practice tabs */
function renderChips() {
  for (const id of ["escChips", "elegChips"]) {
    $(id).innerHTML = "";
    for (const t of TENSES) {
      const b = document.createElement("button");
      b.textContent = TENSE_SHORT[t];
      b.classList.toggle("on", !!S.tsel[t]);
      b.addEventListener("click", () => {
        if (S.tsel[t] && Object.values(S.tsel).filter(Boolean).length === 1) return;
        S.tsel[t] = !S.tsel[t];
        save();
        renderChips();
        if (escCur && !S.tsel[escCur.s.t]) escNext(); else metaLine($("escMeta"), S.esc);
        if (elegCur && !S.tsel[elegCur.s.t]) elegNext(); else metaLine($("elegMeta"), S.eleg);
      });
      $(id).appendChild(b);
    }
  }
}

/* ---------- writing mode (escribe la forma) ---------- */

let escCur = null;

function escNext() {
  const key = pickItem(S.esc, activeKeys());
  const s = SENTENCES[Number(key)];
  escCur = { key, s, v: VMAP[s.v] };
  $("escText").innerHTML = sentenceHTML(s);
  $("escHint").textContent = hintText(s);
  $("escInput").value = "";
  $("escInput").disabled = false;
  $("escFeedback").hidden = true;
  $("escNext").hidden = true;
  $("escReveal").hidden = false;
  metaLine($("escMeta"), S.esc);
  if (activeTab === "esc") $("escInput").focus();
}

function escCheck() {
  if (!escCur || !$("escNext").hidden) return;
  const raw = $("escInput").value;
  if (!clean(raw)) return;
  escFinish(checkAnswer(escCur.v, escCur.s.t, escCur.s.p, raw));
}

// «no lo sé»: show the form rather than let a blind guess decide the answer is
// unknowable. It counts as wrong, so the sentence comes back soon — but with the
// answer already seen once.
function escReveal() {
  if (!escCur || !$("escNext").hidden) return;
  const { v, s } = escCur;
  escFinish({
    result: "bad",
    correct: correctForm(v, s.t, s.p),
    why: explainForm(v, s.t, s.p),
    msg: "Sin respuesta: mira la forma y la frase volverá pronto.",
  });
}

function escFinish(check) {
  const s = escCur.s;
  const rec = S.esc[escCur.key] || (S.esc[escCur.key] = { box: 0, due: 0 });
  grade(rec, check.result);
  save();
  renderFeedback($("escFeedback"), check, cueHtml(s));
  fillBlank($("escText"), s);
  $("escInput").disabled = true;
  $("escReveal").hidden = true;
  $("escNext").hidden = false;
  // focus without scrolling: the button sits below the feedback, and letting it
  // scroll itself into view can push the correct form back off the top
  $("escNext").focus({ preventScroll: true });
  armContinue();
  showFeedback($("escFeedback"));
}

/* ---------- choice mode (elige la forma) ---------- */

let elegCur = null;

// 4 conjugated forms of the sentence's verb: the right one, the same person in
// other tenses (the real decision), and wrong persons as filler if forms collide.
// For a perfecto answer the indefinido is always offered and also accepted, as
// in Galicia (galicia flag), with a remark that the compound is the standard.
function makeOptions(v, tense, p) {
  const correct = conjugate(v, tense, p);
  const used = new Set([correct]);
  const opts = [{ f: correct, ok: true }];
  if (tense === "perf") {
    const f = conjugate(v, "pret", p);
    if (!used.has(f)) { used.add(f); opts.push({ f, galicia: true }); }
  }
  for (const t of shuffle(TENSES.filter((x) => x !== tense))) {
    if (opts.length === 4) break;
    const f = conjugate(v, t, p);
    if (!used.has(f)) { used.add(f); opts.push({ f, ok: false, t }); }
  }
  for (const q of shuffle([0, 1, 2, 3, 4, 5].filter((x) => x !== p))) {
    if (opts.length === 4) break;
    const f = conjugate(v, tense, q);
    if (!used.has(f)) { used.add(f); opts.push({ f, ok: false, t: tense, p: q }); }
  }
  return shuffle(opts);
}

function elegNext() {
  const key = pickItem(S.eleg, activeKeys());
  const s = SENTENCES[Number(key)];
  elegCur = { key, s, v: VMAP[s.v], opts: makeOptions(VMAP[s.v], s.t, s.p) };
  $("elegText").innerHTML = sentenceHTML(s);
  $("elegHint").textContent = hintText(s);
  const box = $("elegChoice");
  box.innerHTML = "";
  elegCur.opts.forEach((o, i) => {
    const b = document.createElement("button");
    b.textContent = o.f;
    b.addEventListener("click", () => elegChoose(i, b));
    box.appendChild(b);
  });
  $("elegFeedback").hidden = true;
  $("elegNext").hidden = true;
  metaLine($("elegMeta"), S.eleg);
}

function elegChoose(i, btn) {
  if (!elegCur || !$("elegNext").hidden) return;
  const { s, v, opts } = elegCur;
  const o = opts[i];
  const accepted = o.ok || o.galicia;
  const buttons = [...$("elegChoice").children];
  buttons.forEach((b) => { b.disabled = true; });
  buttons[opts.findIndex((x) => x.ok)].classList.add("right");
  if (o.galicia) btn.classList.add("right");
  else if (!o.ok) btn.classList.add("wrong");
  const rec = S.eleg[elegCur.key] || (S.eleg[elegCur.key] = { box: 0, due: 0 });
  grade(rec, accepted ? "ok" : "bad");
  save();
  let msg;
  if (o.galicia)
    msg = `En Galicia se usa el indefinido, pero la forma estándar aquí es el perfecto «${conjugate(v, s.t, s.p)}».`;
  else if (!o.ok)
    msg = o.p !== undefined
      ? `«${o.f}» es «${PERSONS[o.p]}», pero el sujeto es «${PERSONS[s.p]}».`
      : `«${o.f}» no encaja en este contexto.`;
  renderFeedback(
    $("elegFeedback"),
    { result: accepted ? "ok" : "bad", correct: correctForm(v, s.t, s.p), msg },
    cueHtml(s)
  );
  fillBlank($("elegText"), s);
  $("elegNext").hidden = false;
  $("elegNext").focus({ preventScroll: true });
  armContinue();
  showFeedback($("elegFeedback"));
}

/* ---------- reference tab ---------- */

function buildReference() {
  const row = (cells, tag = "td") => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
  const table = (head, rows) =>
    `<table>${row(head, "th")}${rows.map((r) => row(r)).join("")}</table>`;

  const endings = table(
    ["", "-ar indef.", "-er/-ir indef.", "-ar imp.", "-er/-ir imp."],
    PERSONS.map((p, i) => [p, PRET_AR[i], PRET_ERIR[i], IMP_AR[i], IMP_ERIR[i]])
  );

  const compound = table(
    ["", "perfecto", "pluscuamperfecto"],
    PERSONS.map((p, i) => [p, HABER_PRES[i] + " + part.", HABER_IMP[i] + " + part."])
  );
  const parts = VERBS.filter((v) => v.part)
    .map((v) => `<b>${v.inf}</b> → ${v.part}`)
    .join(", ");

  const hablar = VMAP["hablar"], serV = VMAP["ser"];
  const subjTable = table(
    ["", "hablar", "ser / ir"],
    PERSONS.map((p, i) => [p, `${subjunctive(hablar, i, false)} / ${subjunctive(hablar, i, true)}`, subjunctive(serV, i, false)])
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
    <h2>Terminaciones simples</h2>${endings}
    <h2>Perfecto y pluscuamperfecto</h2>
    <p class="why">Haber conjugado + participio. Participio regular: -ar → -ado, -er/-ir → -ido.</p>
    ${compound}
    <p>Participios irregulares: ${parts}.</p>
    <h2>Imperfecto de subjuntivo</h2>
    <p class="why">3ª persona plural del indefinido − «ron» + -ra o -se (equivalentes): hablaron → hablara/hablase, dijeron → dijera, fueron → fuera. Nosotros lleva tilde: habláramos.</p>
    ${subjTable}
    <h2>Pretéritos fuertes</h2>
    <p class="why">Raíz irregular + -e, -iste, -o, -imos, -isteis, -ieron (sin tilde; los en -j hacen -eron).</p>
    <ul>${strongs}</ul>
    <h2>Totalmente irregulares</h2><ul>${fulls}</ul>
    <h2>Cambio vocálico (solo 3ª persona)</h2><p>${stem3}</p>
    <h2>i → y (solo 3ª persona)</h2><p>${yod}</p>
    <h2>Imperfecto irregular</h2>
    <p>Solo tres: <b>ser</b> (era…), <b>ir</b> (iba…), <b>ver</b> (veía…).</p>
    <h2>¿Qué tiempo del pasado?</h2><ul>${cues}</ul>
    <h2>Verbos que cambian de significado</h2>
    <ul>
      <li><b>saber</b>: sabía = knew · supe = found out</li>
      <li><b>conocer</b>: conocía = knew · conocí = met</li>
      <li><b>querer</b>: quería = wanted · quise = tried · no quise = refused</li>
      <li><b>poder</b>: podía = was able · pude = managed to · no pude = failed to</li>
    </ul>
    <p class="why">El pretérito anterior (hube hablado) es hoy literario y no se practica aquí.</p>`;
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

let activeTab = "esc";
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    activeTab = b.dataset.tab;
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
    for (const t of ["esc", "eleg", "ref"]) $("tab-" + t).hidden = t !== activeTab;
  })
);

$("escSubmit").addEventListener("click", escCheck);
$("escReveal").addEventListener("click", escReveal);
// One Enter used to submit the answer AND skip past it. keydown ran escCheck,
// which moved focus to «continuar»; the keypress of that same press then landed
// on the freshly focused button and activated it, so the correct form was drawn
// and wiped within a single keystroke — it never showed for a typed answer.
// preventDefault on the keydown suppresses that keypress, so Enter only submits.
$("escInput").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.repeat) return;
  e.preventDefault();
  escCheck();
});
onContinue($("escNext"), escNext);
onContinue($("elegNext"), elegNext);

document.querySelectorAll("#accentBar button").forEach((b) => {
  // pointerdown, not click: preventDefault here keeps the input focused, so iOS
  // never dismisses the keyboard between taps.
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const inp = $("escInput");
    if (inp.disabled) return;
    const start = inp.selectionStart ?? inp.value.length;
    const end = inp.selectionEnd ?? start;
    inp.value = inp.value.slice(0, start) + b.textContent + inp.value.slice(end);
    inp.focus();
    inp.setSelectionRange(start + 1, start + 1);

    // restart the flash even when the same key is tapped twice in a row
    b.classList.remove("flash");
    void b.offsetWidth;
    b.classList.add("flash");
  });
  // drop the class once it has played: a leftover .flash replays itself whenever the
  // tab is shown again, since display:none -> display restarts CSS animations
  b.addEventListener("animationend", () => b.classList.remove("flash"));
});

applyTheme();
buildReference();
renderChips();
escNext();
elegNext();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.update();
    // a worker that takes over mid-session left the page running the old assets
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  });
  // catch a new deploy when the app is reopened from the background
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update());
  });
}
