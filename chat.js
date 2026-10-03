/* Pasado — «Charlar»: a conversation that keeps her talking about the past.

   Two halves:
   - analyzer.js reads what she writes. It is deterministic and only flags what
     the conjugation engine knows is wrong, so a verb correction is never
     invented.
   - Gemini, reached with her own free API key (gemini.js), corrects the rest
     of the message like a teacher and answers as Lucía; it is told what the
     analyzer found, what to recast and which tense to steer towards. Without
     it — no key, no connection, a spent quota — a guided tutor asks the
     prepared questions in chat-data.js instead and says that Gemini didn't
     answer. The chat never depends on Gemini being there.

   Corrections are non-invasive: the tutor recasts the right form in its reply
   instead of pointing at the mistake, and the details sit in a small note under
   her message that she can open or ignore. Verbs she gets wrong come back
   sooner in the writing drill. */

const Chat = (() => {
  /* ---------- state ---------- */

  const C = (S.chat = Object.assign(
    {
      msgs: [], // {r: "u" | "t", x: text, ai?: Gemini's corrections of her message}
      model: null, // a MODELS key, "none" for the guided tutor, null before the first choice
      voice: false,
      showFix: true,
      topic: null, // {id, i}: current topic and how many follow-ups were used
      recent: [], // topic ids used lately, to avoid repeats
      err: {}, // chat mistakes per tense, to steer topics towards weak spots
      stats: { msgs: 0, past: 0, fixes: 0 },
    },
    S.chat || {}
  ));
  const MAX_MSGS = 80;

  /* Gemini runs on Google's servers with her own free key, so it needs a
     connection and her messages go to Google. The «-latest» names follow
     Google's current Flash models, so the app doesn't break when one is
     retired. */
  const MODELS = [
    { key: "gemini", name: "Gemini Flash", api: "gemini-flash-latest", note: "el que mejor conversa y corrige" },
    { key: "geminilite", name: "Gemini Flash-Lite", api: "gemini-flash-lite-latest", note: "más rápido; cupo gratuito aparte, por si se agota el otro" },
  ];
  const modelByKey = (k) => MODELS.find((m) => m.key === k);

  // the chat used to run small models on the device; whoever chose one moves to Gemini
  delete C.dl;
  delete C.crash;
  try { localStorage.removeItem("pasado.llmguard"); } catch {}
  if (C.model && C.model !== "none" && !modelByKey(C.model)) C.model = Gemini.getKey() ? "gemini" : null;
  save();

  const llm = { state: "off", engine: null, id: null, error: "" };
  let busy = false; // a reply is being written
  // the last turn Gemini didn't answer, to say so and offer to ask it again
  let missed = null; // {why, turn}

  /* ---------- connecting ---------- */

  // Nothing to load: one tiny request checks the key and the model before the
  // first real turn, so a bad key shows up now and not mid-chat.
  let connecting = null;
  function connect(key) {
    if (!connecting) connecting = checkKey(key).finally(() => { connecting = null; });
    return connecting;
  }

  async function checkKey(key) {
    const m = modelByKey(key);
    if (!m) return;
    const apiKey = Gemini.getKey();
    Object.assign(llm, { state: "loading", engine: null, id: m.api, error: "" });
    if (!apiKey) Object.assign(llm, { state: "error", error: "Falta la clave de Gemini: pégala en ajustes." });
    renderStatus();
    if (!apiKey) return;
    try {
      const engine = Gemini.engine(m.api, apiKey);
      await engine.chat.completions.create({ messages: [{ role: "user", content: "Hola" }], max_tokens: 1 });
      // she may have switched to the guided tutor while this was checked
      if (llm.id !== m.api) return;
      Object.assign(llm, { state: "ready", engine });
    } catch (e) {
      if (llm.id !== m.api) return;
      Object.assign(llm, { state: "error", engine: null, error: describeError(e) });
    }
    renderStatus();
    renderMeta();
  }

  const describeError = (e) => Gemini.describe(e) || "Gemini ha fallado (" + String((e && e.message) || e).slice(0, 120) + ").";

  /* ---------- topics and turns ---------- */

  const topicById = (id) => TOPICS.find((t) => t.id === id);

  // Weighted towards tenses she gets wrong in chat and ones she hasn't used yet,
  // limited to the tenses selected in the chips (shared with the drills).
  function pickTopic() {
    const tenses = TENSES.filter((t) => S.tsel[t]);
    const weights = tenses.map((t) => 1 + Math.min(3, C.err[t] || 0));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let t = tenses[0];
    for (let i = 0; i < tenses.length; i++) if ((r -= weights[i]) < 0) { t = tenses[i]; break; }
    let pool = TOPICS.filter((x) => x.t === t && !C.recent.includes(x.id));
    if (!pool.length) pool = TOPICS.filter((x) => x.t === t);
    const topic = pool[Math.floor(Math.random() * pool.length)];
    C.recent = [topic.id, ...C.recent].slice(0, 12);
    C.topic = { id: topic.id, i: 0, turns: 0, thin: 0 };
    return topic;
  }

  /* What the next turn should do. A real chat follows what she just said, so
     the tutor stays on the topic and asks about *her* answer. The prepared
     questions only come in when the thread runs dry: a thin answer (a few words,
     no past verb), two of those in a row or a long run on one topic moves on to
     a new topic, and so does «otro tema».
     Each turn carries a tense "angle" for the follow-up: mostly the topic's
     tense, now and then its natural partner (what happened ↔ what it was like). */
  const PARTNER = { pret: "imp", imp: "pret", perf: "pret", plusc: "pret", subj: "imp" };
  const MAX_TURNS = 8;

  // the topic's next prepared question, skipping any she has already answered
  // («¿Ibas a la playa…?» right after «iba siempre a la playa»)
  const STOP = new Set("donde cuando como para pero porque sobre entre desde hasta quien cual cuanto alguna algun mucho mucha muchos muchas otra otro tenias hacias".split(" "));
  const contentWords = (x) => (x.toLowerCase().match(/\p{L}{5,}/gu) || []).map(Analyzer.strip).filter((w) => !STOP.has(w));
  function nextPrepared(topic) {
    const said = new Set(C.msgs.filter((m) => m.r === "u").slice(-8).flatMap((m) => contentWords(m.x)));
    while ((C.topic.i || 0) < topic.follow.length) {
      const q = topic.follow[C.topic.i++];
      if (!contentWords(q).some((w) => said.has(w))) return q;
    }
    return null;
  }

  function planTurn(an) {
    const last = C.msgs[C.msgs.length - 1];
    const words = last ? last.x.split(/\s+/).filter(Boolean).length : 0;
    const thin = words <= 2 || (an.uses.length === 0 && words < 5);
    let topic = C.topic && topicById(C.topic.id);
    if (topic && S.tsel[topic.t]) {
      const st = C.topic;
      st.turns = (st.turns || 0) + 1;
      st.thin = thin ? (st.thin || 0) + 1 : 0;
      if (st.turns < MAX_TURNS && st.thin < 2) {
        let tense = topic.t;
        if (st.turns % 3 === 0 && S.tsel[PARTNER[tense]]) tense = PARTNER[tense];
        // a thin answer gets a prepared question to restart from; a full one is followed up
        const prepared = thin ? nextPrepared(topic) : null;
        return { topic, tense, prepared, switched: false, thin };
      }
    }
    topic = pickTopic();
    return { topic, tense: topic.t, prepared: topic.open, switched: true, thin };
  }

  /* ---------- tutor replies ---------- */

  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // the correction worth recasting: a sure one first, accents aside (a recast
  // can't show an accent), else the soft hint
  function recastable(an) {
    return an.findings.find((f) => f.sure && f.kind !== "accent") || an.findings.find((f) => !f.sure);
  }
  // the same form, said back to her: yo -> tú, nosotros -> vosotros
  function echoForm(f) {
    if (f.t === "part") return f.fix.toLowerCase();
    return Analyzer.formFor(VMAP[f.v], f.t, Analyzer.shiftPerson(f.p));
  }

  // Without a model: react, then follow her answer with a general question in
  // the turn's tense, so it still reads as a reply to what she said and not as
  // a questionnaire. Prepared questions only restart a thread that ran dry.
  function guidedReply(an, plan) {
    // without understanding her answer, a prepared question can ask what she
    // already said; after a full answer only the general follow-ups are safe
    const f = recastable(an);
    const react = f ? pick(ECHO)(echoForm(f)) : plan.thin ? pick(["Vale.", "Bueno.", "Ya."]) : pick(ACKS);
    if (plan.switched) return `${react} Oye, cambiando de tema: ${plan.prepared}`;
    return `${react} ${plan.prepared || pick(FOLLOW_UP[plan.tense])}`;
  }

  const TENSE_WORD = { pret: "indefinido", imp: "imperfecto", perf: "perfecto", plusc: "pluscuamperfecto", subj: "imperfecto de subjuntivo" };

  /* Gemini is a teacher as well as a partner to chat with. The analyzer only
     knows verb forms; Gemini reads the whole message — spelling, accents,
     ser/estar, which past tense fits, agreement, missing words — so one
     request returns both her corrections and Lucía's reply, as JSON. The
     reply is written after the corrections, so it can recast what was fixed.
     What the analyzer is sure of goes in as a given, so the two never
     disagree; its soft hints go in as candidates for Gemini to judge. */
  const SYSTEM = `Eres Lucía, una profesora de español de España que charla por chat con una alumna que está aprendiendo español y practica los tiempos del pasado. En cada turno haces dos cosas.

1. Corriges su ÚLTIMO mensaje como una buena profesora: todos los errores reales, no solo los verbos.
- Ortografía («nevriose» → «nerviosa», «empiecan» → «empezaban») y tildes («dia» → «día», «si» afirmativo → «sí», «tambien» → «también»).
- Conjugación y elección de tiempo. Las descripciones, los estados, los sentimientos y lo que estaba en curso van en imperfecto («Fui muy nerviosa» → «Estaba muy nerviosa», «y esperando» → «y estaba esperando»); las acciones terminadas, en indefinido. Que la frase sea coherente con el momento del que habla.
- Ser o estar, género y número, preposiciones, palabras que faltan o sobran, calcos de otras lenguas.
No corrijas mayúsculas ni puntuación, ni cambies lo que ya es correcto aunque pudiera decirse de otra manera. Si el mensaje está bien, no hay correcciones.
Cada corrección: «original» es el fragmento tal cual lo escribió ella, copiado letra a letra, con las menos palabras posibles pero que no se repita en el mensaje; «corregido» es lo que va en su lugar; «explicacion» es una frase corta y sencilla, en español, que diga por qué; si es un verbo, «verbo» es su infinitivo y «tiempo» el tiempo de la forma correcta. Van en el orden en que aparecen. «frase_corregida» es su mensaje entero ya corregido.

2. Le contestas («respuesta») como en un chat entre amigas, en español de España, natural y cercano: una reacción corta a lo que te ha contado y una sola pregunta sobre eso mismo que la invite a contar más. Como mucho dos frases, sin emojis. Nunca hables de sus errores ni de gramática en la respuesta: si se equivocó, usa tú la forma correcta con naturalidad.

Contesta solo con un objeto JSON con «correcciones» (la lista), «frase_corregida» y «respuesta».`;

  const AI_TENSE = { indefinido: "pret", imperfecto: "imp", perfecto: "perf", pluscuamperfecto: "plusc", subjuntivo: "subj" };
  const S_STR = { type: "STRING" };
  const SCHEMA = {
    type: "OBJECT",
    properties: {
      correcciones: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            original: S_STR,
            corregido: S_STR,
            explicacion: S_STR,
            verbo: S_STR,
            tiempo: { type: "STRING", enum: [...Object.keys(AI_TENSE), "presente", "otro"] },
          },
          required: ["original", "corregido", "explicacion"],
          propertyOrdering: ["original", "corregido", "explicacion", "verbo", "tiempo"],
        },
      },
      frase_corregida: S_STR,
      respuesta: S_STR,
    },
    required: ["correcciones", "frase_corregida", "respuesta"],
    propertyOrdering: ["correcciones", "frase_corregida", "respuesta"],
  };

  function geminiMessages(an, use, tense, plan) {
    const fx = (f) => `«${f.text}» → «${f.fix}»`;
    const sure = an.findings.filter((f) => f.sure);
    const soft = an.findings.filter((f) => !f.sure);
    const turn = [
      sure.length ? `El corrector automático ya ha comprobado estos errores, inclúyelos: ${sure.map(fx).join(", ")}.` : "",
      soft.length ? `El corrector automático sospecha esto, decide tú si es un error: ${soft.map(fx).join(", ")}.` : "",
      use ? `En tu respuesta usa la forma «${use}».` : "",
      plan.switched
        ? "Esta vez la respuesta no lleva ninguna pregunta: solo reacciona a lo que ha dicho, porque después vais a cambiar de tema."
        : plan.thin && plan.prepared
          ? `Ha contestado muy poco: sigue con esta pregunta, o con una parecida: ${plan.prepared}`
          : `Haz la pregunta en pretérito ${TENSE_WORD[tense]}, para que ella conteste en ese tiempo.`,
    ].filter(Boolean).join("\n");
    const messages = [{ role: "system", content: SYSTEM + "\n\nEn este turno:\n" + turn }];
    for (const m of C.msgs.slice(-16)) messages.push({ role: m.r === "u" ? "user" : "assistant", content: m.x });
    return messages;
  }

  // the reply part of Gemini's answer; the corrections are checked where they're placed
  function cleanReply(raw, plan) {
    let s = (raw || "").replace(/[*_#`]/g, "").replace(/^\s*lucía\s*:\s*/i, "").replace(/\s+/g, " ").trim();
    if (!s || NOT_SPANISH.test(s) || REFUSAL.test(s)) return null;
    if (plan.switched) {
      const said = (s.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [s]).map((x) => x.trim()).filter((x) => x && !x.endsWith("?"));
      s = [...(said.length ? said.slice(0, 2) : [pick(ACKS)]), "Oye, cambiando de tema:", plan.prepared].join(" ");
    }
    return Analyzer.repair(s);
  }

  // one turn with Gemini: {reply, ai: {fx, full}}, or {fail: why} for the guided tutor to take over
  async function geminiTurn(an, plan) {
    const f = recastable(an);
    const use = f && f.kind !== "accent" ? echoForm(f) : null;
    const tense = plan.tense === "subj" ? "imp" : plan.tense;
    const messages = geminiMessages(an, use, tense, plan);
    let fail = "";
    // one retry, cooler, before giving the turn to the guided tutor
    for (const temperature of [0.5, 0.2]) {
      const engine = llm.engine;
      const timer = setTimeout(() => { try { engine.interruptGenerate(); } catch {} }, 30000);
      try {
        const res = await engine.chat.completions.create({ messages, temperature, response_format: { type: "json_schema", schema: SCHEMA } });
        const choice = res.choices[0];
        let out = null;
        try { out = JSON.parse(choice.message.content); } catch {}
        const reply = out && cleanReply(out.respuesta, plan);
        if (reply) {
          const fx = (Array.isArray(out.correcciones) ? out.correcciones : []).map((x) => ({
            o: String(x.original || ""), c: String(x.corregido || ""), why: String(x.explicacion || ""),
            v: String(x.verbo || "").toLowerCase().trim(), t: AI_TENSE[x.tiempo] || "",
          }));
          return { reply, ai: { fx, full: String(out.frase_corregida || "") } };
        }
        fail = choice.finish_reason && choice.finish_reason !== "STOP" ? `Su respuesta se cortó (${choice.finish_reason}).` : "Su respuesta no se podía usar.";
        console.warn("pasado: unusable Gemini answer", choice);
      } catch (e) {
        console.warn("pasado: Gemini error", e);
        if (e && e.name === "AbortError") return { fail: "Ha tardado demasiado en contestar." };
        fail = describeError(e);
        // a bad key or a spent quota won't fix itself: say so instead of retrying every turn
        if (e && e.gemini && e.status < 500) {
          Object.assign(llm, { state: "error", engine: null, error: fail });
          renderStatus();
        }
        return { fail };
      } finally {
        clearTimeout(timer);
      }
    }
    return { fail };
  }

  /* Gemini's corrections, placed in her text. Each one is looked for after the
     previous one, so a word she used twice is marked where it was wrong; one
     that can't be found stays in the whole corrected sentence. Where the
     analyzer is sure, it wins; its soft hints were Gemini's to judge, so they
     give way. */
  const sameText = (a, b) => normQ(a) === normQ(b);
  function withAI(an, text, ai) {
    if (!ai) return an;
    const lower = text.toLowerCase();
    const sure = an.findings.filter((f) => f.sure);
    const extra = [];
    let from = 0;
    for (const x of ai.fx || []) {
      if (!x.o || !x.c || x.o === x.c) continue;
      const o = x.o.toLowerCase();
      let i = lower.indexOf(o, from);
      if (i < 0) i = lower.indexOf(o);
      if (i < 0) continue;
      const f = { kind: "ai", start: i, end: i + x.o.length, text: text.slice(i, i + x.o.length), fix: x.c, why: x.why, v: x.v, t: x.t, sure: true, ai: true };
      if ([...sure, ...extra].some((g) => g.start < f.end && f.start < g.end)) continue;
      extra.push(f);
      from = f.end;
    }
    const findings = [...sure, ...extra].sort((a, b) => a.start - b.start);
    const full = ai.full && findings.length && !sameText(ai.full, text) ? ai.full : "";
    return { ...an, findings, full, aiFound: extra };
  }

  // the last question Lucía asked, to frame her answer
  function lastQuestion() {
    for (let i = C.msgs.length - 2; i >= 0; i--)
      if (C.msgs[i].r === "t") {
        const qs = C.msgs[i].x.match(/[^.!?…]*¿[^?]*\?/g);
        return qs ? qs[qs.length - 1].trim() : C.msgs[i].x;
      }
    return "¡Hola!";
  }

  const NOT_SPANISH = /[぀-ヿ㐀-鿿Ѐ-ӿ]/;
  // a model's safety training can misfire on harmless phrases; never show that
  const REFUSAL = /(no puedo (continuar|ayudar|seguir|responder|hablar)|lo siento, pero|como (modelo|asistente|ia)|soy (una|un) (ia|modelo|asistente)|no te preocupes, eres|si estás pensando en hacerte daño|línea de ayuda|teléfono de la esperanza)/i;
  const normQ = (x) => Analyzer.strip(x.toLowerCase()).replace(/[^a-zñ ]/g, "").trim();

  /* ---------- sending ---------- */

  async function send() {
    const input = $("chatInput");
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    input.value = "";
    autosize();
    unlockVoice();

    pushMsg("u", text);
    const mine = C.msgs[C.msgs.length - 1];
    const an = analyzeReply(text, lastQuestion());
    learnFrom(an);
    const bubble = appendUser(text, an);
    const plan = planTurn(an);
    save();
    await answer({ mine, an, bubble, plan });
    busy = false;
  }

  /* Lucía's side of a turn. When Gemini is chosen but doesn't answer — no
     connection, a bad key, a spent quota, a timeout, an answer it couldn't
     use — the guided tutor replies so the chat goes on, and that is said
     plainly right under the reply, with a button to ask Gemini again. */
  async function answer(turn) {
    const { mine, an, plan } = turn;
    const tbubble = appendTutor("", true);
    let reply = null;
    let why = "";
    if (modelByKey(C.model)) {
      if (llm.state === "off" || llm.state === "loading") await connect(C.model);
      if (llm.state === "ready") {
        const r = await geminiTurn(an, plan);
        if (r.reply) {
          reply = r.reply;
          mine.ai = r.ai;
          const full = withAI(an, mine.x, r.ai);
          learnFromAI(full.aiFound);
          turn.bubble.innerHTML = userHTML(mine.x, full);
        } else why = r.fail;
      } else why = llm.error || "No se ha podido conectar.";
    } else {
      await new Promise((r) => setTimeout(r, 450 + Math.random() * 400)); // a beat, so it reads as a reply
    }
    if (!reply) reply = guidedReply(an, plan);
    finishTutor(tbubble, reply);
    missed = why ? { why, turn, tbubble } : null;
    if (why) {
      tbubble.insertAdjacentHTML("afterend",
        `<div class="fallback"><p><b>Gemini no ha contestado.</b> ${esc(why)}</p>` +
        `<p>Te ha respondido el tutor guiado, que solo corrige los verbos.</p>` +
        `<button data-act="again">preguntar otra vez a Gemini</button></div>`);
      keepInView();
    }
    pushMsg("t", reply);
    renderStatus();
    renderTopic();
    renderMeta();
    speak(reply);
  }

  // the guided reply to the last message goes, and Gemini gets that turn again
  async function askAgain() {
    if (!missed || busy) return;
    const { turn, tbubble } = missed;
    missed = null;
    if (C.msgs[C.msgs.length - 2] !== turn.mine) return renderStatus(); // she has written since
    busy = true;
    C.msgs.pop();
    save();
    const note = tbubble.nextElementSibling;
    if (note && note.classList.contains("fallback")) note.remove();
    tbubble.remove();
    if (llm.state === "error") Object.assign(llm, { state: "off", engine: null });
    await answer(turn);
    busy = false;
  }

  // the tense of the question she is answering shapes the hints («¿Qué hacías?» -> imp)
  function analyzeReply(text, question) {
    const u = Analyzer.analyze(question || "").uses[0];
    const topic = C.topic && topicById(C.topic.id);
    return Analyzer.analyze(text, topic && topic.t, { qTense: u && u.t });
  }

  function pushMsg(r, x) {
    C.msgs.push({ r, x });
    if (C.msgs.length > MAX_MSGS) C.msgs = C.msgs.slice(-MAX_MSGS);
    save();
  }

  /* Mistakes feed the drills: the sentences with that verb and tense become due
     now in «Escribir», so the form comes back in the exercise she already knows. */
  function learnFrom(an) {
    C.stats.msgs++;
    C.stats.past += an.uses.length;
    const sure = an.findings.filter((f) => f.sure && f.kind !== "accent");
    C.stats.fixes += sure.length;
    for (const f of sure) drillAgain(f.v, f.t === "part" ? "perf" : f.t);
    // mistakes fade: a tense used well slowly stops being pushed
    for (const u of an.uses) if (C.err[u.t] && !sure.some((f) => f.t === u.t)) C.err[u.t] = Math.max(0, C.err[u.t] - 0.25);
  }

  function drillAgain(v, t) {
    if (TENSES.includes(t)) C.err[t] = (C.err[t] || 0) + 1;
    if (!v) return;
    let keys = SENTENCES.map((s, i) => (s.v === v && s.t === t ? i : -1)).filter((i) => i >= 0);
    if (!keys.length) keys = SENTENCES.map((s, i) => (s.v === v ? i : -1)).filter((i) => i >= 0);
    for (const i of keys.slice(0, 3)) {
      const rec = S.esc[i] || (S.esc[i] = { box: 0, due: 0 });
      rec.due = Math.min(rec.due, now());
    }
  }

  // what Gemini found beyond the analyzer counts too; its verb slips feed the drills alike
  function learnFromAI(found) {
    C.stats.fixes += found.length;
    for (const f of found) if (f.v || f.t) drillAgain(f.v, f.t);
  }

  /* ---------- rendering ---------- */

  const log = () => $("chatLog");

  /* Follow the conversation like a messaging app. Scrolling a message "into
     view" isn't enough: the input box is pinned to the bottom of the screen
     (and on the iPhone the keyboard sits under it), so a message aligned to
     the bottom edge ends up hidden behind them. The input is the last thing
     on the page, so scrolling to the very end puts the newest message right
     above it. */
  const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
  function toBottom(smooth) {
    requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? "smooth" : "auto" })
    );
  }
  function keepInView() {
    if (!$("tab-chat").hidden) toBottom(true);
  }

  // her message, with the past forms underlined and the slips marked
  function markup(text, an) {
    const fx = an.findings.map((f) => ({ s: f.start, e: f.end, cls: f.sure ? "fx" : "fx soft" }));
    const marks = [
      ...fx,
      // a past form inside a corrected stretch is part of the correction
      ...an.uses
        .filter((u) => !u.fixed && !fx.some((m) => m.s < u.end && u.start < m.e))
        .map((u) => ({ s: u.start, e: u.end, cls: "pv", title: TENSE_SHORT[u.t] })),
    ].sort((a, b) => a.s - b.s);
    let html = "";
    let at = 0;
    for (const m of marks) {
      if (m.s < at) continue;
      html += esc(text.slice(at, m.s));
      html += `<span class="${m.cls}"${m.title ? ` title="${m.title}"` : ""}>${esc(text.slice(m.s, m.e))}</span>`;
      at = m.e;
    }
    return html + esc(text.slice(at));
  }

  const tildes = (s) => (s.normalize("NFD").match(/\u0301/g) || []).length;
  const KIND_NOTE = {
    irregular: (f) => `«${f.v}» es irregular en este tiempo.`,
    strongAccent: () => "Los pretéritos fuertes (tuve, hizo, dijo, pude…) no llevan tilde.",
    stemPret: () => "El cambio e→i / o→u del indefinido solo va en él/ella y ellos/ellas (pidió, durmieron).",
    diphthong: () => "El diptongo del presente (pienso, vuelvo, duermo) no pasa al pasado.",
    jieron: () => "Con raíz en -j (dij-, traj-, conduj-) la terminación es -eron / -era, sin i.",
    tuS: () => "La forma de «tú» del indefinido no lleva -s al final: hiciste, fuiste, dijiste.",
    participle: (f) => `El participio de «${f.v}» es irregular.`,
    accent: (f) => (tildes(f.fix) < tildes(f.text) ? "Va sin tilde." : "Lleva tilde."),
    person: (f) => `Con «${f.pron}» el verbo va en «${PERSONS[f.p]}».`,
    siCond: () => "Tras «si» de hipótesis va imperfecto de subjuntivo, nunca condicional: si tuviera…, haría.",
    siPsubj: () => "Tras «si» no va presente de subjuntivo: si tuviera (hipótesis) o si tengo (algo posible).",
    comoSi: () => "«Como si» siempre va con imperfecto de subjuntivo: como si fuera, como si supiera.",
    sequence: () => "Con un verbo en pasado delante (quería que…, me pidió que…), lo habitual es el imperfecto de subjuntivo.",
    present: (f) => `Lo has contado en presente. Si hablas del pasado, sería «${f.fix}».`,
    noTrigger: (f) => `Aquí no hay nada que pida subjuntivo (quería que…, si…, como si…). Para contar lo que pasaba: «${f.fix}»; si fue una sola vez, «${f.alt}».`,
    wishQue: (f) => `Después de «${f.trigger} que» va imperfecto de subjuntivo: «${f.fix}».`,
    aspect: (f) => `Si hablas de algo habitual o de cómo eran las cosas, va en imperfecto: «${f.fix}». Si fue una sola vez, está bien así.`,
  };

  function explain(f) {
    if (f.ai) return f.why;
    const v = VMAP[f.v];
    const note = (KIND_NOTE[f.kind] || (() => ""))(f);
    let how = "";
    if (v && !["accent", "present", "sequence", "aspect"].includes(f.kind)) {
      const t = f.t === "part" ? "perf" : f.t;
      if (TENSES.includes(t)) how = explainForm(v, t, Math.max(0, f.p));
    }
    return note + (how ? " " + how : "");
  }

  function annotations(an) {
    if (!an.findings.length && !an.uses.length) return "";
    const fixes = an.findings
      .map((f, i) => {
        const body = f.sure
          ? `<s>${esc(f.text)}</s> → <b>${esc(f.fix)}</b>`
          : `<span class="maybe">¿quizá</span> <b>${esc(f.fix)}</b><span class="maybe">?</span>`;
        return `<button class="note${f.sure ? "" : " soft"}" data-i="${i}">${body}</button>` +
          `<p class="why" data-for="${i}" hidden>${esc(explain(f))}</p>`;
      })
      .join("") +
      (an.full ? `<button class="note whole" data-i="full">frase corregida</button><p class="why fullfix" data-for="full" hidden>${esc(an.full)}</p>` : "");
    const tenses = an.tenses.map((t) => TENSE_SHORT[t]).join(" · ");
    const used = tenses ? `<span class="used">${tenses}</span>` : "";
    if (!fixes) return `<div class="notes">${used}</div>`;
    return C.showFix
      ? `<div class="notes">${fixes}${used}</div>`
      : `<div class="notes"><button class="dot" aria-label="ver correcciones">•</button><div class="more" hidden>${fixes}</div>${used}</div>`;
  }

  const userHTML = (text, an) => `<p class="txt">${markup(text, an)}</p>${annotations(an)}`;

  function appendUser(text, an) {
    const el = document.createElement("div");
    el.className = "msg u";
    el.innerHTML = userHTML(text, an);
    log().appendChild(el);
    keepInView();
    return el;
  }

  const SPEAKER = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>';

  function appendTutor(text, typing = false) {
    const el = document.createElement("div");
    el.className = "msg t" + (typing ? " typing" : "");
    el.innerHTML = `<p class="txt">${esc(text)}</p>`;
    log().appendChild(el);
    if (!typing) finishTutor(el, text);
    keepInView();
    return el;
  }

  function finishTutor(el, text) {
    el.classList.remove("typing");
    el.querySelector(".txt").textContent = text;
    if (window.speechSynthesis && !el.querySelector(".say")) {
      const b = document.createElement("button");
      b.className = "say";
      b.setAttribute("aria-label", "escuchar");
      b.innerHTML = SPEAKER;
      b.addEventListener("click", () => speak(text, true));
      el.appendChild(b);
    }
    keepInView();
  }

  function renderLog() {
    log().innerHTML = "";
    $("chatForm").hidden = C.model === null;
    if (C.model === null) return renderWelcome();
    let q = "";
    for (const m of C.msgs) {
      if (m.r === "u") appendUser(m.x, withAI(analyzeReply(m.x, q), m.x, m.ai));
      else {
        appendTutor(m.x);
        const qs = m.x.match(/¿[^?]*\?/g);
        q = qs ? qs[qs.length - 1] : m.x;
      }
    }
  }

  function renderWelcome() {
    const el = document.createElement("div");
    el.className = "card welcome";
    el.innerHTML = `
      <p class="sentence">Charla en pasado.</p>
      <p class="why">Lucía te pregunta por tu vida —ayer, tu infancia, tus viajes— y tú contestas en pasado.
      Corrige tus mensajes como una profesora: debajo de cada uno quedan los errores y por qué, y ella usa bien las formas en su respuesta.</p>
      <p class="why">Funciona con Gemini y una clave gratuita, que se crea en un minuto en
      <a href="${Gemini.KEY_PAGE}" target="_blank" rel="noopener">Google AI Studio</a>. La clave solo se guarda en este
      dispositivo; tus mensajes se envían a Google.</p>
      <div class="row"><input id="welcomeKey" class="key" type="password" placeholder="clave de Gemini" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(Gemini.getKey())}"><button id="welcomeGemini">empezar</button></div>
      <p class="why">Sin clave puedes charlar con el tutor guiado: preguntas preparadas y solo corrige los verbos.</p>
      <div class="row"><button id="welcomeGuided" class="quiet">empezar sin IA</button></div>`;
    log().appendChild(el);
    $("welcomeGemini").addEventListener("click", () => {
      const k = $("welcomeKey").value.trim();
      if (!k) return $("welcomeKey").focus();
      Gemini.setKey(k);
      start("gemini");
    });
    $("welcomeKey").addEventListener("keydown", (e) => { if (e.key === "Enter") $("welcomeGemini").click(); });
    $("welcomeGuided").addEventListener("click", () => start("none"));
  }

  function start(model) {
    C.model = model;
    save();
    newConversation();
    if (model !== "none") connect(model);
    renderSettings();
  }

  function newConversation() {
    C.msgs = [];
    const topic = pickTopic();
    save();
    renderLog();
    const first = "¡Hola! " + topic.open;
    appendTutor(first);
    pushMsg("t", first);
    renderTopic();
  }

  function changeTopic() {
    if (busy || C.model === null) return;
    const topic = pickTopic();
    const text = "Vale, cambiemos de tema. " + topic.open;
    appendTutor(text);
    pushMsg("t", text);
    renderTopic();
    speak(text);
  }

  function renderTopic() {
    const topic = C.topic && topicById(C.topic.id);
    $("chatTopic").innerHTML = topic && C.model !== null
      ? `${esc(topic.title)} <span class="faint">· ${TENSE_GUIDE[topic.t].name}</span>`
      : "";
    $("chatTopicBtn").hidden = !topic || C.model === null;
  }

  function renderMeta() {
    const m = modelByKey(C.model);
    let who = "tutor guiado";
    if (m) who = m.name + ({ loading: " (conectando)", error: " (no responde)" }[llm.state] || "");
    const st = C.stats;
    const n = (x, one, many) => `${Math.round(x)} ${Math.round(x) === 1 ? one : many}`;
    $("chatMeta").textContent = C.model === null ? "" :
      `${who} · ${n(st.msgs, "mensaje", "mensajes")} · ${n(st.past, "verbo", "verbos")} en pasado · ${n(st.fixes, "corrección", "correcciones")}`;
  }

  // what stops Gemini for more than a turn (key, quota, connection), above the chat
  function renderStatus() {
    const el = $("chatStatus");
    let html = "";
    if (!modelByKey(C.model)) html = "";
    else if (llm.state === "loading") html = `<p>Conectando con Gemini…</p>`;
    else if (llm.state === "error")
      html = `<p><b>Gemini no funciona ahora mismo.</b> ${esc(llm.error)}</p>
        <p class="why">Mientras, te contesta el tutor guiado, que solo corrige los verbos.</p>
        <div class="row"><button data-act="retry">reintentar</button><button data-act="settings" class="quiet">ajustes</button></div>`;
    el.innerHTML = html;
    el.hidden = !html;
    el.classList.toggle("warn", llm.state === "error");
    renderMeta();
  }

  async function retry() {
    if (missed) return askAgain();
    Object.assign(llm, { state: "off", engine: null });
    await connect(C.model);
  }

  $("chatStatus").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "retry") retry();
    if (b.dataset.act === "settings") toggleSettings(true);
  });

  /* ---------- settings ---------- */

  function renderSettings() {
    const el = $("chatSettings");
    const opts = MODELS.map((m) =>
      `<label class="opt"><input type="radio" name="chatModel" value="${m.key}"${C.model === m.key ? " checked" : ""}>
        <span><b>${m.name}</b><br><span class="faint">${m.note}</span></span></label>`
    ).join("");
    el.innerHTML = `
      <h3>IA</h3>
      <p class="why">Gemini, con tu clave gratuita de <a href="${Gemini.KEY_PAGE}" target="_blank" rel="noopener">Google AI Studio</a>.
      Necesita conexión y tus mensajes se envían a Google (con la clave gratuita, Google puede usarlos para mejorar sus productos).</p>
      ${opts}
      <label class="opt"><input type="radio" name="chatModel" value="none"${C.model === "none" ? " checked" : ""}>
        <span><b>Sin IA</b><br><span class="faint">tutor guiado con preguntas preparadas; solo corrige los verbos</span></span></label>
      <div class="row"><input id="chatKey" class="key" type="password" placeholder="clave de Gemini" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(Gemini.getKey())}">${Gemini.getKey() ? '<button id="chatKeyDel" class="quiet">olvidar</button>' : ""}</div>
      <p class="why" id="chatKeyMsg" hidden></p>
      <div class="row"><button id="chatModelGo">usar</button></div>
      <h3>Opciones</h3>
      <label class="opt"><input type="checkbox" id="optFix"${C.showFix ? " checked" : ""}><span>Mostrar las correcciones bajo cada mensaje<br><span class="faint">si no, solo un punto que se abre al tocarlo</span></span></label>
      <label class="opt"><input type="checkbox" id="optVoice"${C.voice ? " checked" : ""}${window.speechSynthesis ? "" : " disabled"}><span>Leer en voz alta las respuestas de Lucía</span></label>
      <div class="row"><button id="chatReset" class="quiet">empezar conversación nueva</button></div>
      <p class="why">Para dictar, usa el micrófono del teclado del iPhone.</p>`;
    $("chatModelGo").addEventListener("click", () => {
      const v = (el.querySelector('input[name="chatModel"]:checked') || {}).value;
      if (!v) return;
      const key = $("chatKey").value.trim();
      if (key !== Gemini.getKey()) Gemini.setKey(key);
      if (modelByKey(v) && !key) {
        $("chatKeyMsg").textContent = "Pega aquí tu clave de Gemini para usarlo.";
        $("chatKeyMsg").hidden = false;
        return $("chatKey").focus();
      }
      const first = C.model === null;
      C.model = v;
      save();
      if (first) newConversation();
      Object.assign(llm, { state: "off", engine: null, id: null });
      if (v !== "none") connect(v); // checks the key again, in case it changed
      toggleSettings(false);
      renderStatus();
    });
    if ($("chatKeyDel"))
      $("chatKeyDel").addEventListener("click", () => {
        Gemini.setKey("");
        if (modelByKey(C.model)) {
          C.model = "none";
          save();
          Object.assign(llm, { state: "off", engine: null, id: null });
          renderStatus();
        }
        renderSettings();
      });
    $("optFix").addEventListener("change", (e) => { C.showFix = e.target.checked; save(); renderLog(); });
    $("optVoice").addEventListener("change", (e) => { C.voice = e.target.checked; save(); if (C.voice) unlockVoice(); });
    $("chatReset").addEventListener("click", () => { if (!busy) { toggleSettings(false); newConversation(); } });
  }

  function toggleSettings(show) {
    const el = $("chatSettings");
    el.hidden = show === undefined ? !el.hidden : !show;
    if (!el.hidden) renderSettings();
    $("chatForm").hidden = !el.hidden || C.model === null;
  }

  /* ---------- voice ---------- */

  let voiceUnlocked = false;
  // iOS only lets speech start from a tap; one silent utterance inside a tap
  // unlocks it for the replies that arrive later
  function unlockVoice() {
    if (voiceUnlocked || !C.voice || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
    voiceUnlocked = true;
  }
  function speak(text, force = false) {
    if (!window.speechSynthesis || (!C.voice && !force)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    const voices = speechSynthesis.getVoices();
    const v = voices.find((x) => x.lang === "es-ES") || voices.find((x) => /^es/.test(x.lang));
    if (v) u.voice = v;
    u.rate = 0.95;
    speechSynthesis.speak(u);
  }

  /* ---------- wiring ---------- */

  function autosize() {
    const i = $("chatInput");
    i.style.height = "auto";
    i.style.height = Math.min(i.scrollHeight, 160) + "px";
  }

  $("chatForm").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  $("chatInput").addEventListener("input", () => {
    const stick = nearBottom();
    autosize();
    if (stick) toBottom(false);
  });
  // the iPhone keyboard opening shrinks the visible area: keep the newest message above it
  if (window.visualViewport)
    visualViewport.addEventListener("resize", () => {
      if (!$("tab-chat").hidden && document.activeElement === $("chatInput")) toBottom(false);
    });
  $("chatInput").addEventListener("focus", () => setTimeout(() => toBottom(true), 350));
  $("chatInput").addEventListener("keydown", (e) => {
    // Enter sends (the iPhone keyboard shows «enviar»); Shift+Enter is a new line
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $("chatTopicBtn").addEventListener("click", changeTopic);
  $("chatSettingsBtn").addEventListener("click", () => toggleSettings());

  // corrections open their explanation on tap; the dot reveals hidden corrections
  log().addEventListener("click", (e) => {
    if (e.target.closest('[data-act="again"]')) return askAgain();
    const note = e.target.closest(".note");
    if (note) {
      const why = note.parentElement.querySelector(`.why[data-for="${note.dataset.i}"]`);
      if (why) why.hidden = !why.hidden;
      return;
    }
    const dot = e.target.closest(".dot");
    if (dot) dot.nextElementSibling.hidden = !dot.nextElementSibling.hidden;
  });

  document.querySelectorAll("#chatAccents button").forEach((b) => {
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault(); // keep the keyboard up
      const inp = $("chatInput");
      const s = inp.selectionStart ?? inp.value.length;
      const en = inp.selectionEnd ?? s;
      inp.value = inp.value.slice(0, s) + b.textContent + inp.value.slice(en);
      inp.focus();
      inp.setSelectionRange(s + b.textContent.length, s + b.textContent.length);
      autosize();
      b.classList.remove("flash");
      void b.offsetWidth;
      b.classList.add("flash");
    });
    b.addEventListener("animationend", () => b.classList.remove("flash"));
  });

  let shown = false;
  function onShow() {
    if (!shown) {
      shown = true;
      renderLog();
      renderTopic();
    }
    renderStatus();
    toBottom(false);
    if (modelByKey(C.model) && llm.state === "off") connect(C.model);
  }

  // the tense chips changed: steer away from a topic whose tense was switched off
  function onTenses() {
    const topic = C.topic && topicById(C.topic.id);
    if (topic && !S.tsel[topic.t] && shown && C.model !== null && !busy) changeTopic();
  }

  return { onShow, onTenses, MODELS };
})();

if (activeTab === "chat") Chat.onShow();
