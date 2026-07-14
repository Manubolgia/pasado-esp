// Verb database and sentence bank for the Spanish past-tense trainer.
// Conjugation metadata:
//   strong: irregular preterite stem (unstressed endings: -e -iste -o -imos -isteis -ieron; j-stems take -eron)
//   pret:   full preterite override table
//   imp:    full imperfect override table
//   stem3:  replacement stem for 3rd persons of the preterite (e>i / o>u -ir verbs)
//   y:      vowel-stem -er/-ir verb (leer type): -í -íste -yó -ímos -ísteis -yeron
//   uir:    -uir verb (construir type): -í -iste -yó -imos -isteis -yeron
//   drill:  false = excluded from the conjugation drill (used only in sentences)

const PERSONS = ["yo", "tú", "él/ella", "nosotros", "vosotros", "ellos/ellas"];

const VERBS = [
  { inf: "ser",       en: "to be",            pret: ["fui","fuiste","fue","fuimos","fuisteis","fueron"],
                                              imp:  ["era","eras","era","éramos","erais","eran"] },
  { inf: "ir",        en: "to go",            pret: ["fui","fuiste","fue","fuimos","fuisteis","fueron"],
                                              imp:  ["iba","ibas","iba","íbamos","ibais","iban"] },
  { inf: "estar",     en: "to be (state)",    strong: "estuv" },
  { inf: "tener",     en: "to have",          strong: "tuv" },
  { inf: "hacer",     en: "to do, make",      strong: "hic",
                      pret3: "hizo" },
  { inf: "poder",     en: "to be able",       strong: "pud" },
  { inf: "poner",     en: "to put",           strong: "pus" },
  { inf: "decir",     en: "to say",           strong: "dij" },
  { inf: "venir",     en: "to come",          strong: "vin" },
  { inf: "querer",    en: "to want",          strong: "quis" },
  { inf: "saber",     en: "to know (facts)",  strong: "sup" },
  { inf: "andar",     en: "to walk",          strong: "anduv" },
  { inf: "traer",     en: "to bring",         strong: "traj" },
  { inf: "conducir",  en: "to drive",         strong: "conduj" },
  { inf: "traducir",  en: "to translate",     strong: "traduj" },
  { inf: "dar",       en: "to give",          pret: ["di","diste","dio","dimos","disteis","dieron"] },
  { inf: "ver",       en: "to see",           pret: ["vi","viste","vio","vimos","visteis","vieron"],
                                              imp:  ["veía","veías","veía","veíamos","veíais","veían"] },
  { inf: "haber",     en: "there is/was",     strong: "hub", drill: false },

  { inf: "dormir",    en: "to sleep",         stem3: "durm" },
  { inf: "morir",     en: "to die",           stem3: "mur" },
  { inf: "pedir",     en: "to ask for",       stem3: "pid" },
  { inf: "sentir",    en: "to feel",          stem3: "sint" },
  { inf: "preferir",  en: "to prefer",        stem3: "prefir" },
  { inf: "repetir",   en: "to repeat",        stem3: "repit" },
  { inf: "servir",    en: "to serve",         stem3: "sirv" },
  { inf: "seguir",    en: "to follow",        stem3: "sigu" },

  { inf: "leer",      en: "to read",          y: true },
  { inf: "creer",     en: "to believe",       y: true },
  { inf: "caer",      en: "to fall",          y: true },
  { inf: "oír",       en: "to hear",          y: true },
  { inf: "construir", en: "to build",         uir: true },

  { inf: "buscar",    en: "to look for" },
  { inf: "tocar",     en: "to play, touch" },
  { inf: "llegar",    en: "to arrive" },
  { inf: "pagar",     en: "to pay" },
  { inf: "jugar",     en: "to play" },
  { inf: "empezar",   en: "to begin" },

  { inf: "hablar",    en: "to speak" },
  { inf: "trabajar",  en: "to work" },
  { inf: "estudiar",  en: "to study" },
  { inf: "comprar",   en: "to buy" },
  { inf: "comer",     en: "to eat" },
  { inf: "aprender",  en: "to learn" },
  { inf: "beber",     en: "to drink" },
  { inf: "correr",    en: "to run" },
  { inf: "volver",    en: "to return" },
  { inf: "vivir",     en: "to live" },
  { inf: "escribir",  en: "to write" },
  { inf: "abrir",     en: "to open" },
  { inf: "salir",     en: "to leave" },
  { inf: "conocer",   en: "to know (people)" },
];

