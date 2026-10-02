// Run with: node tests/analyzer.test.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const root = path.join(__dirname, "..");
vm.runInThisContext(fs.readFileSync(path.join(root, "data.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(path.join(root, "analyzer.js"), "utf8") + "\nglobalThis.Analyzer = Analyzer;");

let fails = 0;
const fixes = (text, target, ctx) => Analyzer.analyze(text, target, ctx).findings.map((f) => `${f.text}>${f.fix}${f.sure ? "" : "?"}`);
function expect(text, want, target, ctx) {
  const got = fixes(text, target, ctx);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${text}\n      ${JSON.stringify(got)}${ok ? "" : "  wanted " + JSON.stringify(want)}`);
}
function uses(text, want) {
  const got = Analyzer.analyze(text).uses.map((u) => `${u.text}:${u.t}`);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${text}\n      ${JSON.stringify(got)}${ok ? "" : "  wanted " + JSON.stringify(want)}`);
}

// correct text: nothing to say
expect("El sábado fuimos a la playa y comí paella.", []);
expect("Cuando era pequeña vivía en Lugo y jugaba en la calle.", []);
expect("Hoy he comido con mi madre y hemos hablado mucho.", []);
expect("Cuando llegué, ya se habían ido.", []);
expect("Si tuviera tiempo, viajaría más.", []);
expect("Mi madre quería que estudiara medicina.", []);
expect("Ayer conocí a una chica que vive en Vigo.", []);
expect("Hace dos años fui a Italia.", []);
expect("Me gustó mucho, era muy bonito.", []);
expect("Ella y yo fuimos al cine.", []);
expect("A ella le encantó la película.", []);
expect("Fui en tren porque es más cómodo.", []);
expect("Para mí fue un día perfecto, no hice nada.", []);
expect("Comí en casa como siempre.", []);

// forms that don't exist
expect("Ayer andé por el centro.", ["andé>anduve"]);
expect("Tení que trabajar.", ["Tení>Tuve"]);
expect("Mi hermano dormió mucho.", ["dormió>durmió"]);
expect("Pidí una pizza.", ["Pidí>Pedí"]);
expect("Me dijieron que no.", ["dijieron>dijeron"]);
expect("Si teniera dinero, viajaría.", ["teniera>tuviera"]);
expect("Ayer tuvé un examen.", ["tuvé>tuve"]);
expect("Hizó mucho calor.", ["Hizó>Hizo"]);
expect("He abrido la ventana.", ["He abrido>He abierto"]);
expect("Nunca había escribido un poema.", ["había escribido>había escrito"]);
expect("Pensé que piensó lo mismo.", ["piensó>pensó"]);
expect("El niño leió el libro.", ["leió>leyó"]);

// accents
expect("Mi madre vivio en Francia.", ["vivio>vivió"]);
expect("Estabamos muy cansados.", ["Estabamos>Estábamos"]);
expect("He leido tres libros este año.", ["He leido>He leído"]);
expect("Fué increíble.", ["Fué>Fue"]);
expect("Mi padre me dió un regalo.", ["dió>dio"]);
expect("Habia mucha gente.", ["Habia>Había"]);

// person against an explicit subject
expect("Yo fue al médico.", ["fue>fui"]);
expect("Nosotros comió mucho.", ["comió>comimos"]);
expect("Yo ha estado en Roma.", ["ha estado>he estado"]);
expect("Mi primo se cayó y yo fue a buscar a mi madre.", ["fue>fui"]);
expect("Mi madre y yo fuimos al mercado.", []);

// si / como si
expect("Si tendría tiempo, iría.", ["tendría>tuviera"]);
expect("Si tenga tiempo, iría.", ["tenga>tuviera"]);
expect("Hablaba como si es su casa.", ["es>fuera"]);

// soft hints
expect("Quería que vengas a la fiesta.", ["vengas>vinieras?"]);
expect("Ayer voy al cine con mi novio.", ["voy>fui?"]);
expect("Voy a la playa con mis amigas.", [], "imp");
expect("No, no lo recuerdo.", [], "plusc");
expect("No sé, creo que estaba en casa.", []);
expect("Antes voy mucho a la playa.", ["voy>iba?"]);
expect("¿Qué hicistes ayer? Fuistes al cine.", ["hicistes>hiciste", "Fuistes>Fuiste"]);
expect("El lunes pasado me levanto, desayuno y voy a trabajar.", ["levanto>levanté?"], "pret");

// homographs: hacia / sabia
expect("Bien, hacia mucho calor pero me gustaba.", ["hacia>hacía"]);
expect("No sabia que estabas aquí.", ["sabia>sabía"]);
expect("Fuimos hacia la playa.", []);
expect("Mi abuela era una mujer sabia.", []);

// a subjunctive with nothing to ask for it
expect("Hicieramos muchos helados.", ["Hicieramos>Hacíamos"], undefined, { qTense: "imp" });
expect("Comiéramos paella.", ["Comiéramos>Comimos"], undefined, { qTense: "pret" });
expect("hicieramos muchos helados", ["hicieramos>hacíamos"], "imp", { qTense: "pret" });
expect("Si tuviéramos tiempo, iríamos.", []);
expect("Me gustaría que vinieras.", []);
expect("Quisiera un café.", []);

// que + indicative after a verb of wish
expect("Mi madre quería que soy médica.", ["soy>fuera"]);
expect("Me pidió que le ayudo con la mudanza.", ["ayudo>ayudara"]);
expect("Quería que fui con ella.", ["fui>fuera"]);
expect("Me dijo que vino tarde.", []);

// asked about a habit, answered with a one-off
expect("Hice castillos de arena.", ["Hice>hacía?"], "imp", { qTense: "imp" });
expect("Un día hice un castillo enorme.", [], "imp", { qTense: "imp" });
expect("Hice castillos de arena.", [], "pret", { qTense: "pret" });

// which past forms were used
uses("El sábado fuimos a la playa, hacía sol y he dormido la siesta.", ["fuimos:pret", "hacía:imp", "he dormido:perf"]);
uses("Cuando llegamos ya habían cerrado, como si lo supieran.", ["llegamos:pret", "habían cerrado:plusc", "supieran:subj"]);

// the tutor's text gets repaired in place
const rep = Analyzer.repair("¡Ah, andaste por el centro! ¿Y qué hacistes después? Yo tení un día largo.");
console.log(rep);
if (!rep.includes("anduviste") || !rep.includes("tuve") || !rep.includes("hiciste ")) { fails++; console.log("FAIL repair"); }

// present & present-subjunctive generator spot checks
const V = Object.fromEntries(VERBS.map((v) => [v.inf, v]));
const spot = [
  ["tener", 0, "tengo"], ["tener", 1, "tienes"], ["conocer", 0, "conozco"], ["elegir", 0, "elijo"],
  ["seguir", 0, "sigo"], ["seguir", 1, "sigues"], ["jugar", 2, "juega"], ["dormir", 3, "dormimos"],
  ["construir", 2, "construye"], ["coger", 0, "cojo"], ["volver", 5, "vuelven"], ["oír", 2, "oye"],
];
for (const [inf, p, want] of spot) { const g = Analyzer.present(V[inf], p); if (g !== want) { fails++; console.log("FAIL present", inf, p, g, want); } }
const spotS = [
  ["tener", 0, "tenga"], ["tener", 3, "tengamos"], ["dormir", 3, "durmamos"], ["pedir", 1, "pidas"],
  ["buscar", 0, "busque"], ["llegar", 2, "llegue"], ["empezar", 2, "empiece"], ["empezar", 3, "empecemos"],
  ["conocer", 3, "conozcamos"], ["seguir", 3, "sigamos"], ["jugar", 0, "juegue"], ["construir", 3, "construyamos"],
  ["ver", 0, "vea"], ["coger", 3, "cojamos"], ["sentir", 3, "sintamos"], ["pensar", 3, "pensemos"],
];
for (const [inf, p, want] of spotS) { const g = Analyzer.presSubj(V[inf], p); if (g !== want) { fails++; console.log("FAIL psubj", inf, p, g, want); } }

console.log(fails ? `\n${fails} failing` : "\nall passing");
process.exit(fails ? 1 : 0);
