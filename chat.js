/* Pasado — «Charlar»: a conversation that keeps her talking about the past.

   Two halves with a strict division of labour:
   - analyzer.js reads what she writes. It is deterministic and only flags what
     the conjugation engine knows is wrong, so a correction is never invented.
   - the tutor answers. With a model loaded it is a small LLM running on the
     device through WebLLM (WebGPU); it is told what to recast and which tense to
     steer towards, so all it has to do is chat. Without a model — no WebGPU,
     not enough memory, or simply not downloaded — a guided tutor asks the
     prepared questions in chat-data.js instead. The chat never depends on the
     model being there.

   Corrections are non-invasive: the tutor recasts the right form in its reply
   instead of pointing at the mistake, and the details sit in a small note under
   her message that she can open or ignore. Verbs she gets wrong come back
   sooner in the writing drill. */

const Chat = (() => {
  /* ---------- state ---------- */

  const C = (S.chat = Object.assign(
    {
      msgs: [], // {r: "u" | "t", x: text}
      model: null, // a MODELS key, "none" for the guided tutor, null before the first choice
      voice: false,
      showFix: true,
      topic: null, // {id, i}: current topic and how many follow-ups were used
      recent: [], // topic ids used lately, to avoid repeats
      dl: {}, // model ids downloaded on this device
      crash: {}, // model ids that ran out of memory here
      err: {}, // chat mistakes per tense, to steer topics towards weak spots
      stats: { msgs: 0, past: 0, fixes: 0 },
    },
    S.chat || {}
  ));
  const MAX_MSGS = 80;

  /* Model tiers. Sizes are the one-off download; WebLLM keeps the files in
     Cache Storage. q4f16 needs the shader-f16 GPU feature; without it the
     q4f32 build of the same model is used. */
  const MODELS = [
    { key: "llama1b", name: "Llama 3.2 · 1B", f16: "Llama-3.2-1B-Instruct-q4f16_1-MLC", f32: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
      size: "≈ 0,7 GB", note: "el más ligero; conversación sencilla" },
    { key: "qwen15", name: "Qwen 2.5 · 1,5B", f16: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", f32: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
      size: "≈ 1 GB", note: "entiende y conversa mejor; en móviles con 4 GB puede no caber" },
    { key: "qwen3b", name: "Qwen 2.5 · 3B", f16: "Qwen2.5-3B-Instruct-q4f16_1-MLC", f32: "Qwen2.5-3B-Instruct-q4f32_1-MLC",
      size: "≈ 1,8 GB", note: "el más natural; para el ordenador" },
  ];
  // keys from the first version of the chat
  const OLD_KEYS = { small: "llama1b", medium: "llama1b", large: "qwen3b" };
  if (OLD_KEYS[C.model]) C.model = OLD_KEYS[C.model];
  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|iPod|Android/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const recommended = mobile ? "qwen15" : "qwen3b";
  const modelByKey = (k) => MODELS.find((m) => m.key === k);

  /* Test seams: the page can be driven without a GPU by defining these before
     chat.js runs (see tests/). Production never sets them. */
  const probeGPU = window.__pasadoGPU || realProbeGPU;
  const createEngine = window.__pasadoEngine || (async (id, cfg, opts) => (await import("./vendor/web-llm.js")).CreateMLCEngine(id, cfg, opts));

  async function realProbeGPU() {
    if (!navigator.gpu) return { ok: false };
    try {
      const a = await navigator.gpu.requestAdapter();
      return a ? { ok: true, f16: a.features.has("shader-f16") } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  const llm = { state: "off", engine: null, id: null, progress: 0, phase: "", error: "" };
  let gpu = null; // probe result, filled lazily
  let busy = false; // a reply is being written

  /* ---------- out-of-memory guard ----------
     iOS gives a home-screen app a memory budget and, when a page goes over it,
     reloads the page without any error to catch. If that happens while the model
     is being moved to the GPU, the guard left in storage tells the next start,
     and the chat falls back to the guided tutor instead of crashing again. */
  const GUARD = "pasado.llmguard";
  const setGuard = (g) => { try { localStorage.setItem(GUARD, JSON.stringify(g)); } catch {} };
  const clearGuard = () => { try { localStorage.removeItem(GUARD); } catch {} };
  let crashNotice = null;
  try {
    const g = JSON.parse(localStorage.getItem(GUARD) || "null");
    clearGuard();
    if (g && g.phase === "gpu" && Date.now() - g.t < 10 * 60000) {
      C.crash[g.id] = true;
      crashNotice = g.id;
      save();
    }
  } catch {}

  /* ---------- model loading ---------- */

  async function loadModel(key) {
    const m = modelByKey(key);
    if (!m || llm.state === "loading") return;
    gpu = gpu || (await probeGPU());
    if (!gpu.ok) {
      llm.state = "nogpu";
      renderStatus();
      return;
    }
    const id = gpu.f16 ? m.f16 : m.f32;
    if (llm.engine && llm.id === id) return;
    if (llm.engine) {
      try { await llm.engine.unload(); } catch {}
      llm.engine = null;
    }
    Object.assign(llm, { state: "loading", id, progress: 0, phase: C.dl[id] ? "load" : "download", error: "" });
    renderStatus();
    setGuard({ id, phase: "download", t: Date.now() });
    try {
      const engine = await createEngine(
        id,
        {
          initProgressCallback: (r) => {
            llm.progress = r.progress || 0;
            // "Fetching param cache…" while downloading, "Loading model from cache…" once on disk
            const toGPU = /loading/i.test(r.text || "") && !/fetch/i.test(r.text || "");
            if (toGPU && llm.phase !== "gpu") {
              llm.phase = "gpu";
              setGuard({ id, phase: "gpu", t: Date.now() });
            }
            renderStatus();
          },
        },
        // our prompts are short; a smaller context window means a smaller KV cache
        { context_window_size: 2048 }
      );
      // one token of warm-up: a model that downloads fine but doesn't fit in
      // memory fails here, still under the guard
      setGuard({ id, phase: "gpu", t: Date.now() });
      await engine.chat.completions.create({ messages: [{ role: "user", content: "Hola" }], max_tokens: 1 });
      clearGuard();
      Object.assign(llm, { state: "ready", engine });
      C.dl[id] = true;
      delete C.crash[id];
      save();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      clearGuard();
      Object.assign(llm, { state: "error", engine: null, error: describeError(e) });
    }
    renderStatus();
    renderMeta();
  }

  function describeError(e) {
    const s = String((e && e.message) || e);
    if (/fetch|network|Failed to fetch|NetworkError/i.test(s)) return "No se pudo descargar el modelo. Comprueba la conexión y vuelve a intentarlo.";
    if (/memory|OOM|allocation|too large|maxBufferSize|maxStorageBufferBindingSize/i.test(s)) return "El modelo no cabe en la memoria de este dispositivo. Prueba uno más pequeño.";
    if (/shader-f16|feature/i.test(s)) return "La GPU de este dispositivo no admite este modelo.";
    if (/quota|storage/i.test(s)) return "No hay espacio suficiente para guardar el modelo.";
    return "No se pudo cargar el modelo (" + s.slice(0, 120) + ").";
  }

  /* ---------- storage ----------
     WebLLM keeps each model's files in the browser's Cache Storage, which on
     an iPhone lives in the app's own data and counts against the phone's
     storage. What is on disk is read from the caches themselves, not from our
     own bookkeeping, so models this app no longer offers (or downloads that
     never finished) show up too and can be deleted. */
  const MODEL_URL = /\/mlc-ai\/([^/]+)\/resolve\//;
  const isModelCache = (name) => name.startsWith("webllm");

  async function storedModels() {
    const found = new Map(); // model id -> bytes
    if (!window.caches) return found;
    for (const name of await caches.keys()) {
      if (!isModelCache(name)) continue;
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const m = req.url.match(MODEL_URL);
        if (!m) continue;
        const res = await cache.match(req); // headers only; the body is not read
        const len = Number(res && res.headers.get("content-length")) || 0;
        found.set(m[1], (found.get(m[1]) || 0) + len);
      }
    }
    return found;
  }

  async function unloadIf(ids) {
    if (llm.engine && ids.includes(llm.id)) {
      try { await llm.engine.unload(); } catch {}
      Object.assign(llm, { state: "off", engine: null, id: null });
    }
  }

  // the selected model would download again on the next visit; fall back to the guided tutor
  function forgetChoiceIfGone() {
    const m = modelByKey(C.model);
    if (m && !C.dl[m.f16] && !C.dl[m.f32]) C.model = "none";
  }

  async function deleteModelId(id) {
    await unloadIf([id]);
    try {
      const webllm = await import("./vendor/web-llm.js");
      await webllm.deleteModelAllInfoInCache(id); // weights, config and its compiled library
    } catch {}
    // and anything left under that model's address, also for models this app no longer lists
    if (window.caches)
      for (const name of await caches.keys()) {
        if (!isModelCache(name)) continue;
        const cache = await caches.open(name);
        for (const req of await cache.keys()) if (req.url.includes(`/mlc-ai/${id}/`)) await cache.delete(req);
      }
    delete C.dl[id];
    forgetChoiceIfGone();
    save();
  }

  async function deleteAllModels() {
    await unloadIf([llm.id]);
    if (window.caches) for (const name of await caches.keys()) if (isModelCache(name)) await caches.delete(name);
    C.dl = {};
    forgetChoiceIfGone();
    save();
  }

  const fmtBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1).replace(".", ",") + " GB" : Math.max(1, Math.round(b / 1e6)) + " MB");
  function modelLabel(id) {
    const m = MODELS.find((x) => x.f16 === id || x.f32 === id);
    if (m) return { name: m.name, gone: false };
    return { name: id.replace(/-Instruct.*|-q\d.*$/, "").replace(/-/g, " "), gone: true };
  }

  async function renderStorage() {
    const box = $("chatStorage");
    if (!box) return;
    const [models, est] = await Promise.all([
      storedModels().catch(() => new Map()),
      navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().catch(() => null) : null,
    ]);
    // the browser's own estimate can lag (or round down) on iOS: never show less than the models add up to
    const used = Math.max((est && est.usage) || 0, [...models.values()].reduce((a, b) => a + b, 0));
    const total = used ? `La app ocupa ${fmtBytes(used)} en este dispositivo.` : "";
    if (!models.size) {
      box.innerHTML = `<p class="why">${total} No hay ningún modelo de IA descargado.</p>`;
      return;
    }
    const rows = [...models]
      .map(([id, bytes]) => {
        const { name, gone } = modelLabel(id);
        const tags = [bytes ? fmtBytes(bytes) : "", llm.id === id && llm.engine ? "en uso" : "", gone ? "ya no se usa" : ""].filter(Boolean).join(" · ");
        return `<div class="store-row"><span><b>${esc(name)}</b><br><span class="faint">${tags}</span></span><button class="quiet" data-del="${esc(id)}">borrar</button></div>`;
      })
      .join("");
    box.innerHTML = `<p class="why">${total} Casi todo son los modelos de IA; se pueden volver a descargar cuando quieras.</p>${rows}
      <div class="row"><button class="quiet" id="chatStoreAll">borrar todos los modelos</button></div>`;
    box.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const { name } = modelLabel(b.dataset.del);
        if (!confirm(`¿Borrar ${name} de este dispositivo?`)) return;
        b.disabled = true;
        b.textContent = "borrando…";
        await deleteModelId(b.dataset.del);
        afterDelete();
      })
    );
    $("chatStoreAll").addEventListener("click", async (e) => {
      if (!confirm("¿Borrar todos los modelos de IA de este dispositivo?")) return;
      e.target.disabled = true;
      e.target.textContent = "borrando…";
      await deleteAllModels();
      afterDelete();
    });
  }

  function afterDelete() {
    renderSettings();
    renderStatus();
    renderMeta();
  }

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

  /* Small models follow examples far better than rules. So the prompt is a
     short instruction plus worked examples in a fixed format — the question
     Lucía asked, her answer, the form to work in, the tense to ask in — and the
     model sees only the current exchange in that same format. No persona to
     act out, no history to get lost in, no example question to copy. The
     examples cover the cases that went wrong: a phrase that reads alarming out
     of context («tirarme en paracaídas»), an answer without a verb, a recast. */
  const SYSTEM =
    "Eres Lucía, una amiga española que charla por chat con una chica que está aprendiendo español. " +
    "Contestas en español de España con una reacción corta y cariñosa a lo que ella dice y después una pregunta sobre eso mismo. " +
    "Como mucho dos frases.";
  const TENSE_WORD = { pret: "indefinido", imp: "imperfecto", perf: "perfecto", plusc: "pluscuamperfecto", subj: "imperfecto de subjuntivo" };
  const turnText = (q, a, use, t) =>
    `Lucía preguntó: ${q}\nElla respondió: ${a}\n${use ? `Usa la forma «${use}».\n` : ""}Tu pregunta, en ${TENSE_WORD[t]}.`;
  const SHOTS = [
    ["¿Qué hiciste el fin de semana pasado?", "Fui a la playa con mis primas.", null, "pret",
      "¡Qué envidia! ¿A qué playa fuisteis?"],
    ["¿Cómo era tu vida cuando eras pequeña?", "Vivía en un pueblo y jugaba mucho en la calle.", null, "imp",
      "¡Qué bonito! ¿A qué jugabas con tus amigos?"],
    ["¿Hay algo que siempre has querido hacer y todavía no has hecho?", "Siempre quise tirarme en paracaídas.", null, "perf",
      "¡Qué valiente! Yo no me atrevería. ¿Por qué no lo has hecho todavía?"],
    ["¿Qué tal ayer?", "Ayer andé por el centro con mi novio.", "anduviste", "pret",
      "¡Qué plan más bonito! ¿Por dónde anduviste?"],
    ["¿Qué hacías en verano cuando eras niña?", "Hice castillos de arena en la playa.", "hacías", "imp",
      "¡Qué bonito! Yo también hacía castillos de arena. ¿Con quién ibas a la playa?"],
    ["¿Qué querían tus padres que fueras de mayor?", "Mi madre quería que soy médica.", "fueras", "imp",
      "Así que tu madre quería que fueras médica. ¿Y a ti te gustaba la idea?"],
    ["¿Qué has hecho hoy?", "Trabajar y luego gimnasio.", null, "perf",
      "¡Qué día más completo! ¿Has entrenado mucho en el gimnasio?"],
    ["Cuando cumpliste dieciocho años, ¿qué cosas ya habías hecho?", "Ya había viajado sola a Londres.", null, "plusc",
      "¡Qué independiente! ¿Y ya habías estado fuera de España antes de eso?"],
  ];

  // the last question Lucía asked, to frame her answer
  function lastQuestion() {
    for (let i = C.msgs.length - 2; i >= 0; i--)
      if (C.msgs[i].r === "t") {
        const qs = C.msgs[i].x.match(/[^.!?…]*¿[^?]*\?/g);
        return qs ? qs[qs.length - 1].trim() : C.msgs[i].x;
      }
    return "¡Hola!";
  }

  const ENGLISH = /\b(the|and|you|what|did|was|were|is|are|my|your|with|that|this)\b/gi;
  const NOT_SPANISH = /[぀-ヿ㐀-鿿Ѐ-ӿ]/;
  // a small model's safety training can misfire on harmless phrases; never show that
  const REFUSAL = /(no puedo (continuar|ayudar|seguir|responder|hablar)|lo siento, pero|como (modelo|asistente|ia)|soy (una|un) (ia|modelo|asistente)|no te preocupes, eres|si estás pensando en hacerte daño|línea de ayuda|teléfono de la esperanza)/i;
  const normQ = (x) => Analyzer.strip(x.toLowerCase()).replace(/[^a-zñ ]/g, "").trim();

  function cleanReply(raw, plan) {
    let s = (raw || "")
      .split("\n")[0]
      .replace(/\[[^\]]*\]?/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/[*_#`"]/g, "")
      .replace(/^\s*(lucía|tutor|asistente)\s*:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    s = s.split(/\s(?:Ella|Lucía preguntó|Usa la forma|Tu pregunta)\b/i)[0].trim();
    if (!s || NOT_SPANISH.test(s) || REFUSAL.test(s) || (s.match(ENGLISH) || []).length >= 3) return null;

    let sentences = (s.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [s]).map((x) => x.trim()).filter(Boolean);
    if (plan.switched) {
      // the topic change is ours: keep her comment, drop any question, then ask the opener
      sentences = sentences.filter((x) => !x.endsWith("?")).slice(0, 2);
      if (!sentences.length) sentences = [pick(ACKS)];
      return Analyzer.repair([...sentences, "Oye, cambiando de tema:", plan.prepared].join(" "));
    }
    sentences = sentences.slice(0, 3);
    const lastQ = sentences.map((x) => x.endsWith("?")).lastIndexOf(true);
    if (lastQ >= 0) sentences = sentences.slice(0, lastQ + 1);
    else sentences.push(pick(FOLLOW_UP[plan.tense]));
    // asking again what was just asked means it didn't understand her answer
    const asked = new Set(C.msgs.filter((m) => m.r === "t").slice(-3).flatMap((m) => (m.x.match(/¿[^?]*\?/g) || []).map(normQ)));
    const q = sentences[sentences.length - 1];
    if (asked.has(normQ((q.match(/¿[^?]*\?/) || [q])[0]))) return null;
    // a small model can slip too: fix the forms the engine knows are wrong
    return Analyzer.repair(sentences.join(" "));
  }

  async function llmReply(an, plan, onText) {
    const f = recastable(an);
    const use = f && f.kind !== "accent" ? echoForm(f) : null;
    const messages = [{ role: "system", content: SYSTEM }];
    for (const [q, a, u, t, reply] of SHOTS) {
      messages.push({ role: "user", content: turnText(q, a, u, t) });
      messages.push({ role: "assistant", content: reply });
    }
    // the subjunctive comes from the topic's own questions («¿Qué querían que…?»);
    // a follow-up in the imperfect is the natural way to keep that thread going
    const tense = plan.tense === "subj" ? "imp" : plan.tense;
    messages.push({ role: "user", content: turnText(lastQuestion(), C.msgs[C.msgs.length - 1].x, use, tense) });
    // one retry, cooler, before giving the turn to the guided tutor
    for (const temperature of [0.6, 0.3]) {
      const timer = setTimeout(() => { try { llm.engine.interruptGenerate(); } catch {} }, 45000);
      try {
        const stream = await llm.engine.chat.completions.create({
          messages,
          stream: true,
          temperature,
          top_p: 0.9,
          max_tokens: 70,
          stop: ["\n"],
        });
        let out = "";
        for await (const chunk of stream) {
          out += (chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) || "";
          // don't stream a refusal onto the screen before it's filtered out
          if (!REFUSAL.test(out)) onText(out.split("\n")[0]);
        }
        const reply = cleanReply(out, plan);
        if (reply) return reply;
        console.warn("pasado: unusable model reply", out);
      } catch (e) {
        console.warn("pasado: model error", e);
        // the GPU can be lost while the app sits in the background; reload next time
        if (/lost|disposed|destroyed|device/i.test(String(e && e.message))) Object.assign(llm, { state: "off", engine: null });
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

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
    const an = analyzeReply(text, lastQuestion());
    learnFrom(an);
    appendUser(text, an);

    const plan = planTurn(an);
    save();
    const bubble = appendTutor("", true);
    let reply = null;
    if (llm.state === "off" && C.model && modelByKey(C.model) && !isCrashed(C.model)) loadModel(C.model);
    if (llm.state === "ready") {
      reply = await llmReply(an, plan, (t) => {
        bubble.querySelector(".txt").textContent = t;
        bubble.classList.remove("typing");
        keepInView();
      });
    } else {
      await new Promise((r) => setTimeout(r, 450 + Math.random() * 400)); // a beat, so it reads as a reply
    }
    if (!reply) reply = guidedReply(an, plan);
    finishTutor(bubble, reply);
    pushMsg("t", reply);
    renderTopic();
    renderMeta();
    busy = false;
    speak(reply);
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
    for (const f of sure) {
      const t = f.t === "part" ? "perf" : f.t;
      if (TENSES.includes(t)) C.err[t] = (C.err[t] || 0) + 1;
      let keys = SENTENCES.map((s, i) => (s.v === f.v && s.t === t ? i : -1)).filter((i) => i >= 0);
      if (!keys.length) keys = SENTENCES.map((s, i) => (s.v === f.v ? i : -1)).filter((i) => i >= 0);
      for (const i of keys.slice(0, 3)) {
        const rec = S.esc[i] || (S.esc[i] = { box: 0, due: 0 });
        rec.due = Math.min(rec.due, now());
      }
    }
    // mistakes fade: a tense used well slowly stops being pushed
    for (const u of an.uses) if (C.err[u.t] && !sure.some((f) => f.t === u.t)) C.err[u.t] = Math.max(0, C.err[u.t] - 0.25);
  }

  /* ---------- rendering ---------- */

  const log = () => $("chatLog");

  function keepInView() {
    const el = log().lastElementChild;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: "end", behavior: "smooth" }));
  }

  // her message, with the past forms underlined and the slips marked
  function markup(text, an) {
    const marks = [
      ...an.findings.map((f) => ({ s: f.start, e: f.end, cls: f.sure ? "fx" : "fx soft" })),
      ...an.uses.filter((u) => !u.fixed).map((u) => ({ s: u.start, e: u.end, cls: "pv", title: TENSE_SHORT[u.t] })),
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
      .join("");
    const tenses = an.tenses.map((t) => TENSE_SHORT[t]).join(" · ");
    const used = tenses ? `<span class="used">${tenses}</span>` : "";
    if (!fixes) return `<div class="notes">${used}</div>`;
    return C.showFix
      ? `<div class="notes">${fixes}${used}</div>`
      : `<div class="notes"><button class="dot" aria-label="ver correcciones">•</button><div class="more" hidden>${fixes}</div>${used}</div>`;
  }

  function appendUser(text, an) {
    const el = document.createElement("div");
    el.className = "msg u";
    el.innerHTML = `<p class="txt">${markup(text, an)}</p>${annotations(an)}`;
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
      if (m.r === "u") appendUser(m.x, analyzeReply(m.x, q));
      else {
        appendTutor(m.x);
        const qs = m.x.match(/¿[^?]*\?/g);
        q = qs ? qs[qs.length - 1] : m.x;
      }
    }
  }

  function renderWelcome() {
    const m = modelByKey(recommended);
    const el = document.createElement("div");
    el.className = "card welcome";
    el.innerHTML = `
      <p class="sentence">Charla en pasado.</p>
      <p class="why">Lucía te pregunta por tu vida —ayer, tu infancia, tus viajes— y tú contestas en pasado.
      Si se te escapa una forma, ella la usa bien en su respuesta y debajo de tu mensaje queda una nota discreta.</p>
      <p class="why">La IA funciona dentro de tu dispositivo: es gratis y nada sale de él. Se descarga una vez
      (${m.name}, ${m.size}, mejor con wifi).</p>
      <div class="row"><button id="welcomeLLM">descargar y empezar</button><button id="welcomeGuided" class="quiet">empezar sin IA</button></div>
      <p class="why" id="welcomeGPU"></p>`;
    log().appendChild(el);
    $("welcomeLLM").addEventListener("click", () => start(recommended));
    $("welcomeGuided").addEventListener("click", () => start("none"));
    (gpu ? Promise.resolve(gpu) : probeGPU()).then((g) => {
      gpu = g;
      if (!g.ok) {
        $("welcomeLLM").hidden = true;
        $("welcomeGuided").textContent = "empezar";
        $("welcomeGuided").className = "";
        $("welcomeGPU").textContent = "Este navegador no puede ejecutar la IA (hace falta iOS 26 o un navegador de ordenador reciente con WebGPU). Charlarás con el tutor guiado, que corrige igual.";
      }
    });
  }

  function start(model) {
    C.model = model;
    save();
    newConversation();
    if (model !== "none") loadModel(model);
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
    if (m && llm.state === "ready") who = m.name;
    else if (m && llm.state === "loading") who = m.name + " (cargando)";
    const st = C.stats;
    const n = (x, one, many) => `${Math.round(x)} ${Math.round(x) === 1 ? one : many}`;
    $("chatMeta").textContent = C.model === null ? "" :
      `${who} · ${n(st.msgs, "mensaje", "mensajes")} · ${n(st.past, "verbo", "verbos")} en pasado · ${n(st.fixes, "corrección", "correcciones")}`;
  }

  function renderStatus() {
    const el = $("chatStatus");
    let html = "";
    if (llm.state === "loading") {
      const pct = Math.round(llm.progress * 100);
      const what = llm.phase === "download" ? "Descargando la IA" : "Preparando la IA";
      html = `<p>${what}… ${pct} %</p><div class="bar"><span style="width:${pct}%"></span></div>
        <p class="why">${llm.phase === "download" ? "Solo la primera vez. Mientras tanto puedes ir charlando con el tutor guiado." : "Un momento."}</p>`;
    } else if (llm.state === "error") {
      html = `<p>${esc(llm.error)}</p><div class="row"><button data-act="retry">reintentar</button><button data-act="settings" class="quiet">ajustes</button></div>`;
    } else if (llm.state === "nogpu" && C.model && C.model !== "none") {
      html = `<p>Este navegador no puede ejecutar la IA (hace falta WebGPU: iOS 26 o un navegador de ordenador reciente). Sigues con el tutor guiado, que corrige igual.</p>`;
    } else if (crashNotice) {
      const m = MODELS.find((x) => x.f16 === crashNotice || x.f32 === crashNotice);
      const smaller = m && MODELS[MODELS.indexOf(m) - 1];
      html = `<p>La última vez la IA${m ? " (" + m.name + ")" : ""} no cupo en la memoria de este dispositivo y la app se reinició. Sigues con el tutor guiado.</p>
        <div class="row">${smaller ? `<button data-act="smaller" data-key="${smaller.key}">probar ${smaller.name}</button>` : ""}<button data-act="retry-crash" class="quiet">volver a intentarlo</button></div>
        <p class="why">En el ordenador funciona sin problemas: abre la misma dirección en Chrome, Edge o Safari.</p>`;
    }
    el.innerHTML = html;
    el.hidden = !html;
    renderMeta();
  }

  $("chatStatus").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "retry") loadModel(C.model);
    if (b.dataset.act === "settings") toggleSettings(true);
    if (b.dataset.act === "smaller") {
      crashNotice = null;
      C.model = b.dataset.key;
      save();
      renderSettings();
      loadModel(C.model);
    }
    if (b.dataset.act === "retry-crash") {
      for (const m of MODELS) if (m.key === C.model) { delete C.crash[m.f16]; delete C.crash[m.f32]; }
      crashNotice = null;
      save();
      loadModel(C.model);
    }
  });

  const isCrashed = (key) => {
    const m = modelByKey(key);
    return !!(m && (C.crash[m.f16] || C.crash[m.f32]));
  };

  /* ---------- settings ---------- */

  function renderSettings() {
    const el = $("chatSettings");
    const opts = MODELS.map((m) => {
      const here = C.dl[m.f16] || C.dl[m.f32];
      const tag = isCrashed(m.key) ? " · no cupo en memoria" : here ? " · descargado" : "";
      return `<label class="opt"><input type="radio" name="chatModel" value="${m.key}"${C.model === m.key ? " checked" : ""}>
        <span><b>${m.name}</b> <span class="faint">${m.size}${tag}</span><br><span class="faint">${m.note}${m.key === recommended ? " · recomendado aquí" : ""}</span></span></label>`;
    }).join("");
    el.innerHTML = `
      <h3>IA</h3>
      <p class="why">Funciona dentro del dispositivo: gratis y sin enviar nada. Se descarga una vez.</p>
      ${opts}
      <label class="opt"><input type="radio" name="chatModel" value="none"${C.model === "none" ? " checked" : ""}>
        <span><b>Sin IA</b><br><span class="faint">tutor guiado con preguntas preparadas; corrige igual</span></span></label>
      <div class="row"><button id="chatModelGo">usar</button></div>
      <h3>Espacio</h3>
      <div id="chatStorage"><p class="why">Calculando…</p></div>
      <h3>Opciones</h3>
      <label class="opt"><input type="checkbox" id="optFix"${C.showFix ? " checked" : ""}><span>Mostrar las correcciones bajo cada mensaje<br><span class="faint">si no, solo un punto que se abre al tocarlo</span></span></label>
      <label class="opt"><input type="checkbox" id="optVoice"${C.voice ? " checked" : ""}${window.speechSynthesis ? "" : " disabled"}><span>Leer en voz alta las respuestas de Lucía</span></label>
      <div class="row"><button id="chatReset" class="quiet">empezar conversación nueva</button></div>
      <p class="why">Para dictar, usa el micrófono del teclado del iPhone.</p>`;
    $("chatModelGo").addEventListener("click", () => {
      const v = (el.querySelector('input[name="chatModel"]:checked') || {}).value;
      if (!v) return;
      const first = C.model === null;
      C.model = v;
      save();
      if (first) newConversation();
      if (v === "none") {
        if (llm.engine) llm.engine.unload().catch(() => {});
        Object.assign(llm, { state: "off", engine: null, id: null });
      } else {
        for (const m of MODELS) if (m.key === v) { delete C.crash[m.f16]; delete C.crash[m.f32]; }
        crashNotice = null;
        loadModel(v);
      }
      toggleSettings(false);
      renderStatus();
    });
    renderStorage();
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
  $("chatInput").addEventListener("input", autosize);
  $("chatInput").addEventListener("keydown", (e) => {
    // Enter sends (the iPhone keyboard shows «enviar»); Shift+Enter is a new line
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $("chatTopicBtn").addEventListener("click", changeTopic);
  $("chatSettingsBtn").addEventListener("click", () => toggleSettings());

  // corrections open their explanation on tap; the dot reveals hidden corrections
  log().addEventListener("click", (e) => {
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
    if (C.model && modelByKey(C.model) && llm.state === "off" && !isCrashed(C.model) && !crashNotice) loadModel(C.model);
  }

  // the tense chips changed: steer away from a topic whose tense was switched off
  function onTenses() {
    const topic = C.topic && topicById(C.topic.id);
    if (topic && !S.tsel[topic.t] && shown && C.model !== null && !busy) changeTopic();
  }

  return { onShow, onTenses, MODELS };
})();

if (activeTab === "chat") Chat.onShow();