const PRET_AR  = ["é","aste","ó","amos","asteis","aron"];
const PRET_ERIR = ["í","iste","ió","imos","isteis","ieron"];
const PRET_Y   = ["í","íste","yó","ímos","ísteis","yeron"];
const PRET_UIR = ["í","iste","yó","imos","isteis","yeron"];
const PRET_STRONG = ["e","iste","o","imos","isteis","ieron"];
const IMP_AR   = ["aba","abas","aba","ábamos","abais","aban"];
const IMP_ERIR = ["ía","ías","ía","íamos","íais","ían"];

function conjugate(v, tense, p) {
  if (tense === "imp") {
    if (v.imp) return v.imp[p];
    const ar = v.inf.endsWith("ar");
    return v.inf.slice(0, -2) + (ar ? IMP_AR : IMP_ERIR)[p];
  }
  // preterite
  if (v.pret) return v.pret[p];
  if (v.strong) {
    if (p === 2 && v.pret3) return v.pret3;
    let end = PRET_STRONG[p];
    if (v.strong.endsWith("j") && p === 5) end = "eron";
    return v.strong + end;
  }
  let stem = v.inf.slice(0, -2);
  const ar = v.inf.endsWith("ar");
  if (ar) {
    let end = PRET_AR[p];
    if (p === 0) {
      if (stem.endsWith("c")) { stem = stem.slice(0, -1) + "qu"; }
      else if (stem.endsWith("g")) { stem = stem + "u"; }
      else if (stem.endsWith("z")) { stem = stem.slice(0, -1) + "c"; }
    }
    return stem + end;
  }
  const ends = v.y ? PRET_Y : v.uir ? PRET_UIR : PRET_ERIR;
  if (v.stem3 && (p === 2 || p === 5)) stem = v.stem3;
  return stem + ends[p];
}

// Usage cues shown as explanations in the sentence mode.
const CUES = {
  completed:   { t: "pret", label: "Completed event",
                 why: "A single action seen as finished at a definite point — pretérito." },
  bounded:     { t: "pret", label: "Bounded period",
                 why: "The duration has clear limits (tres años, hasta las tres) — the whole block is over, so pretérito." },
  time:        { t: "pret", label: "Specific time",
                 why: "An action pinned to a clock time or date — pretérito." },
  series:      { t: "pret", label: "Series of events",
                 why: "One event after another moving the story forward — each is pretérito." },
  interrupter: { t: "pret", label: "Interrupting event",
                 why: "The action that breaks in on an ongoing background is pretérito; the background stays in imperfecto." },
  habitual:    { t: "imp", label: "Habitual action",
                 why: "Repeated or customary in the past (siempre, todos los días, antes, de niño) — imperfecto." },
  background:  { t: "imp", label: "Ongoing background",
                 why: "An action in progress when something else happened — imperfecto sets the scene." },
  description: { t: "imp", label: "Description / scene",
                 why: "Descriptions of people, places, weather or atmosphere in the past — imperfecto." },
  agetime:     { t: "imp", label: "Age, time, dates",
                 why: "Age and clock time in the past are almost always imperfecto (tenía 30 años, eran las diez)." },
  state:       { t: "imp", label: "Mental / physical state",
                 why: "Knowledge, beliefs, wants and abilities as ongoing states — imperfecto." },
  meaning:     { t: "pret", label: "Meaning-change verb",
                 why: "Saber, conocer, querer, poder change meaning in the pretérito: supe = found out, conocí = met, no quiso = refused, no pude = failed to." },
};

