/* Pasado — Gemini for «Charlar»: Google's hosted model behind the same small
   OpenAI-style interface (chat.completions.create with role/content
   messages). It takes a JSON schema (response_format), which the chat uses
   to get corrections and the reply back together in one request.

   The key is her own free key from Google AI Studio. The app is a static page
   with no server of its own, so the key is kept only in this device's storage
   (apart from the progress, so it never travels with it) and the requests go
   straight from the browser to Google. */

const Gemini = (() => {
  const API = "https://generativelanguage.googleapis.com/v1beta/models/";
  const STORE = "pasado.gemini";
  const KEY_PAGE = "https://aistudio.google.com/apikey";

  const getKey = () => { try { return localStorage.getItem(STORE) || ""; } catch { return ""; } };
  const setKey = (k) => {
    try { k ? localStorage.setItem(STORE, k.trim()) : localStorage.removeItem(STORE); } catch {}
  };

  function apiError(status, body) {
    const e = new Error((body && body.message) || "HTTP " + status);
    e.gemini = true;
    e.status = status;
    e.reason = (((body && body.details) || []).find((d) => d.reason) || {}).reason || (body && body.status) || "";
    return e;
  }

  // OpenAI-style messages -> Gemini's systemInstruction + contents. The turns
  // have to start with her and alternate, so neighbours with one role are merged.
  function toGemini(messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      const role = m.role === "assistant" ? "model" : "user";
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts[0].text += "\n" + m.content;
      else contents.push({ role, parts: [{ text: m.content }] });
    }
    if (contents.length && contents[0].role === "model") contents.unshift({ role: "user", parts: [{ text: "Hola." }] });
    return { system, contents };
  }

  // Replies are a sentence or two, so thinking only adds waiting. A model that
  // can't switch it off rejects the setting; from then on it is left out.
  let noThinking = true;
  // likewise a schema the API won't take: JSON is still asked for, and the
  // prompt names the fields
  let useSchema = true;

  async function request(model, key, opts, signal) {
    const { system, contents } = toGemini(opts.messages);
    const body = {
      contents,
      generationConfig: {
        temperature: opts.temperature,
        topP: opts.top_p,
        // thinking, where a model does it anyway, counts against this limit, so
        // it is generous: the reply itself is a sentence or two
        maxOutputTokens: 2048,
        stopSequences: opts.stop,
        ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    };
    const schema = opts.response_format && opts.response_format.schema;
    if (schema) Object.assign(body.generationConfig, { responseMimeType: "application/json" }, useSchema ? { responseSchema: schema } : {});
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const url = API + encodeURIComponent(model) + ":generateContent";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return res;
    let err = null;
    try { err = (await res.json()).error; } catch {}
    if (res.status === 400 && noThinking && /thinking/i.test((err && err.message) || "")) {
      noThinking = false;
      return request(model, key, opts, signal);
    }
    if (res.status === 400 && schema && useSchema && /schema|propertyOrdering|Invalid JSON payload/i.test((err && err.message) || "")) {
      useSchema = false;
      return request(model, key, opts, signal);
    }
    throw apiError(res.status, err);
  }

  // the answer's text, without any thought summaries; a blocked answer has none
  const textOf = (data) => {
    const c = data && data.candidates && data.candidates[0];
    return ((c && c.content && c.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  };

  function engine(model, key) {
    let ctrl = null;
    return {
      chat: {
        completions: {
          async create(opts) {
            ctrl = new AbortController();
            const res = await request(model, key, opts, ctrl.signal);
            const data = await res.json();
            const c = data.candidates && data.candidates[0];
            return {
              choices: [{ message: { content: textOf(data) }, finish_reason: (c && c.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || "" }],
            };
          },
        },
      },
      interruptGenerate() { if (ctrl) ctrl.abort(); },
    };
  }

  // what went wrong, in words she can act on; null when it isn't Gemini's doing
  function describe(e) {
    if (!e || !e.gemini) {
      if (e && /fetch|network|load failed/i.test(String(e.message || e))) return "No hay conexión con Gemini. Comprueba internet y vuelve a intentarlo.";
      return null;
    }
    const msg = e.message || "";
    if (e.reason === "API_KEY_INVALID" || /api key/i.test(msg)) return "Google no acepta esa clave de Gemini. Cópiala de nuevo de AI Studio en ajustes.";
    if (/location|region|country/i.test(msg)) return "Gemini no está disponible gratis desde aquí (país o región).";
    if (e.status === 403) return "Esa clave no tiene permiso para usar Gemini. Crea otra en AI Studio.";
    if (e.status === 404) return "Google ya no ofrece ese modelo de Gemini. Elige otro en ajustes.";
    if (e.status === 429) return "Se ha agotado por ahora el uso gratuito de Gemini. Prueba más tarde, o cambia a Flash-Lite en ajustes.";
    if (e.status >= 500) return "Gemini no responde ahora mismo. Vuelve a intentarlo en un rato.";
    return "Gemini no ha podido contestar (" + msg.slice(0, 120) + ").";
  }

  return { getKey, setKey, engine, describe, KEY_PAGE };
})();
