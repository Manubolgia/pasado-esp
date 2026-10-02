/* Pasado — conversation material for the chat («Charlar»).
   Each topic steers towards one past tense: the opener and every follow-up are
   questions you can only answer naturally in that tense. The LLM uses them as
   examples of where to take the conversation; without a model they *are* the
   conversation. The learner is addressed as a woman (pequeña, cansada…). */

const TOPICS = [
  // ---------- indefinido: finished events ----------
  { id: "finde", t: "pret", title: "El fin de semana pasado",
    open: "Cuéntame, ¿qué hiciste el fin de semana pasado?",
    follow: ["¿Con quién estuviste?", "¿Qué fue lo mejor del finde?", "¿Comiste algo rico?", "¿A qué hora te acostaste el sábado?", "¿Pasó algo inesperado?"] },
  { id: "ayer", t: "pret", title: "Ayer",
    open: "¿Qué tal ayer? ¿Qué hiciste durante el día?",
    follow: ["¿A qué hora te levantaste?", "¿Qué comiste?", "¿Hablaste con alguien interesante?", "¿Qué hiciste por la noche?", "¿Te pasó algo gracioso?"] },
  { id: "viaje", t: "pret", title: "Tu último viaje",
    open: "Háblame de tu último viaje. ¿Adónde fuiste?",
    follow: ["¿Cómo fuiste, en avión, en tren, en coche?", "¿Qué visitaste?", "¿Qué fue lo que más te gustó?", "¿Probaste algún plato típico?", "¿Cuántos días te quedaste?"] },
  { id: "cumple", t: "pret", title: "Tu último cumpleaños",
    open: "¿Cómo celebraste tu último cumpleaños?",
    follow: ["¿Quién vino?", "¿Qué te regalaron?", "¿Soplaste las velas?", "¿Hasta qué hora duró la fiesta?", "¿Fue como esperabas?"] },
  { id: "conocer", t: "pret", title: "Cómo os conocisteis",
    open: "¿Cómo conociste a tu pareja? Me encantan esas historias.",
    follow: ["¿Dónde os visteis por primera vez?", "¿Quién habló primero?", "¿Qué pensaste de él al principio?", "¿Cuándo fue vuestra primera cita?", "¿Adónde fuisteis?"] },
  { id: "peli", t: "pret", title: "La última película o serie",
    open: "¿Cuál fue la última película o serie que viste?",
    follow: ["¿Dónde la viste?", "¿Te gustó el final?", "¿Quién te la recomendó?", "¿Qué personaje te cayó mejor?", "¿Lloraste o te reíste?"] },
  { id: "trabajo1", t: "pret", title: "Tu primer día de trabajo",
    open: "¿Te acuerdas de tu primer día en tu trabajo actual? ¿Qué pasó?",
    follow: ["¿Quién te recibió?", "¿Qué hiciste primero?", "¿Te perdiste por el edificio?", "¿Cómo volviste a casa ese día?", "¿Qué le contaste a tu familia?"] },
  { id: "desastre", t: "pret", title: "Un pequeño desastre",
    open: "Cuéntame algún pequeño desastre que te pasó alguna vez: algo que se rompió, un plan que salió mal…",
    follow: ["¿Qué pasó exactamente?", "¿Qué hiciste para arreglarlo?", "¿Alguien te ayudó?", "¿Cómo terminó la historia?", "¿Aprendiste algo?"] },

  // ---------- imperfecto: habits, descriptions, background ----------
  { id: "infancia", t: "imp", title: "Cuando eras pequeña",
    open: "¿Cómo era tu vida cuando eras pequeña?",
    follow: ["¿Dónde vivías?", "¿A qué jugabas con tus amigos?", "¿Cómo era tu habitación?", "¿Qué comías los domingos?", "¿Qué querías ser de mayor?"] },
  { id: "casa", t: "imp", title: "La casa de tu infancia",
    open: "Descríbeme la casa donde vivías de niña. ¿Cómo era?",
    follow: ["¿Tenía jardín o balcón?", "¿Qué se veía desde tu ventana?", "¿Compartías habitación con alguien?", "¿Cómo eran tus vecinos?", "¿Qué olor tenía la cocina?"] },
  { id: "veranos", t: "imp", title: "Los veranos de niña",
    open: "¿Qué hacías en verano cuando eras niña?",
    follow: ["¿Ibas a la playa o al pueblo?", "¿Con quién pasabas las vacaciones?", "¿A qué hora te acostabas?", "¿Qué comíais?", "¿Qué era lo que más te gustaba?"] },
  { id: "cole", t: "imp", title: "El colegio",
    open: "¿Cómo era tu colegio? ¿Te gustaba ir?",
    follow: ["¿Cuál era tu asignatura favorita?", "¿Cómo eran tus profesores?", "¿Cómo ibas al colegio?", "¿Qué hacías en el recreo?", "¿Eras buena estudiante?"] },
  { id: "amiga", t: "imp", title: "Tu mejor amiga de pequeña",
    open: "¿Quién era tu mejor amiga cuando eras pequeña? ¿Cómo era?",
    follow: ["¿Dónde vivía?", "¿Qué hacíais juntas?", "¿Os peleabais a veces?", "¿Qué tenía de especial?", "¿Os veíais todos los días?"] },
  { id: "abuelos", t: "imp", title: "Tus abuelos",
    open: "¿Cómo eran tus abuelos cuando eras pequeña?",
    follow: ["¿Dónde vivían?", "¿Qué cocinaba tu abuela?", "¿Qué te contaban?", "¿Cada cuánto los veías?", "¿Qué hacíais juntos?"] },
  { id: "antes", t: "imp", title: "Antes y ahora",
    open: "Piensa en hace diez años. ¿Cómo era tu vida entonces?",
    follow: ["¿Dónde vivías?", "¿A qué te dedicabas?", "¿Qué música escuchabas?", "¿Qué hacías los fines de semana?", "¿Qué te preocupaba en aquella época?"] },
  { id: "navidad", t: "imp", title: "Las Navidades de niña",
    open: "¿Cómo eran las Navidades en tu casa cuando eras pequeña?",
    follow: ["¿Quién venía a cenar?", "¿Qué se comía en Nochebuena?", "¿Creías en los Reyes Magos?", "¿Qué pedías en la carta?", "¿Qué tradiciones teníais?"] },

  // ---------- perfecto: today, this week, life experience ----------
  { id: "hoy", t: "perf", title: "Hoy",
    open: "¿Qué tal el día? ¿Qué has hecho hoy?",
    follow: ["¿Qué has comido?", "¿Has hablado con alguien de tu familia?", "¿Has hecho algo de deporte?", "¿Te ha pasado algo curioso?", "¿Has terminado todo lo que tenías que hacer?"] },
  { id: "semana", t: "perf", title: "Esta semana",
    open: "¿Cómo ha ido tu semana hasta ahora?",
    follow: ["¿Qué es lo mejor que te ha pasado?", "¿Has dormido bien?", "¿Has visto a tus amigas?", "¿Has cocinado algo nuevo?", "¿Has tenido mucho trabajo?"] },
  { id: "algunavez", t: "perf", title: "¿Alguna vez…?",
    open: "Vamos a jugar a «¿alguna vez…?». ¿Alguna vez has hecho algo un poco loco?",
    follow: ["¿Alguna vez has perdido un avión?", "¿Has probado algún deporte de riesgo?", "¿Has conocido a alguien famoso?", "¿Has vivido en otro país?", "¿Cuál es el sitio más bonito que has visto?"] },
  { id: "ano", t: "perf", title: "Este año",
    open: "¿Qué cosas nuevas has hecho este año?",
    follow: ["¿Has viajado a algún sitio nuevo?", "¿Has aprendido algo?", "¿Qué libro has leído?", "¿Has cambiado alguna costumbre?", "¿De qué estás más orgullosa este año?"] },
  { id: "todavia", t: "perf", title: "Ya y todavía no",
    open: "¿Hay algo que siempre has querido hacer y todavía no has hecho?",
    follow: ["¿Por qué no lo has hecho todavía?", "¿Ya has empezado a prepararlo?", "¿Se lo has contado a alguien?", "¿Qué cosas de tu lista ya has cumplido?", "¿Has estado cerca alguna vez?"] },

  // ---------- pluscuamperfecto: the past before the past ----------
  { id: "primera", t: "plusc", title: "Primeras veces",
    open: "Cuando viajaste en avión por primera vez, ¿ya habías salido de España antes?",
    follow: ["¿Ya habías hecho la maleta tú sola alguna vez?", "¿Habías estado nerviosa los días anteriores?", "¿Alguien te había dado consejos?", "¿Qué te habían contado del sitio?", "¿Habías visto fotos antes de ir?"] },
  { id: "dieciocho", t: "plusc", title: "Antes de los 18",
    open: "Cuando cumpliste dieciocho años, ¿qué cosas ya habías hecho?",
    follow: ["¿Ya te habías sacado el carné de conducir?", "¿Habías viajado sola?", "¿Ya habías tenido novio?", "¿Habías trabajado alguna vez?", "¿Qué cosas todavía no habías probado?"] },
  { id: "llegar", t: "plusc", title: "Llegar tarde",
    open: "¿Alguna vez llegaste a un sitio y todo ya había pasado? Cuéntame.",
    follow: ["¿Qué había pasado antes de que llegaras?", "¿Por qué no habías llegado antes?", "¿Alguien te había avisado?", "¿Qué te habías perdido?", "¿Ya se habían ido todos?"] },
  { id: "mudanza", t: "plusc", title: "Antes de mudarte",
    open: "Cuando te mudaste a tu casa actual, ¿ya habías vivido sola antes?",
    follow: ["¿Ya habías visitado el barrio?", "¿Habías comprado muebles nuevos?", "¿Qué habías dejado en tu casa anterior?", "¿Ya conocías a algún vecino?", "¿Habías imaginado que te iba a gustar tanto?"] },

  // ---------- imperfecto de subjuntivo: wishes, hypotheses, como si ----------
  { id: "padres", t: "subj", title: "Lo que querían tus padres",
    open: "Cuando eras pequeña, ¿qué querían tus padres que fueras de mayor?",
    follow: ["¿Te pedían que estudiaras mucho?", "¿Qué te prohibían que hicieras?", "¿Querían que aprendieras algún instrumento?", "¿Te dejaban que salieras sola?", "¿Qué te aconsejaban que hicieras?"] },
  { id: "si", t: "subj", title: "Si pudieras…",
    open: "Si pudieras vivir en cualquier ciudad del mundo, ¿dónde vivirías?",
    follow: ["¿Y si tuvieras un año libre, qué harías?", "Si te tocara la lotería, ¿qué comprarías primero?", "Si pudieras hablar con alguien famoso, ¿con quién hablarías?", "Si fueras otra persona por un día, ¿quién serías?", "Si pudieras cambiar algo de tu pasado, ¿qué cambiarías?"] },
  { id: "deseos", t: "subj", title: "Deseos del pasado",
    open: "¿Qué esperabas que pasara este año cuando empezó enero?",
    follow: ["¿Qué querías que cambiara en tu trabajo?", "¿Qué te gustaba que hiciera tu pareja?", "¿Qué te pidió alguien que hicieras últimamente?", "¿Qué te sorprendió que pasara?", "¿Qué te molestó que te dijeran?"] },
  { id: "comosi", t: "subj", title: "Como si…",
    open: "¿Conoces a alguien que siempre habla como si lo supiera todo? Cuéntame.",
    follow: ["¿Alguna vez actuaste como si no pasara nada?", "¿Te han mirado como si estuvieras loca?", "¿Has dormido alguna vez como si no hubiera un mañana?", "¿Hay alguien que te trata como si fueras su hija?", "¿Qué te gustaría hacer como si tuvieras veinte años?"] },
  { id: "consejo", t: "subj", title: "Consejos",
    open: "¿Cuál es el mejor consejo que te dieron? ¿Qué te dijeron que hicieras?",
    follow: ["¿Quién te lo dijo?", "¿Te recomendaron que esperaras o que te lanzaras?", "¿Hiciste lo que te pidieron que hicieras?", "¿Qué le aconsejarías a alguien si te preguntara lo mismo?", "¿Alguien te sugirió alguna vez que cambiaras de trabajo?"] },
];