// Sentence bank. b/a = text before/after the blank, v = infinitive index into VERBS
// (looked up by name at load), p = person index, t = correct tense, c = cue key.
// hint: extra pronoun shown when the subject isn't explicit in the sentence.
const SENTENCES = [
  { b: "Ayer", a: "pan en el mercado.", v: "comprar", p: 0, t: "pret", c: "completed", hint: "yo" },
  { b: "Anoche", a: "una película muy rara.", v: "ver", p: 3, t: "pret", c: "completed", hint: "nosotros" },
  { b: "El verano pasado mis primos", a: "a Portugal.", v: "ir", p: 5, t: "pret", c: "completed" },
  { b: "La semana pasada", a: "un libro nuevo.", v: "empezar", p: 0, t: "pret", c: "completed", hint: "yo" },
  { b: "", a: "tres años en Madrid antes de mudarnos.", v: "vivir", p: 3, t: "pret", c: "bounded", hint: "nosotros" },
  { b: "Ayer", a: "que trabajar hasta muy tarde.", v: "tener", p: 0, t: "pret", c: "completed", hint: "yo" },
  { b: "De repente ella", a: "un ruido en la cocina.", v: "oír", p: 2, t: "pret", c: "interrupter" },
  { b: "Mi abuelo", a: "hace diez años.", v: "morir", p: 2, t: "pret", c: "completed" },
  { b: "Se levantó,", a: "café y salió corriendo.", v: "hacer", p: 2, t: "pret", c: "series", hint: "él" },
  { b: "El concierto", a: "a las nueve en punto.", v: "empezar", p: 2, t: "pret", c: "time" },
  { b: "", a: "a mi mejor amigo en 2015.", v: "conocer", p: 0, t: "pret", c: "meaning", hint: "yo" },
  { b: "Ayer por fin", a: "la verdad sobre el accidente.", v: "saber", p: 3, t: "pret", c: "meaning", hint: "nosotros" },
  { b: "El lunes le", a: "el regalo a mi madre.", v: "dar", p: 0, t: "pret", c: "completed", hint: "yo" },
  { b: "Anoche no", a: "dormir nada por el calor.", v: "poder", p: 0, t: "pret", c: "meaning", hint: "yo" },
  { b: "Mis amigos", a: "en la fiesta hasta las tres.", v: "estar", p: 5, t: "pret", c: "bounded" },
  { b: "Esta mañana", a: "las noticias en el tren.", v: "leer", p: 0, t: "pret", c: "completed", hint: "yo" },
  { b: "Ayer mi hermana", a: "a cenar a casa.", v: "venir", p: 2, t: "pret", c: "completed" },
  { b: "El año pasado ella", a: "su primera novela.", v: "escribir", p: 2, t: "pret", c: "bounded" },
  { b: "", a: "tarde a la reunión de ayer.", v: "llegar", p: 1, t: "pret", c: "completed", hint: "tú" },
  { b: "De pronto el niño se", a: "de la silla.", v: "caer", p: 2, t: "pret", c: "interrupter" },
  { b: "Los obreros", a: "esta casa en solo seis meses.", v: "construir", p: 5, t: "pret", c: "bounded" },
  { b: "El camarero nos", a: "la cuenta enseguida.", v: "traer", p: 2, t: "pret", c: "completed" },
  { b: "El domingo pasado", a: "diez kilómetros por el monte.", v: "andar", p: 3, t: "pret", c: "completed", hint: "nosotros" },
  { b: "Después de la discusión, le", a: "perdón.", v: "pedir", p: 5, t: "pret", c: "completed", hint: "ellos" },
  { b: "Le ofrecí ayuda, pero él no la", a: ".", v: "querer", p: 2, t: "pret", c: "meaning" },
  { b: "El tren", a: "a las ocho y media exactas.", v: "salir", p: 2, t: "pret", c: "time" },
  { b: "Ella", a: "diez horas la noche del viernes.", v: "dormir", p: 2, t: "pret", c: "bounded" },
  { b: "Estábamos cenando cuando", a: "mi tío.", v: "llegar", p: 2, t: "pret", c: "interrupter" },
  { b: "Mientras cocinaba, ella", a: "un grito en la calle.", v: "oír", p: 2, t: "pret", c: "interrupter" },
  { b: "Cuando", a: "del cine, ya era de noche.", v: "salir", p: 3, t: "pret", c: "completed", hint: "nosotros" },
  { b: "Primero", a: "la puerta y luego encendió la luz.", v: "abrir", p: 2, t: "pret", c: "series", hint: "ella" },
  { b: "Aquel día el equipo", a: "mejor que nunca.", v: "jugar", p: 2, t: "pret", c: "completed" },

  { b: "Cuando", a: "niño, jugaba al fútbol todos los días.", v: "ser", p: 0, t: "imp", c: "agetime", hint: "yo" },
  { b: "De niña, mi madre", a: "en un pueblo pequeño.", v: "vivir", p: 2, t: "imp", c: "habitual" },
  { b: "", a: "las diez de la noche cuando llegamos.", v: "ser", p: 5, t: "imp", c: "agetime" },
  { b: "Antes", a: "en una oficina; ahora trabajo desde casa.", v: "trabajar", p: 0, t: "imp", c: "habitual", hint: "yo" },
  { b: "Mi abuela siempre nos", a: "galletas los domingos.", v: "hacer", p: 2, t: "imp", c: "habitual" },
  { b: "El cielo", a: "gris y llovía sin parar.", v: "estar", p: 2, t: "imp", c: "description" },
  { b: "Cuando era estudiante,", a: "una novela por semana.", v: "leer", p: 0, t: "imp", c: "habitual", hint: "yo" },
  { b: "", a: "mucha gente en la plaza aquella noche.", v: "haber", p: 2, t: "imp", c: "description" },
  { b: "Mientras", a: ", alguien llamó a la puerta.", v: "dormir", p: 1, t: "imp", c: "background", hint: "tú" },
  { b: "Todos los veranos", a: "a la playa con mis primos.", v: "ir", p: 3, t: "imp", c: "habitual", hint: "nosotros" },
  { b: "Mi padre", a: "treinta años cuando nací.", v: "tener", p: 2, t: "imp", c: "agetime" },
  { b: "La casa de mis abuelos", a: "enorme y tenía un jardín precioso.", v: "ser", p: 2, t: "imp", c: "description" },
  { b: "De pequeño", a: "ser astronauta.", v: "querer", p: 0, t: "imp", c: "state", hint: "yo" },
  { b: "En aquella época no", a: "nada de la vida.", v: "saber", p: 3, t: "imp", c: "state", hint: "nosotros" },
  { b: "Cada mañana mi vecino", a: "por el parque.", v: "correr", p: 2, t: "imp", c: "habitual" },
  { b: "Ella", a: "medicina cuando la conocí.", v: "estudiar", p: 2, t: "imp", c: "background" },
  { b: "Los niños", a: "en el patio mientras los padres charlaban.", v: "jugar", p: 5, t: "imp", c: "background" },
  { b: "Antes la gente", a: "cartas a mano.", v: "escribir", p: 2, t: "imp", c: "habitual" },
  { b: "", a: "muy bien aquel barrio; había vivido allí.", v: "conocer", p: 0, t: "imp", c: "state", hint: "yo" },
  { b: "", a: "frío y el viento soplaba con fuerza.", v: "hacer", p: 2, t: "imp", c: "description" },
  { b: "De joven, mi padre", a: "correr un maratón sin entrenar.", v: "poder", p: 2, t: "imp", c: "state" },
  { b: "Antiguamente muchos", a: "que la Tierra era plana.", v: "creer", p: 5, t: "imp", c: "state" },
  { b: "Siempre que la veía, ella me", a: "el mismo favor.", v: "pedir", p: 2, t: "imp", c: "habitual" },
  { b: "Aquel restaurante", a: "el mejor pulpo de la ciudad.", v: "servir", p: 2, t: "imp", c: "description" },
  { b: "Yo", a: "la tele cuando se fue la luz.", v: "ver", p: 0, t: "imp", c: "background" },
  { b: "Mi hermano", a: "el piano cuando éramos pequeños.", v: "tocar", p: 2, t: "imp", c: "habitual" },
];

if (typeof module !== "undefined") {
  module.exports = { VERBS, PERSONS, SENTENCES, CUES, conjugate };
}
