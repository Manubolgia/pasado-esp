/* Pasado — reads free text (the chat) and finds the past-tense forms in it and
   the slips in them. Everything here is deterministic and built from the same
   conjugation engine as the drills, so a correction is only ever offered when
   the engine is sure the form is wrong — never on a hunch, never by the LLM.

   What it can tell:
   - which past forms were used, and in which tense (for the stats and the tutor)
   - forms that don't exist: regularised irregulars (andé, tení, dormió, pidí),
     wrong participles (he abrido), dijieron, teniera, tuvé…
   - missing or extra accents (vivio, estabamos, fué)
   - person against an explicit subject (yo fue)
   - si + condicional / presente de subjuntivo, como si + presente
   - softer hints: a present where a past was wanted, que + presente de subjuntivo
     after a past verb.
   What it doesn't judge: indefinido vs imperfecto vs perfecto. That depends on
   meaning, and a wrong correction there does more harm than a missed one. */

const Analyzer = (() => {
  const strip = (s) => s.normalize("NFD").replace(/́/g, "").normalize("NFC");
  const PAST = new Set(["pret", "imp", "perf", "plusc", "subj"]);

  /* ---------- present, present subjunctive, conditional (detection only) ---------- */

  const PRES = {
    ar: ["o", "as", "a", "amos", "áis", "an"],
    er: ["o", "es", "e", "emos", "éis", "en"],
    ir: ["o", "es", "e", "imos", "ís", "en"],
  };
  const PSUBJ_AR = ["e", "es", "e", "emos", "éis", "en"];
  const PSUBJ_ERIR = ["a", "as", "a", "amos", "áis", "an"];
  const COND = ["ía", "ías", "ía", "íamos", "íais", "ían"];
  const BOOT = new Set([0, 1, 2, 5]); // the persons where the present stem changes

  const verbClass = (v) => strip(v.inf).slice(-2); // "ar" | "er" | "ir"
  const stemOf = (v) => strip(v.inf).slice(0, -2);

  // pienso, vuelvo, pido, juego: change the last e/o/u of the stem
  function bootChange(stem, kind) {
    const [from, to] = { ie: ["e", "ie"], ue: ["o", "ue"], i: ["e", "i"], u: ["u", "ue"] }[kind] || [];
    if (!from) return stem;
    const i = stem.lastIndexOf(from);
    return i < 0 ? stem : stem.slice(0, i) + to + stem.slice(i + 1);
  }
  // durmamos, sintamos, pidamos: -ir stem changers keep a weaker change in nosotros
  function weakChange(stem, kind) {
    const from = kind === "ue" ? "o" : "e";
    const to = kind === "ue" ? "u" : "i";
    const i = stem.lastIndexOf(from);
    return i < 0 ? stem : stem.slice(0, i) + to + stem.slice(i + 1);
  }
  // consonant changes before -o/-a: cojo, elijo, sigo, conozco
  function yoSpell(stem, inf) {
    const i = strip(inf);
    if (/g(er|ir)$/.test(i)) return stem.replace(/g$/, "j");
    if (/guir$/.test(i)) return stem.replace(/gu$/, "g");
    if (/[aeiou]c(er|ir)$/.test(i)) return stem.replace(/c$/, "zc");
    return stem;
  }

  function present(v, p) {
    if (Array.isArray(v.pres)) return v.pres[p];
    if (p === 0 && v.yo) return v.yo;
    let s = stemOf(v);
    if (v.pres && BOOT.has(p)) s = bootChange(s, v.pres);
    if (p === 0) s = yoSpell(s, v.inf);
    if (v.uir && p !== 3 && p !== 4) s += "y";
    return s + PRES[verbClass(v)][p];
  }

  function presSubj(v, p) {
    if (v.psubj) return v.psubj[p];
    const c = verbClass(v);
    const stem = stemOf(v);
    let base;
    if (v.uir) base = stem + "y";
    else if (v.yo) base = v.yo.replace(/o$/, "");
    else if (Array.isArray(v.pres)) base = BOOT.has(p) ? v.pres[0].replace(/o$/, "") : stem;
    else if (BOOT.has(p)) base = yoSpell(v.pres ? bootChange(stem, v.pres) : stem, v.inf);
    else base = yoSpell(c === "ir" && v.pres ? weakChange(stem, v.pres) : stem, v.inf);
    if (c === "ar") base = base.replace(/c$/, "qu").replace(/g$/, "gu").replace(/z$/, "c");
    return base + (c === "ar" ? PSUBJ_AR : PSUBJ_ERIR)[p];
  }

  const conditional = (v, p) => (v.cond || strip(v.inf)) + COND[p];

  // the form a tense asks for (subjunctive in its -ra spelling)
  const formFor = (v, t, p) => (t === "subj" ? subjunctive(v, p, false) : conjugate(v, t, p));

  /* ---------- index of every form the engine knows ---------- */

  const VBY = Object.fromEntries(VERBS.map((v) => [v.inf, v]));
  const valid = new Map(); // exact form -> [{v, t, p}]
  const add = (form, e) => {
    if (!valid.has(form)) valid.set(form, []);
    valid.get(form).push(e);
  };
  for (const v of VERBS) {
    for (let p = 0; p < 6; p++) {
      add(conjugate(v, "pret", p), { v: v.inf, t: "pret", p });
      add(conjugate(v, "imp", p), { v: v.inf, t: "imp", p });
      add(conjugate(v, "perf", p), { v: v.inf, t: "perf", p });
      add(conjugate(v, "plusc", p), { v: v.inf, t: "plusc", p });
      add(subjunctive(v, p, false), { v: v.inf, t: "subj", p });
      add(subjunctive(v, p, true), { v: v.inf, t: "subj", p });
      add(present(v, p), { v: v.inf, t: "pres", p });
      add(presSubj(v, p), { v: v.inf, t: "psubj", p });
      add(conditional(v, p), { v: v.inf, t: "cond", p });
    }
    add(participle(v), { v: v.inf, t: "part", p: -1 });
  }

  // forms with the accents taken off, to recognise «vivio», «he leido», «fué»
  const bare = new Map(); // stripped -> [exact past forms or participles]
  for (const [form, es] of valid)
    if (es.some((e) => PAST.has(e.t) || e.t === "part")) {
      const k = strip(form);
      if (!bare.has(k)) bare.set(k, []);
      bare.get(k).push(form);
    }

  // Ordinary words that happen to spell a verb form. They never get a
  // correction, and never count as "she used the present".
  const NOT_VERBS = new Set(
    ("este esta esto ese esa eso sabio podio hacia sabia jugo cayo rio seria media continuo tenia como entre nada para sobre casa cuento cuesta " +
     "vaya oye mira toma anda venga sea vale dale cena charla cuenta ayuda baja espera gusto regalo beso " +
     "abrazo baile canto paseo viaje trabajo estudio robo salto trato uso visita cambio pinta lleva deja " +
     "echo mando tira duda llamada hecho dicho visto puesto vuelta cubierto abierto escrito roto muerto " +
     "rato tiempo parada llegada salida comida bebida vida pena encanta gusta").split(" ")
  );

  /* ---------- index of typical learner forms that don't exist ---------- */

  const wrong = new Map(); // form -> {v, t, p, fix, kind}
  const validBare = new Set([...valid.keys()].map(strip));
  const addWrong = (form, info) => {
    // a form that is only a real one without its accent («caiste») is left to the accent rule
    if (valid.has(form) || validBare.has(form) || NOT_VERBS.has(form)) return;
    if (!wrong.has(form)) wrong.set(form, info);
    // the accentless spelling too («tenio»), unless it is how some real form looks
    // without its accent (esté -> «este» is a word in its own right)
    const b = strip(form);
    if (b !== form && !validBare.has(b) && !NOT_VERBS.has(b) && !wrong.has(b)) wrong.set(b, info);
  };
  const PRET_REG = { ar: PRET_AR, er: PRET_ERIR, ir: PRET_ERIR };
  const SUBJ_ENDS = (stem3pl, p, se) => {
    let s = stem3pl;
    if (p === 3) s = s.slice(0, -1) + { a: "á", e: "é", i: "í", o: "ó", u: "ú" }[s.slice(-1)];
    return s + (se ? SUBJ_SE : SUBJ_RA)[p];
  };

  for (const v of VERBS) {
    const c = verbClass(v);
    const stem = stemOf(v);
    const irregular = v.strong || v.pret || v.stem3 || v.y || v.uir;
    if (irregular && stem.length >= 2) {
      for (let p = 0; p < 6; p++) {
        const fix = conjugate(v, "pret", p);
        const reg = stem + PRET_REG[c][p];
        if (reg !== fix) addWrong(reg, { v: v.inf, t: "pret", p, fix, kind: "irregular" });
        // teniera, podiera, dormiera: the subjunctive built on the regular stem
        const reg3 = (stem + PRET_REG[c][5]).replace(/ron$/, "");
        for (const se of [false, true]) {
          const wf = SUBJ_ENDS(reg3, p, se);
          const ok = subjunctive(v, p, se);
          if (wf !== ok) addWrong(wf, { v: v.inf, t: "subj", p, fix: ok, kind: "irregular" });
        }
      }
    }
    if (v.strong) {
      // tuvé, tuvó, hizó: strong preterites carry no accent
      addWrong(v.strong + "é", { v: v.inf, t: "pret", p: 0, fix: conjugate(v, "pret", 0), kind: "strongAccent" });
      const third = conjugate(v, "pret", 2);
      addWrong(third.replace(/o$/, "ó"), { v: v.inf, t: "pret", p: 2, fix: third, kind: "strongAccent" });
      if (v.strong.endsWith("j")) {
        // dijieron, trajiera: j-stems drop the i
        addWrong(v.strong + "ieron", { v: v.inf, t: "pret", p: 5, fix: conjugate(v, "pret", 5), kind: "jieron" });
        for (let p = 0; p < 6; p++)
          for (const se of [false, true])
            addWrong(SUBJ_ENDS(v.strong + "ie", p, se), { v: v.inf, t: "subj", p, fix: subjunctive(v, p, se), kind: "jieron" });
      }
    }
    if (v.stem3) {
      // pidí, durmí, sintió is right but sintí is not: the change is 3rd person only
      for (const p of [0, 1, 3, 4])
        addWrong(v.stem3 + PRET_ERIR[p], { v: v.inf, t: "pret", p, fix: conjugate(v, "pret", p), kind: "stemPret" });
    }
    if (typeof v.pres === "string") {
      // piensé, vuelví, duermí: the present's diphthong carried into the past
      const changed = bootChange(stem, v.pres);
      if (changed !== stem)
        for (let p = 0; p < 6; p++) {
          const fix = conjugate(v, "pret", p);
          let s = changed;
          if (c === "ar" && p === 0) s = s.replace(/c$/, "qu").replace(/g$/, "gu").replace(/z$/, "c");
          addWrong(s + PRET_REG[c][p], { v: v.inf, t: "pret", p, fix, kind: "diphthong" });
          addWrong(changed + (c === "ar" ? IMP_AR : IMP_ERIR)[p], { v: v.inf, t: "imp", p, fix: conjugate(v, "imp", p), kind: "diphthong" });
        }
    }
    // hicistes, fuistes, dijistes: the tú form of the preterite has no -s
    const tu = conjugate(v, "pret", 1);
    addWrong(tu + "s", { v: v.inf, t: "pret", p: 1, fix: tu, kind: "tuS" });
    if (irregular && stem.length >= 2) addWrong(stem + PRET_REG[c][1] + "s", { v: v.inf, t: "pret", p: 1, fix: tu, kind: "irregular" });

    if (v.part) {
      // abrido, escribido, volvido, hacido, vido
      const reg = stem + (c === "ar" ? "ado" : "ido");
      if (reg !== v.part) addWrong(reg, { v: v.inf, t: "part", p: -1, fix: v.part, kind: "participle" });
    }
  }

  /* ---------- context words ---------- */

  const PRONOUNS = {
    yo: [0], "tú": [1], "él": [2], ella: [2], usted: [2],
    nosotros: [3], nosotras: [3], vosotros: [4], vosotras: [4],
    ellos: [5], ellas: [5], ustedes: [5],
  };
  // may sit between a subject and its verb: «yo no le dije», «ella ya se había ido»
  const BETWEEN = new Set("no me te se lo la le los las les nos os ya también tampoco nunca siempre todavía casi".split(" "));
  // a pronoun right after these is not the subject: «a ella le gustó», «tú y yo fuimos»
  const NOT_SUBJECT_AFTER = new Set("a de con para por sin y e o u ni entre según".split(" "));
  const HABER_AUX = new Set([...HABER_PRES, ...HABER_IMP]);

  const MARKERS = [
    ["pret", /\b(ayer|anoche|anteayer|el otro día|aquel día|una vez|de repente|la semana pasada|el (año|mes|verano|invierno|otoño|fin de semana|finde|lunes|martes|miércoles|jueves|viernes|sábado|domingo) pasado|hace (un|una|unos|unas|dos|tres|cuatro|cinco|diez|\d+|mucho|poco)|en (19|20)\d\d)\b/],
    ["imp", /\b(de (pequeña|pequeño|pequeños|niña|niño|niños|joven|jóvenes|adolescente)|cuando (era|éramos|tenía|teníamos|vivía|vivíamos|estaba|estábamos)|antes|siempre|todos los (días|veranos|años|domingos|fines de semana)|todas las (tardes|mañanas|noches|semanas)|a menudo|normalmente|en aquella época|en aquel entonces)\b/],
    ["perf", /\b(hoy|esta (mañana|tarde|semana)|este (año|mes|verano|fin de semana|finde)|alguna vez|últimamente|todavía no|aún no|nunca|ya)\b/],
  ];
  const markerTense = (text) => {
    const l = text.toLowerCase();
    for (const [t, re] of MARKERS) if (re.test(l)) return t;
    return null;
  };

  const shiftPerson = (p) => ({ 0: 1, 1: 0, 3: 4, 4: 3 }[p] ?? p);

  /* ---------- analysis ---------- */

  function tokenize(text) {
    const toks = [];
    const re = /\p{L}+/gu;
    let m;
    let sent = 0;
    let last = 0;
    while ((m = re.exec(text))) {
      // sentence index: count terminators between the previous token and this one
      const gap = text.slice(last, m.index);
      sent += (gap.match(/[.!?;:\n¿¡]+/g) || []).length;
      last = m.index + m[0].length;
      toks.push({ w: m[0].toLowerCase(), start: m.index, end: last, sent });
    }
    return toks;
  }

  function subjectPersons(toks, k) {
    let j = k - 1;
    while (j >= 0 && BETWEEN.has(toks[j].w) && toks[j].sent === toks[k].sent) j--;
    if (j < 0 || toks[j].sent !== toks[k].sent) return null;
    const persons = PRONOUNS[toks[j].w];
    if (!persons) return null;
    if (j > 0 && NOT_SUBJECT_AFTER.has(toks[j - 1].w)) {
      // «mi madre y yo fuimos» is a plural subject, but in «se cayó y yo fue» the
      // «y» joins two clauses: a verb right before it means the pronoun stands alone
      const coord = ["y", "e", "o", "u", "ni"].includes(toks[j - 1].w);
      const before = j > 1 && toks[j - 2].sent === toks[k].sent ? toks[j - 2].w : null;
      if (!(coord && before && valid.has(before) && !NOT_VERBS.has(before))) return null;
    }
    return { persons, pron: toks[j].w };
  }

  // previous meaningful word, skipping clitics and «no»: «si no tuviera», «si me tocara»
  function prevWord(toks, k, back = 1) {
    let j = k - 1;
    let seen = 0;
    while (j >= 0 && toks[j].sent === toks[k].sent) {
      if (!BETWEEN.has(toks[j].w)) {
        seen++;
        if (seen === back) return toks[j].w;
      }
      j--;
    }
    return null;
  }

  /* `target` is the tense the tutor's question was steering towards; it is only
     used to word the soft "this sounds like present" hint. */
  function analyze(text, target) {
    const toks = tokenize(text);
    const uses = []; // {start, end, text, v, t, p}
    const findings = []; // {kind, start, end, text, fix, v, t, p, sure, note}
    const others = []; // present / present-subjunctive / conditional tokens, for the soft rules
    const raw = (a, b) => text.slice(a, b);

    const finding = (f) => {
      f.text = raw(f.start, f.end);
      // a replacement keeps the leading capital («Tení» -> «Tuve»); a hint is a suggestion, not a swap
      if (f.sure && /^\p{Lu}/u.test(f.text)) f.fix = f.fix[0].toUpperCase() + f.fix.slice(1);
      findings.push(f);
    };

    for (let k = 0; k < toks.length; k++) {
      const tk = toks[k];
      const nx = toks[k + 1];

      /* compound tenses: haber + participle */
      if (nx && nx.sent === tk.sent && (HABER_AUX.has(tk.w) || bare.has(strip(tk.w)) && HABER_AUX.has((bare.get(strip(tk.w)) || [])[0]))) {
        const key = tk.w + " " + nx.w;
        const es = (valid.get(key) || []).filter((e) => e.t === "perf" || e.t === "plusc");
        if (es.length) {
          uses.push({ start: tk.start, end: nx.end, text: raw(tk.start, nx.end), ...es[0], all: es, k });
          checkPerson(k, es, tk.start, nx.end, (e, p) => conjugate(VBY[e.v], e.t, p));
          k++;
          continue;
        }
        const wp = wrong.get(nx.w);
        const auxOk = HABER_AUX.has(tk.w) ? tk.w : (bare.get(strip(tk.w)) || [])[0];
        if (wp && wp.kind === "participle") {
          finding({ kind: "participle", start: tk.start, end: nx.end, fix: auxOk + " " + wp.fix, v: wp.v, t: HABER_PRES.includes(auxOk) ? "perf" : "plusc", p: Math.max(HABER_PRES.indexOf(auxOk), HABER_IMP.indexOf(auxOk)), sure: true });
          k++;
          continue;
        }
        const accented = bare.get(strip(key));
        if (accented) {
          const fixed = accented[0];
          const e = valid.get(fixed)[0];
          finding({ kind: "accent", start: tk.start, end: nx.end, fix: fixed, v: e.v, t: e.t, p: e.p, sure: true });
          uses.push({ start: tk.start, end: nx.end, text: raw(tk.start, nx.end), ...e, k, fixed: true });
          k++;
          continue;
        }
      }

      /* single words */
      const es = valid.get(tk.w);
      if (es && !NOT_VERBS.has(tk.w)) {
        const past = es.filter((e) => PAST.has(e.t));
        if (past.length) {
          uses.push({ start: tk.start, end: tk.end, text: raw(tk.start, tk.end), ...past[0], all: past, k });
          checkPerson(k, past, tk.start, tk.end, (e, p) => formFor(VBY[e.v], e.t, p));
        } else if (es.some((e) => e.t !== "part")) {
          others.push({ k, es });
        }
        continue;
      }
      if (es) continue; // a word like «como» or «para»: not a verb here

      const w = wrong.get(tk.w);
      if (w) {
        finding({ kind: w.kind, start: tk.start, end: tk.end, fix: w.fix, v: w.v, t: w.t, p: w.p, sure: true });
        if (w.t !== "part") uses.push({ start: tk.start, end: tk.end, text: raw(tk.start, tk.end), v: w.v, t: w.t, p: w.p, k, fixed: true });
        continue;
      }

      const acc = !NOT_VERBS.has(tk.w) && bare.get(strip(tk.w));
      if (acc) {
        // prefer a past form over a bare participle when both strip the same
        const fixed = acc.find((f) => valid.get(f).some((e) => PAST.has(e.t))) || acc[0];
        const e = valid.get(fixed).find((x) => PAST.has(x.t)) || valid.get(fixed)[0];
        finding({ kind: "accent", start: tk.start, end: tk.end, fix: fixed, v: e.v, t: e.t, p: e.p, sure: true });
        if (PAST.has(e.t)) uses.push({ start: tk.start, end: tk.end, text: raw(tk.start, tk.end), ...e, k, fixed: true });
      }
    }

    function checkPerson(k, es, start, end, make) {
      const subj = subjectPersons(toks, k);
      if (!subj) return;
      if (es.some((e) => subj.persons.includes(e.p))) return;
      const e = es[0];
      const p = subj.persons[0];
      finding({ kind: "person", start, end, fix: make(e, p), v: e.v, t: e.t, p, sure: true, pron: subj.pron });
    }

    /* «si tendría», «si tenga», «como si es»: these are always wrong */
    for (const o of others) {
      const tk = toks[o.k];
      const before = prevWord(toks, o.k);
      const before2 = prevWord(toks, o.k, 2);
      const cond = o.es.find((e) => e.t === "cond");
      const ps = o.es.find((e) => e.t === "psubj");
      const pr = o.es.find((e) => e.t === "pres");
      if (before === "si" && before2 === "como" && (cond || ps || pr)) {
        const e = cond || ps || pr;
        finding({ kind: "comoSi", start: tk.start, end: tk.end, fix: subjunctive(VBY[e.v], e.p, false), v: e.v, t: "subj", p: e.p, sure: true });
        o.done = true;
      } else if (before === "si" && (cond || (ps && !pr))) {
        const e = cond || ps;
        finding({ kind: cond ? "siCond" : "siPsubj", start: tk.start, end: tk.end, fix: subjunctive(VBY[e.v], e.p, false), v: e.v, t: "subj", p: e.p, sure: true });
        o.done = true;
      }
    }

    /* soft hints — at most one, and never on top of a sure correction of the same word */
    const pastSentences = new Set(uses.map((u) => toks[u.k].sent));
    let soft = null;
    for (const o of others) {
      if (o.done || soft) continue;
      const tk = toks[o.k];
      const ps = o.es.find((e) => e.t === "psubj");
      const pr = o.es.find((e) => e.t === "pres");
      // «quería que vengas» -> vinieras: que + present subjunctive after a past verb
      if (ps && !pr && prevWord(toks, o.k) === "que" && uses.some((u) => toks[u.k].sent === tk.sent && u.k < o.k && (u.t === "pret" || u.t === "imp"))) {
        soft = { kind: "sequence", start: tk.start, end: tk.end, fix: subjunctive(VBY[ps.v], ps.p, false), v: ps.v, t: "subj", p: ps.p, sure: false };
      }
    }
    if (!soft) {
      // a present where the past was wanted: only in a sentence that names a past
      // moment («ayer voy al cine») and has no past verb of its own. A present is
      // often right in an answer («no me acuerdo», «creo que…», «todavía vivo
      // allí»), so without such a marker nothing is said.
      const sentText = (s) => {
        const ts = toks.filter((t) => t.sent === s);
        return ts.length ? text.slice(ts[0].start, ts[ts.length - 1].end) : "";
      };
      const NOW_VERBS = new Set(["saber", "recordar", "acordar", "creer", "pensar", "parecer", "gustar", "encantar", "haber", "soler"]);
      for (const o of others) {
        if (o.done) continue;
        const tk = toks[o.k];
        const pr = o.es.find((e) => e.t === "pres");
        if (!pr || NOW_VERBS.has(pr.v)) continue;
        if (pastSentences.has(tk.sent)) continue;
        if (["hace", "hay", "es"].includes(tk.w)) continue;
        if (prevWord(toks, o.k) === "que" || prevWord(toks, o.k) === "si") continue;
        const t = markerTense(sentText(tk.sent));
        if (!t || t === "perf" && !target) continue;
        soft = { kind: "present", start: tk.start, end: tk.end, fix: formFor(VBY[pr.v], t, pr.p), v: pr.v, t, p: pr.p, sure: false };
        break;
      }
    }
    if (soft) finding(soft);

    findings.sort((a, b) => a.start - b.start);
    uses.sort((a, b) => a.start - b.start);
    return { uses, findings, tenses: [...new Set(uses.map((u) => u.t))] };
  }

  /* Correct, in place, the forms in a text the engine knows are wrong. Used on
     the tutor's own replies: a small model will now and then write «andó». */
  function repair(text) {
    const { findings } = analyze(text);
    let out = text;
    for (const f of findings.filter((x) => x.sure).sort((a, b) => b.start - a.start))
      out = out.slice(0, f.start) + f.fix + out.slice(f.end);
    return out;
  }

  return { analyze, repair, present, presSubj, conditional, formFor, markerTense, shiftPerson, strip, valid, wrong };
})();

if (typeof module !== "undefined") module.exports = Analyzer;