// how each tense is named in the topic line, and the angle the model's
// follow-up question should take to draw that tense out of her
const TENSE_GUIDE = {
  pret: { name: "indefinido", angle: "qué pasó, qué hizo o cómo acabó" },
  imp: { name: "imperfecto", angle: "cómo era, cómo se sentía o qué solía hacer entonces" },
  perf: { name: "perfecto", angle: "qué ha hecho hoy, esta semana o alguna vez en su vida" },
  plusc: { name: "pluscuamperfecto", angle: "qué ya había pasado antes de ese momento" },
  subj: { name: "imperfecto de subjuntivo", angle: "qué quería que pasara, qué le pidieron que hiciera o qué haría si pudiera" },
};

// general follow-ups for the guided tutor: they fit almost any answer, so the
// reply stays on what she said instead of jumping to a new prepared question
const FOLLOW_UP = {
  pret: ["¿Y qué pasó después?", "¿Y qué tal, te gustó?", "¿Y cómo acabó la cosa?", "¿Y qué hiciste luego?", "¿Y qué fue lo mejor?", "¿Y cómo reaccionaste?"],
  imp: ["¿Y cómo era?", "¿Y cómo te sentías?", "¿Y qué más hacíais?", "¿Y te gustaba?", "¿Y quién estaba contigo?"],
  perf: ["¿Y qué tal ha ido?", "¿Y qué más has hecho?", "¿Te ha gustado?", "¿Y cómo te has sentido?"],
  plusc: ["¿Y qué había pasado antes?", "¿Lo habías hecho alguna vez antes?", "¿Y ya lo habías planeado?"],
  subj: ["¿Y qué querías que pasara?", "¿Y qué harías si pudieras repetirlo?", "¿Y si fuera ahora, qué harías?"],
};

// short, neutral reactions for the guided tutor — they fit any answer
const ACKS = ["Ah, mira.", "Qué interesante.", "¡Anda!", "Ya veo.", "Vaya.", "Entiendo.", "¡Qué bien!", "Oh, cuéntame más.", "Me encanta leerte.", "Mmm, ya."];

// used when the guided tutor echoes a corrected form back to her, recast-style
const ECHO = [
  (f) => `Así que ${f}… ¡qué bien!`,
  (f) => `Ah, ${f}. Entiendo.`,
  (f) => `Vale, ${f}.`,
];

if (typeof module !== "undefined") module.exports = { TOPICS, TENSE_GUIDE, FOLLOW_UP, ACKS, ECHO };
