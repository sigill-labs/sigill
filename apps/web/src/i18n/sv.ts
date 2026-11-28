// Swedish text. Same keys as en.ts.

import type { LogFields } from "@fidant/protocol";
import type { Kind, Tie } from "../lib/server-facts.ts";
import type { Messages, Nouns, Section, Sections } from "./en.ts";

const items: Nouns = {
  file: {
    label: "Filinnehåll",
    The: "Filen",
    the: "filen",
    it: "den",
    encrypted: "krypterad",
    data: "filinnehåll",
    key: "den del av länken som låser upp filen",
    unlocks: "den del som låser upp filen",
    seen: "den krypterade filen som passerar, med storleken avrundad uppåt så att den exakta storleken inte syns",
  },
  secret: {
    label: "Hemlighet",
    The: "Hemligheten",
    the: "hemligheten",
    it: "den",
    encrypted: "krypterad",
    data: "hemligheter",
    key: "den del av länken som låser upp hemligheten",
    unlocks: "den del som låser upp hemligheten",
    seen: "den krypterade hemligheten som passerar, vilket inte visar något om dess längd",
  },
  unknown: {
    label: "Innehåll",
    The: "Det som delas",
    the: "det som delas",
    it: "det",
    encrypted: "krypterat",
    data: "det som delas",
    key: "den del av länken som låser upp det som delas",
    unlocks: "den del som låser upp det som delas",
    seen: "de krypterade uppgifterna som passerar, med storleken avrundad uppåt så att den exakta storleken inte syns",
  },
};

// Samma fält som logFields i en.ts, inklusive `event`.
const logFields: Record<"event" | keyof LogFields, readonly [string, string]> = {
  event: [
    "vad som hände, till exempel att en länk öppnades eller en anslutning nekades",
    "För att se hur tjänsten beter sig och hitta vad som gick fel.",
  ],
  link: [
    "de 6 första tecknen i ett länk-ID",
    "Så att vi kan följa en länk genom loggen när något går fel, utan att kunna hitta själva länken.",
  ],
  links: [
    "hur många länkar en avsändare har",
    "För att se hur tjänsten används och upptäcka en avsändare med ovanligt många länkar.",
  ],
  bytes: [
    "meddelandens storlek",
    "För att upptäcka för stora eller trasiga meddelanden och dimensionera servern.",
  ],
  reason: [
    "varför en länk eller en anslutning nekades",
    "För att se varför anslutningar misslyckas, så att vi kan åtgärda orsaken.",
  ],
  code: [
    "vad som var fel med ett meddelande som servern avvisade",
    "För att hitta fel i webbappen eller servern.",
  ],
  path: [
    "om varje anslutning gick direkt, via vårt relä eller misslyckades",
    "För att veta hur ofta anslutningar behöver vårt relä, vilket visar hur stort det måste vara.",
  ],
  port: [
    "platsen på datorn där servern kan nås (dess portnummer)",
    "För att bekräfta att servern startade där den ska.",
  ],
};

export const sv: Messages = {
  product: "Fidant",
  tabTitles: {
    landing: "Fidant: privat filöverföring",
    send: "Skicka en fil – Fidant",
    secret: "Dela en hemlighet – Fidant",
    receive: "Ta emot – Fidant",
    privacy: "Integritet – Fidant",
    how: "Så fungerar det – Fidant",
    about: "Om Fidant – Fidant",
    terms: "Användarvillkor – Fidant",
    security: "Säkerhet – Fidant",
    notFound: "Sidan finns inte – Fidant",
    insecure: "Säker anslutning krävs – Fidant",
  },
  notFound: {
    title: "Sidan finns inte",
    body: "Det finns ingen sida på den här adressen. Den kan ha flyttats, eller så är länken felskriven.",
    home: "Till startsidan",
  },
  noscript:
    "Krypteringen sker i din webbläsare, så Fidant behöver JavaScript. Slå på det för att skicka eller ta emot en fil.",
  openTransfer: {
    send: "En filöverföring är fortfarande öppen i den här fliken.",
    secret: "En hemlighet delas fortfarande från den här fliken.",
    receive: "En överföring till dig är fortfarande öppen i den här fliken.",
    back: "Gå tillbaka",
  },
  menu: {
    language: "Språk",
    theme: "Tema",
    themes: { system: "System", light: "Ljust", dark: "Mörkt" },
    label: "Huvudmeny",
    send: "Skicka",
    secret: "Dela en hemlighet",
    how: "Så fungerar det",
    privacy: "Integritet",
  },
  landing: {
    title: "Skicka en fil som bara mottagaren kan öppna.",
    lede: "Fidant krypterar filen i din webbläsare innan den går till personen du väljer. Filen sparas aldrig, och bara den som har länken kan öppna den.",
    cta: "Skicka en fil",
    how: "Läs hur det fungerar",
    noAccount: "Inget konto. Inget sparas.",
    linkHeading: "Hela knepet sitter i länken",
    linkId: "Länk-ID. Vår server ser det och använder det för att koppla ihop de två webbläsarna.",
    linkKey: "Nyckel. Webbläsare skickar aldrig det som står efter # till någon server.",
    stepsHeading: "Så går det till",
    steps: [
      ["Välj en fil", "Den stannar på din dator. Inget laddas upp."],
      ["Lägg till vem den är till", "Varje person får en egen länk som fungerar en gång."],
      [
        "Dela länken",
        "När de öppnar den går filen från din webbläsare till deras, krypterad hela vägen.",
      ],
    ] as ReadonlyArray<readonly [string, string]>,
    serverHeading: "Vad vår server vet",
    neverHeading: "Vår server får aldrig",
    seesHeading: "Vår server ser",
    relayNote:
      "Om de två webbläsarna inte kan ansluta direkt och vårt relä är tillgängligt går filen i stället via reläet, fortfarande krypterad. Reläet ser då ungefär hur stor filen är, men kan inte låsa upp den. Hur filen än går frågar varje webbläsare reläet om sin offentliga adress, så reläet ser båda IP-adresserna och kan oftast se att de hör ihop.",
    caveat: "Haken: eftersom inget sparas måste fliken vara öppen tills filen har kommit fram.",
    tryHeading: "Prova på dig själv",
    tryBody:
      "Skicka en fil till dig själv, öppna länken på mobilen och se den komma fram. Det tar ungefär en minut.",
    tryCta: "Skicka en fil till dig själv",
    trySecret: "Eller dela en hemlighet",
  },
  how: {
    title: "Så fungerar det",
    lede: "Vad som händer med din fil, steg för steg. Kort sagt: den låses på din dator. Bara den som har länken kan låsa upp den.",
    sections: {
      stays: {
        heading: "Din fil stannar på din dator",
        body: [
          "Du väljer en fil i webbläsaren. Den laddas inte upp någonstans.",
          "Webbläsaren låser filen innan den lämnar din dator.",
        ],
      },
      link: {
        heading: "Du får en länk med nyckeln i",
        body: [
          "Du får en länk per person. Varje länk fungerar en gång. Du skickar den själv, till exempel via mejl eller chatt.",
          "Nyckeln som låser upp filen är delen efter tecknet #. Webbläsare skickar aldrig den delen till oss. Därför ser vi aldrig nyckeln.",
          "Alla som har länken kan öppna filen. Skicka varje länk bara till personen den är avsedd för.",
        ],
      },
      open: {
        heading: "De öppnar länken medan din sida är öppen",
        body: [
          "Inget sparas, så din sida måste vara öppen tills de har fått filen.",
          "Vår server hjälper de två webbläsarna att hitta varandra. Den är som en telefonist som kopplar ett samtal. Den skickar vidare några små meddelanden. De som kopplar upp anslutningen är låsta, så den kan inte läsa dem.",
          "De ser filens namn och storlek och väljer om de vill ladda ner den.",
        ],
      },
      direct: {
        heading: "Filen går direkt till dem, låst",
        body: [
          "När nätverken tillåter det går filen direkt från din dator till deras. Den är låst hela vägen.",
          "Deras webbläsare låser upp den och kontrollerar att det är exakt den fil du skickade.",
          "Precis som i ett videosamtal kan varje enhet se den andras internetadress.",
        ],
      },
      relay: {
        heading: "Ibland går den via vårt relä",
        body: [
          "Vissa nätverk kan inte ansluta direkt till varandra. Det är vanligt på mobildata och på kontorsnätverk.",
          "Om reläet är tillgängligt går filen då via vårt relä i Stockholm i stället, fortfarande låst.",
          "Reläet kan inte öppna filen och sparar den inte.",
          "Det ser varje enhets internetadress och ungefär hur stor filen är.",
        ],
      },
      never: {
        heading: "Det här lämnas kvar",
        body: [
          "Vi ser aldrig din fil, dess namn eller nyckeln som låser upp den. Vårt relä ser aldrig nyckeln alls.",
          "Vår server och vårt relä har det de ser i minnet eller i korta loggar, förutom månatliga trafiksummor. Några spår finns också kvar i de två webbläsarna, och mottagaren har filen.",
        ],
      },
      encryption: {
        heading: "Den låses två gånger",
        body: [
          "Din webbläsare låser filen med en nyckel som kommer från länken. Utan länken kan ingen låsa upp den.",
          "Anslutningen mellan de två webbläsarna är också låst, så filen är låst två gånger på vägen.",
        ],
      },
      transfer: {
        heading: "Den skickas i små numrerade delar",
        body: [
          "Din webbläsare skickar filen i lika stora delar, var och en låst och numrerad.",
          "Ingen del skickas förrän mottagaren har tackat ja till filen.",
        ],
      },
      verification: {
        heading: "Mottagarens webbläsare kontrollerar den",
        body: [
          "När sista delen har kommit fram kontrollerar mottagarens webbläsare att filen är exakt den du skickade.",
          "Saknas eller ändras något kastas filen. Du ser att den kommit fram först när kontrollen har gått igenom.",
        ],
      },
      masking: {
        heading: "Storleken suddas ut",
        body: [
          "Den som ser trafiken ser ungefär hur mycket som skickas, men inte filens exakta storlek.",
          "En delad hemlighet ser alltid lika stor ut, hur lång den än är.",
        ],
      },
      protection: {
        heading: "Det som skyddar dig, och det som inte gör det",
        body: [
          "Varje risk, och vad i Fidant som står emot den.",
          "Och riskerna Fidant inte kan skydda dig mot, till exempel att någon annan får tag på länken.",
        ],
      },
      tech: {
        heading: "Orden förklarade",
        body: [
          "Fidant bygger på WebRTC, tekniken webbläsare använder för videosamtal. Den här sidan förklarar den och de andra tekniska orden på de här sidorna, till exempel STUN och TURN.",
        ],
      },
    },
    more: "Vill du veta mer? På integritetssidan står exakt vad vår server ser och vad den loggar.",
    moreLink: "Läs integritetssidan",
    readMore: "Läs mer",
    steps: "Steg",
    overview: "Översikt",
    next: "Nästa",
    copyLink: "Kopiera länk till den här delen",
    copied: "Länken kopierad",
    copyFailed: "Det gick inte att kopiera länken. Kopiera den från adressfältet i stället.",
    nav: {
      stays: "Filen",
      encryption: "Kryptering",
      link: "Länken",
      open: "Uppkoppling",
      direct: "Direkt",
      relay: "Relä",
      transfer: "Överföring",
      verification: "Kontroll",
      masking: "Maskering",
      never: "Spår",
      protection: "Skydd",
      tech: "Ordlista",
    },
  },
  insecure: {
    title: "Sidan behöver en säker anslutning",
    body: "Filer krypteras i din webbläsare, och det fungerar bara över en säker anslutning. Öppna sidan med en adress som börjar med https://.",
  },
  common: {
    techDetails: "Tekniska detaljer",
    close: "Stäng",
    size: "Storlek",
    type: "Typ",
    typeMissing: "Inte angiven",
    you: "Du",
    sender: "Avsändare",
    localhost:
      "Sidan är öppnad på localhost, så länkarna fungerar inte på andra datorer. Öppna i stället nätverksadressen som servern skrev ut.",
  },
  connection: {
    why: "Varför?",
    more: "Mer om hur det fungerar",
    direct: {
      label: "Direkt anslutning",
      explain:
        "Filen går direkt mellan de två enheterna. Varje sida kan se den andras internetadress, precis som i ett videosamtal.",
    },
    relay: {
      label: "Via vårt relä",
      explain:
        "De två nätverken kunde inte ansluta direkt till varandra, vilket är vanligt på mobildata och kontors-wifi. Därför går filen via vårt relä i Stockholm. Den är låst hela vägen: reläet kan inte öppna den och sparar den inte. Reläet ser båda enheternas internetadresser och ungefär hur stor filen är.",
    },
  },
  format: {
    bytes: (n: number) => `${n.toLocaleString("sv")} byte`,
    progress: (percent: string, done: string, total: string) => `${percent} · ${done} av ${total}`,
    timeLeft: (duration: string) => `Ungefär ${duration} kvar`,
  },
  send: {
    mode: {
      label: "Vad du vill skicka",
      file: "Fil",
      secret: "Hemlighet",
      locked:
        "En sändning i taget. Du kan byta när alla länkar här har levererat, eller när du tar bort dem.",
    },
    continue: "Fortsätt",
    title: "Skicka en fil",
    lede: "Välj en fil och lägg sedan till varje person du vill skicka den till. Din fil skickas från den här webbläsaren till dem. Den är krypterad hela vägen och laddas aldrig upp eller sparas.",
    step: (n: number) => `Steg ${n} av 3`,
    peopleHeading: "Lägg till mottagare",
    peopleLede:
      "Lägg till varje person du vill skicka till. Var och en får en egen länk, som fungerar en gång.",
    linksHeading: "Dela länkarna",
    linksLede:
      "Skicka varje person deras egen länk, till exempel i en chatt eller ett mejl. Håll den här sidan öppen tills alla har tagit emot den.",
    change: "Byt",
    connectionOptions: "Anslutningsalternativ",
    addEmail: "Lägg till mottagare och mejla länk",
    addEmailCheck: "Lägg till mottagare och mejla länk med kontrollnummer",
    linkKind: {
      label: "Verifiering",
      plain: "Länk",
      check: "Kontrollnummer",
    },
    share: "Dela",
    shareFor: (name: string) => `Dela länken till ${name}`,
    // No-break spaces keep the count on one line.
    sendingBar: (delivered: number, total: number) =>
      `${delivered}\u00a0av\u00a0${total}\u00a0levererade`,
    keepOpen: "Håll fliken öppen",
    // The bar shows these as two lines without full stops; a sentence built from them adds its own.
    allDone: "Alla länkar har levererat filen",
    closeTab: "Du kan stänga fliken",
    summary: (done: number, total: number) => `${done} av ${total} länkar har levererat filen`,
    delivered: "Levererad",
    doneTitle: "Allt levererat",
    notifyMe: "Meddela mig",
    notifyOn: "Notiser på",
    notifyBlocked: "Notiser blockerade",
    lostServer:
      "Anslutningen till servern bröts. Försöker ansluta igen… Filer som redan är på väg kan komma fram. Ingen ny kan ansluta förrän den är tillbaka, så håll sidan öppen.",
    fromLabel: "Ditt namn",
    optional: "(valfritt)",
    fromHint: "Visas för dem du skickar till.",
    fromHintEmail:
      "Om vi mejlar en länk står ditt namn också i mejlet, markerat som inte verifierat. Vår server lägger in det där och sparar det inte.",
    allowRelay: "Använd vårt relä vid behov",
    allowRelayHint: (kind: Kind) =>
      `Vissa nätverk stoppar direkta anslutningar. Då går ${items[kind].the} via vårt relä i Stockholm, fortfarande ${items[kind].encrypted}. Reläet ser båda IP-adresserna${kind === "file" ? " och ungefär storleken" : ""}, men kan inte öppna ${items[kind].it}. Om du bockar ur det här slutar vår server dela ut inloggningsuppgifter till reläet för den här sändningen. Reläet ser ändå varje IP-adress, eftersom varje webbläsare får veta sin offentliga adress från reläet.`,
    fromError: {
      unsafe:
        "Ditt namn innehåller tecken som inte kan skickas, eller tre eller fler mellanslag i rad. Ta bort dem och försök igen.",
      tooLong:
        "Ditt namn och filnamnet är för långa tillsammans. Korta ditt namn eller byt namn på filen.",
    },
    chooseFile: "Välj en fil",
    orDrop: "eller släpp den här",
    fileError: {
      unsafe:
        "Filnamnet innehåller tecken som inte kan skickas, eller tre eller fler mellanslag i rad. Byt namn på filen och försök igen.",
      tooLong: "Filnamnet är för långt för att kunna skickas. Byt namn på filen och försök igen.",
    },
    fileChosen: (name: string, size: string) => `Vald fil: ${name}, ${size}`,
    preparing: "Gör i ordning filen…",
    readFailed: "Det gick inte att läsa filen. Välj den igen.",
    hashPending: "Inte klar än",
    locked: "Ta bort alla mottagare för att ändra ditt namn eller din fil.",
    sendAnother: "Skicka en ny fil",
    recipientLabel: "Vem ska få den?",
    recipientPlaceholder: "Mottagarens namn",
    add: "Lägg till mottagare",
    addCheck: "Lägg till mottagare med kontrollnummer",
    nameError: {
      missing: "Skriv ett namn.",
      taken: "Det namnet finns redan på listan.",
    },
    emailChoice: "Mejla länken åt mig (mindre privat)",
    emailMore: "Vad det innebär att mejla en länk",
    emailLabel: "Mottagarens mejladress",
    emailError: "Skriv en giltig mejladress, till exempel namn@example.se.",
    emailNotice:
      "Vår server ser den här länkens nyckel en gång, för att skriva mejlet. Den sparar eller loggar inte nyckeln, men vår mejltjänst och den som läser mejlet på vägen kan också se nyckeln. Länken, med nyckeln, ligger kvar i mottagarens inkorg: den som kan läsa den inkorgen kan ta emot filen. Vår server skulle också kunna ställa sig mellan er för den här länken. Lägg till med kontrollnummer och jämför numret med mottagaren, så ser du om servern gör det. Om du skickar länken själv slipper du allt detta.",
    check: {
      hint: (kind: Kind) =>
        `Med kontrollnummer jämför ni sex siffror i telefon eller på plats innan ${items[kind].the} skickas, så att du vet att ingen är emellan.`,
      ask: (name: string) => `Be ${name} läsa upp numret på sin skärm. Stämmer det?`,
      matches: "Det stämmer",
      differs: "Det skiljer sig",
      matchesFor: (name: string) => `Det stämmer för ${name}`,
      differsFor: (name: string) => `Det skiljer sig för ${name}`,
      titleFor: (name: string) => `Kontrollnummer för ${name}`,
      later: "Inte nu",
      compare: "Jämför nummer",
      compareFor: (name: string) => `Jämför nummer för ${name}`,
      waiting: "Du sa att det stämmer. Det skickas när mottagaren också har bekräftat.",
      differed:
        "Numren stämde inte, så inget skickades. Någon kan ha varit emellan. Länken fungerar fortfarande om du vill försöka igen.",
      expired:
        "Kontrollnumret bekräftades inte inom 5 minuter, så inget skickades. Länken fungerar fortfarande om du vill försöka igen.",
      limit: (times: number) =>
        `Kontrollen misslyckades ${times} gånger, så länken fungerar inte längre. Någon kan försöka ta sig in mellan er. Lägg till mottagaren igen för en ny länk.`,
    },
    fileFirst: "Välj en fil först.",
    full: (max: number) => `Du kan skicka till högst ${max} personer åt gången.`,
    recipients: "Mottagare",
    steps: {
      waiting: "Väntar",
      checking: "Kontrollerar",
      opened: "Öppnad",
      receiving: "Tar emot",
      delivered: "Klar",
    },
    status: {
      waiting: (name: string) => `Väntar på att länken till ${name} ska öppnas`,
      connecting: (name: string) => `Ansluter via länken till ${name}…`,
      checking: (name: string) => `Länken till ${name} har öppnats. Jämför kontrollnumret.`,
      offered: (name: string) => `Länken till ${name} har öppnats`,
      declined: (name: string) =>
        `Länken till ${name} öppnades och filen avböjdes. Länken fungerar fortfarande.`,
      receiving: (name: string) => `Skickar via länken till ${name}`,
      delivered: (name: string) => `Levererad via länken till ${name}`,
      interrupted: (name: string) =>
        `Överföringen via länken till ${name} avbröts. Länken kan öppnas igen för att försöka på nytt.`,
      failed: (name: string) =>
        `Filen kom inte fram oskadd via länken till ${name}. Länken kan öppnas igen för att försöka på nytt.`,
      senderOutdated: (name: string) =>
        `Länken till ${name} öppnades i en nyare version av Fidant. Ladda om sidan och lägg till ${name} igen för att skicka via en ny länk. När du laddar om försvinner alla länkar på sidan.`,
      recipientOutdated: (name: string) =>
        `Länken till ${name} öppnades i en äldre version av Fidant. Det är inget fel på filen. Be mottagaren att ladda om den sidan.`,
    },
    noConnect: (name: string) =>
      `Länken till ${name} öppnades men kunde inte ansluta till din dator. Länken fungerar fortfarande om de försöker igen.`,
    noRelay: (name: string) =>
      `Länken till ${name} öppnades men kunde inte ansluta direkt. Om du tillåter vårt relä kan den kanske ansluta när de försöker igen.`,
    mail: {
      sending: (to: string) => `Skickar mejl till ${to}…`,
      sent: (to: string) => `Mejl skickat till ${to}`,
      failed: (to: string) =>
        `Mejlet till ${to} skickades inte. Ta bort mottagaren och lägg till den igen för att försöka på nytt, eller lägg till den utan mejladress och dela länken själv.`,
      limit: (to: string) =>
        `Mejlet till ${to} skickades inte: för många mejl just nu. Kopiera länken nedan och dela den själv. Det är en ny länk, eftersom vår server hade sett den första länkens hemlighet.`,
      verifying: (to: string) => `Kod skickad till ${to}`,
      verified: (to: string) => `Verifierad med koden som skickades till ${to}`,
      lost: (to: string) =>
        `Länken som mejlades till ${to} slutade fungera när anslutningen till vår server bröts. Ta bort mottagaren och lägg till den igen för att skicka den på nytt.`,
    },
    progressFor: (name: string) => `Förlopp för ${name}`,
    copy: "Kopiera länk",
    copyFor: (name: string) => `Kopiera länken till ${name}`,
    copyNote: {
      copied: "Kopierad",
      failed: "Det gick inte att kopiera. Markera länken nedan och kopiera den själv.",
    },
    remove: "Ta bort",
    removeFor: (name: string) => `Ta bort ${name}`,
    linkFor: (name: string) => `Länk till ${name}`,
  },
  receive: {
    connecting: "Ansluter till avsändaren…",
    verify: {
      title: "Bekräfta din mejladress för att öppna länken",
      body: (to: string) => `Vi mejlar en kod till ${to}.`,
      send: "Skicka en kod till mig",
      sending: "Skickar en kod…",
      codeLabel: "Koden från mejlet",
      submit: "Fortsätt",
      results: {
        sent: "Koden har skickats. Titta i din e-post.",
        wait: "Ingen ny kod än. Försök igen om en minut, eller efter en timme om det fortsätter.",
        limit: "För många koder för den här länken. Be avsändaren att skicka länken till dig igen.",
        failed: "Vi kunde inte skicka koden. Försök igen om en stund.",
        wrong: "Koden stämmer inte. Försök igen.",
        expired: "Koden har gått ut. Be om en ny.",
        tries: "För många felaktiga försök. Be om en ny kod.",
      },
    },
    offerTitle: (from: string) =>
      from ? `${from} vill skicka en fil till dig` : "Du har fått en fil",
    unverified: "Namnet är skrivet av avsändaren och inte verifierat.",
    memoryWarning:
      "Den här webbläsaren håller hela filen i minnet tills du sparar den, vilket kan göra fliken långsam eller få den att krascha. Chrome eller Edge på en dator sparar direkt till disk.",
    download: "Ladda ner",
    decline: "Tacka nej",
    offerCaption: (from: string) =>
      `Skickas från ${from ? `datorn hos ${from}` : "avsändarens dator"} till din. Krypterad, sparas aldrig på någon server.`,
    receivingTitle: "Laddar ner…",
    progressLabel: "Förlopp för nedladdningen",
    receivingCaption: "Tar emot från avsändaren. Ha fliken öppen tills det är klart.",
    doneTitle: "Nedladdningen är klar",
    verified: "Vi har kontrollerat den: det här är exakt den fil som skickades.",
    autoDownload: "Webbläsaren bör spara den nu. Syns den inte?",
    onceNotice: "Länken fungerar en gång, och bara medan avsändarens sida är öppen.",
    savedWhereChosen: "Den är sparad där du valde.",
    saveFile: "Spara filen",
    doneCaption: "Skickad från avsändarens dator till din. Krypterad hela vägen.",
    declinedTitle: "Du tackade nej till filen",
    declinedBody:
      "Du kan stänga fliken. Om du ändrar dig fungerar länken fortfarande medan avsändarens sida är öppen.",
    showAgain: "Visa filen igen",
    tryAgain: "Försök igen",
    check: {
      heading: "Kontrollnummer",
      read: "Läs upp numret för avsändaren.",
      matches: "Avsändaren sa att det stämmer",
      differs: "Avsändaren sa att det skiljer sig",
      waiting: "Väntar på att avsändaren också säger att det stämmer.",
      why: "Numret kommer från den här anslutningen. Om någon satt mellan dig och avsändaren skulle era skärmar visa olika nummer.",
      expires: "Kontrollnumret går ut efter 5 minuter.",
    },
    whatHappened: "Vad som hände",
    encryptionLabel: "Kryptering",
    encryption:
      "AES-256-GCM, hela vägen från avsändaren till dig. Nyckeln finns i din länk och lämnar aldrig den här webbläsaren.",
    encryptionEmailed:
      "AES-256-GCM. Fidant mejlade den här länken, så vår server hade nyckeln en gång.",
    sha256Checked: "SHA-256, kontrollerad",
    problems: {
      badLink: {
        title: "Länken fungerar inte",
        body: "En del av den kanske saknas. Kontrollera att du har kopierat hela länken, eller be avsändaren att skicka den igen.",
      },
      unknown: {
        title: "Länken är inte aktiv",
        body: "Filen kommer direkt från avsändarens webbläsare, så länken fungerar bara medan avsändaren har sidan öppen. Be om en ny länk.",
      },
      unbound: {
        title: "Länken fungerar inte längre",
        body: "Be avsändaren att skicka den igen.",
      },
      used: {
        title: "Länken har redan använts",
        body: "Varje länk fungerar en gång. Om du fortfarande behöver filen kan du be avsändaren om en ny länk.",
      },
      busy: {
        title: "Länken är upptagen",
        body: "Varje länk kan bara vara öppen på ett ställe i taget och tillåter bara några få anslutningsförsök på kort tid. Stäng andra flikar med länken, vänta en halv minut och ladda om den här sidan.",
      },
      offline: {
        title: "Avsändarens sida är stängd",
        body: "Filen kommer direkt från avsändarens webbläsare, så sidan måste vara öppen. Be om en ny länk.",
      },
      offlineReceiving: {
        title: "Avsändarens sida är stängd",
        body: "Filen kommer direkt från avsändarens webbläsare, så sidan måste vara öppen. Filen kanske inte sparades. Be om en ny länk.",
      },
      lost: {
        title: "Anslutningen till avsändaren bröts",
        body: "Ingenting sparades.",
      },
      differed: {
        title: "Numren stämde inte",
        body: "Så ingenting togs emot. Någon kan ha varit emellan. Försök igen för att få ett nytt nummer.",
      },
      lostReceiving: {
        title: "Anslutningen till avsändaren bröts",
        body: "Försök igen. Nedladdningen fortsätter där den avbröts om det går.",
      },
      senderBusy: {
        title: "Länken är upptagen",
        body: "Avsändarens sida har kanske inte märkt att anslutningen bröts, eller så är länken öppen i en annan flik. Stäng andra flikar med länken, vänta en stund och försök igen. Nedladdningen fortsätter där den avbröts om det går.",
      },
      checksum: {
        title: "Filen kom inte fram oskadd",
        body: "Den ändrades eller skadades på vägen, så den sparades inte. Försök igen, och säg till avsändaren om det fortsätter att hända.",
        detail: "SHA-256-kontrollsumman för den mottagna filen stämde inte med avsändarens.",
      },
      invalid: {
        title: "Något gick fel med överföringen",
        body: "Avsändarens webbläsare skickade data som vi inte kunde läsa, så ingenting sparades.",
        detail:
          "En del av överföringen från avsändaren gick inte att dekryptera eller följde inte överföringsformatet.",
      },
      save: {
        title: "Filen kunde inte sparas",
        body: "Kontrollera att det finns tillräckligt med utrymme på disken.",
      },
      create: {
        title: "Filen kunde inte skapas",
        body: "Försök igen, eller välj ett annat ställe att spara den på.",
      },
      connect: {
        title: "Det gick inte att ansluta till avsändarens dator",
        body: "Era två datorer kunde inte nå varandra.",
      },
      browser: {
        title: "Den här webbläsaren kan inte ansluta till avsändaren",
        body: "WebRTC kan vara avstängt, eller så är webbläsaren för gammal. Prova en annan webbläsare.",
      },
      noRelay: {
        title: "Det gick inte att ansluta direkt till avsändaren",
        body: "Avsändaren tillåter inte vårt relä, och era nätverk kunde troligen inte ansluta direkt till varandra. Be avsändaren att tillåta reläet, eller prova ett annat nätverk, till exempel mobildata i din telefon.",
      },
      server: {
        title: "Det gick inte att nå servern",
        body: "Servern kopplar ihop dig med avsändaren. Kontrollera din internetanslutning.",
      },
      outdated: {
        title: "Den här sidan är inaktuell",
        body: "Ladda om sidan för att ta emot filen.",
      },
      senderOutdated: {
        title: "Avsändarens sida är inaktuell",
        body: "Det är inget fel på filen. Be avsändaren att ladda om sin sida och skicka en ny länk till dig.",
      },
    },
  },
  secret: {
    lede: "Klistra in ett lösenord, en API-nyckel eller en annan kort hemlighet. Den går från den här webbläsaren till dem du väljer, krypterad hela vägen, och laddas aldrig upp eller sparas.",
    label: "Din hemlighet",
    hint: (max: number) => `Högst ${max.toLocaleString("sv")} tecken.`,
    count: (length: number, max: number) =>
      `${length.toLocaleString("sv")} av ${max.toLocaleString("sv")} tecken.`,
    tooLong: "Korta hemligheten för att kunna dela den.",
    lostServer:
      "Anslutningen till servern bröts. Försöker ansluta igen… Hemligheter som redan är på väg kan komma fram. Ingen ny kan ansluta förrän den är tillbaka, så håll sidan öppen.",
    problems: {
      offline: {
        title: "Avsändarens sida är stängd",
        body: "Hemligheten kommer direkt från avsändarens webbläsare, så sidan måste vara öppen. Be om en ny länk.",
      },
      offlineReceiving: {
        title: "Avsändarens sida är stängd",
        body: "Hemligheten kommer direkt från avsändarens webbläsare, så sidan måste vara öppen. Hemligheten visades inte. Be om en ny länk.",
      },
      lost: {
        title: "Anslutningen till avsändaren bröts",
        body: "Hemligheten visades inte.",
      },
      lostReceiving: {
        title: "Anslutningen till avsändaren bröts",
        body: "Hemligheten visades inte. Försök igen för att vara säker på att du får den.",
      },
      checksum: {
        title: "Hemligheten kom inte fram oskadd",
        body: "Den ändrades eller skadades på vägen, så den visades inte. Försök igen, och säg till avsändaren om det fortsätter att hända.",
        detail: "SHA-256-kontrollsumman för den mottagna hemligheten stämde inte med avsändarens.",
      },
      invalid: {
        title: "Något gick fel med överföringen",
        body: "Avsändarens webbläsare skickade data som vi inte kunde läsa, så ingenting visades.",
        detail:
          "En del av överföringen från avsändaren gick inte att dekryptera eller följde inte överföringsformatet.",
      },
      save: {
        title: "Hemligheten kunde inte visas",
        body: "Webbläsaren kunde inte läsa hemligheten den tog emot. Be avsändaren att skicka den igen.",
      },
    },
    first: "Skriv eller klistra in hemligheten först.",
    locked: "Ta bort alla mottagare för att ändra ditt namn eller din hemlighet.",
    sendAnother: "Skicka en ny hemlighet",
    allDone: "Alla länkar har levererat hemligheten",
    summary: (done: number, total: number) =>
      `${done} av ${total} länkar har levererat hemligheten`,
    emailNotice:
      "Vår server ser den här länkens nyckel en gång, för att skriva mejlet. Den sparar eller loggar inte nyckeln, men vår mejltjänst och den som läser mejlet på vägen kan också se nyckeln. Länken, med nyckeln, ligger kvar i mottagarens inkorg: den som kan läsa den inkorgen kan ta emot hemligheten. Vår server skulle också kunna ställa sig mellan er för den här länken. Lägg till med kontrollnummer och jämför numret med mottagaren, så ser du om servern gör det. Om du skickar länken själv slipper du allt detta.",
    status: {
      declined: (name: string) =>
        `Länken till ${name} öppnades och hemligheten avböjdes. Länken fungerar fortfarande.`,
      failed: (name: string) =>
        `Hemligheten kom inte fram oskadd via länken till ${name}. Länken kan öppnas igen för att försöka på nytt.`,
      recipientOutdated: (name: string) =>
        `Länken till ${name} öppnades i en äldre version av Fidant. Det är inget fel på hemligheten. Be mottagaren att ladda om den sidan.`,
    },
    unsendable: (name: string) =>
      `Hemligheten skickades inte via länken till ${name}, eftersom dess längd skulle ha synts på den här anslutningen. Länken fungerar fortfarande.`,
    offerTitle: (from: string) =>
      from ? `${from} har skickat en hemlighet till dig` : "Du har fått en hemlighet",
    show: "Visa",
    receivingTitle: "Öppnar hemligheten…",
    doneTitle: "Här är hemligheten",
    textLabel: "Hemligheten",
    notSaved: "Den sparas inte någonstans. Kopiera den innan du stänger fliken.",
    copy: "Kopiera hemligheten",
    copyNote: {
      copied: "Kopierad",
      failed:
        "Det gick inte att kopiera. Markera hemligheten i rutan ovanför och kopiera den själv.",
    },
    declinedTitle: "Du tackade nej till hemligheten",
    showAgain: "Visa hemligheten igen",
  },
  server: {
    heading: "Vad vår server har just nu",
    seesLabel: "Ser",
    holdsLabel: "Har",
    passedOnLabel: "Har skickat vidare",
    fileDataLabel: (kind: Kind) => items[kind].label,
    logsLabel: "Loggar",
    afterwardsLabel: "Efteråt",
    seesSender:
      "Din IP-adress och de vanliga uppgifterna om webbläsaren som alla webbplatser får, och samma sak för varje mottagare när de öppnar sin länk.",
    seesRecipient:
      "Din IP-adress och de vanliga uppgifterna om webbläsaren som alla webbplatser får.",
    senderHolds: ({ online, links, connected, relay, emailed, sending, mailed, kind }) => {
      if (!online) {
        return mailed
          ? "Bara antalet mejl den skickade åt dig, i förvrängd form, i upp till en timme, när den har märkt att anslutningen har stängts. Det tar upp till en minut om nätverket bröts. Om nätverket bröts under en överföring håller den först kvar överföringens plats i upp till 30 sekunder, inom den minuten, så att den här sidan kan ta tillbaka den när den ansluter igen."
          : "Ingenting, när den har märkt att anslutningen har stängts. Det tar upp till en minut om nätverket bröts. Om nätverket bröts under en överföring håller den först kvar överföringens plats i upp till 30 sekunder, inom den minuten, så att den här sidan kan ta tillbaka den när den ansluter igen.";
      }
      const choice = relay
        ? "Ditt val att tillåta vårt relä."
        : "Ditt val att inte tillåta vårt relä.";
      const counts = mailed
        ? " Antalet mejl den skickade åt dig, i förvrängd form, i upp till en timme."
        : "";
      if (links === 0) {
        return `Inga länkar ännu. ${choice}${counts}`;
      }
      const ids = links === 1 ? "ID:t för din länk" : `ID:na för dina ${links} länkar`;
      const email =
        emailed === 0
          ? ""
          : emailed === 1
            ? " För länken den mejlar: mottagarens e-postadress och koderna som skickas dit."
            : ` För de ${emailed} länkar den mejlar: mottagarnas e-postadresser och koderna som skickas dit.`;
      const key =
        sending === 0
          ? `${ids}, aldrig ${items[kind].unlocks}.${email}`
          : `${ids}.${email} Medan den skickar ett mejl också ${items[kind].key}, och ditt namn.`;
      const held = `${key} ${choice}${counts}`;
      if (connected === 0) {
        return held;
      }
      const who =
        connected === 1 ? "1 mottagare är ansluten" : `${connected} mottagare är anslutna`;
      return `${held} ${who} just nu.`;
    },
    recipientHolds: (tie: Tie, emailed: boolean, kind: Kind) =>
      (emailed
        ? {
            paired: `ID:t för din länk, din e-postadress, att den här fliken har angett rätt kod och att den här sidan är ansluten till avsändaren. Servern hade ${items[kind].unlocks} bara medan den mejlade länken till dig.`,
            unpaired:
              "Din e-postadress, som avsändaren angav för den här länken, den senaste koden den mejlade dig och om den här fliken har angett den. Bara avsändarens sida kan hålla kvar dem där.",
            closed:
              "Ingenting om den här sidan, när servern har märkt att anslutningen har stängts, utom om den här fliken har angett rätt kod. Det tar upp till en minut om nätverket bröts. Om nätverket bröts under överföringen håller den först kvar den här sidans plats i överföringen i upp till 30 sekunder, inom den minuten, så att sidan kan ta tillbaka den när den ansluter igen. Bara avsändarens sida kan hålla kvar det, din länks ID och din e-postadress där.",
          }
        : {
            paired: `ID:t för din länk, aldrig ${items[kind].unlocks}, och att den här sidan är ansluten till avsändaren.`,
            unpaired:
              "Ingenting som knyter den här sidan till din länk. Bara avsändarens sida kan hålla kvar din länks ID där.",
            closed:
              "Ingenting om den här sidan, när servern har märkt att anslutningen har stängts. Det tar upp till en minut om nätverket bröts. Om nätverket bröts under överföringen håller den först kvar den här sidans plats i överföringen i upp till 30 sekunder, inom den minuten, så att sidan kan ta tillbaka den när den ansluter igen. Bara avsändarens sida kan hålla kvar din länks ID där.",
          })[tie],
    passedOn: (messages: number, size: string, emailed: boolean) =>
      messages === 0
        ? "Inget ännu."
        : `${messages} ${messages === 1 ? "uppkopplingsmeddelande" : "uppkopplingsmeddelanden"} (${size}), alla krypterade så att servern inte kan läsa dem${emailed ? ", utom för en länk som den har mejlat och därför haft nyckeln till" : ""}.`,
    fileData: (kind: Kind) => `Inget. ${items[kind].The} går direkt mellan webbläsarna.`,
    fileDataRelayed: (kind: Kind) =>
      `Inget. Webbläsarna kunde inte ansluta direkt, så ${items[kind].the} går ${items[kind].encrypted} via vårt relä i stället.`,
    relaySeesLabel: "Vårt relä ser",
    relaySees: (kind: Kind) =>
      `Båda webbläsarnas IP-adresser och ${items[kind].seen}. Reläet kan inte låsa upp ${items[kind].the}.`,
    relayLogsLabel: "Vårt relä loggar",
    relayLogs: (kind: Kind) =>
      `Ingen logg över trafiken i vanliga fall. Bara när vi felsöker eller stoppar missbruk: anslutningstider, IP-adresser och hur mycket data som passerade, i högst 7 dagar. Aldrig namn, nycklar eller ${items[kind].data}. Medan det förnyar sitt certifikat loggar det också adresserna som når det på port 80, aldrig webbläsarnas, i ungefär fem veckor.`,
    relayKeepsLabel: "Vårt relä sparar",
    relayKeeps: (kind: Kind) =>
      `Ingenting av ${items[kind].the} när ${items[kind].it} har passerat. Loggrader som sparas när vi felsöker eller stoppar missbruk raderas inom 7 dagar.`,
    senderAfterwards: (online: boolean, mailed: boolean) =>
      `${
        online
          ? "När du stänger den här fliken glömmer servern dina länkar, inom högst en minut. Loggraderna finns kvar."
          : "Dina länkar försvinner från servern inom en minut efter att anslutningen stängdes. Loggraderna finns kvar."
      }${mailed ? " Det gör också antalet mejl den skickade åt dig, i förvrängd form, i upp till en timme." : ""}`,
    afterwardsRecipient: (emailed: boolean) =>
      emailed
        ? "När den här sidan kopplas från släpper servern det den har om sidan, inom högst en minut, utom det som kodkontrollen behöver: din e-postadress och om den här fliken har angett rätt kod finns kvar tills avsändarens sida stängs, och antalet koder som skickats till din adress och antalet koder som din IP-adress har bett om, båda i förvrängd form, i upp till en timme. Loggraderna finns kvar."
        : "När den här sidan kopplas från släpper servern det den har om sidan, inom högst en minut. Loggraderna finns kvar.",
    logs: (kind: Kind) =>
      `Vad som hände, till exempel att en länk öppnades, med ${new Intl.ListFormat("sv", {
        type: "conjunction",
      }).format(
        Object.entries(logFields)
          .filter(([field]) => field !== "event")
          .map(([, [what]]) => what),
      )}. Aldrig namn, nycklar, ${items[kind].data} eller IP-adresser.`,
  },
  footer: {
    file: "Skicka en fil",
    label: "Webbplats",
    tagline: "Filer krypteras i din webbläsare. Bara länken kan låsa upp dem.",
    about: "Om Fidant",
    terms: "Villkor",
    security: "Säkerhet",
    source: "Källkod",
    license: "Öppen källkod, MIT-licens",
  },
  preview: {
    receiveTitle: "Skickat till dig med Fidant",
    receiveDescription:
      "Öppna länken för att ta emot det. Det är krypterat hela vägen, och länken fungerar bara medan avsändarens sida är öppen.",
  },
  about: {
    title: "Om Fidant",
    lede: "Fidant är ett sätt att skicka en fil till någon utan att behöva lita på någon på vägen, inte heller på oss.",
    sections: [
      {
        heading: "Vem som driver det",
        body: [
          "Fidant är ett projekt med öppen källkod och har inget företag bakom sig ännu. Det är ett konceptbevis, inte en kommersiell tjänst.",
          "Det finns inga annonser, inga konton och ingen spårning.",
        ],
      },
      {
        heading: "Kontrollera själv",
        body: [
          "All kod som kör den här webbplatsen är öppen under MIT-licensen. Allt som står på integritets- och säkerhetssidorna går att kontrollera mot den, och du kan köra en egen kopia.",
        ],
        link: ["Koden på GitHub", "https://github.com/fidant-labs/fidant"],
      },
      {
        heading: "Kontakt",
        body: [
          "Frågor, fel och idéer hör hemma i projektets ärendelista. Ärenden är offentliga, så skriv aldrig filer, länkar eller personuppgifter där. Följ säkerhetssidan om du vill rapportera ett säkerhetsproblem.",
        ],
        link: ["Skapa ett ärende", "https://github.com/fidant-labs/fidant/issues"],
      },
    ] as Sections,
  },
  terms: {
    title: "Användarvillkor",
    lede: "Kort sagt: Fidant är gratis, levereras i befintligt skick och du ansvarar för det du skickar.",
    sections: [
      {
        heading: "I befintligt skick",
        body: [
          "Fidant är ett konceptbevis som erbjuds gratis och utan garantier. Tjänsten kan vara otillgänglig, ändras eller läggas ner när som helst. Lita inte på den som enda sätt att få fram en viktig fil.",
        ],
      },
      {
        heading: "Dina filer är dina",
        body: [
          "Filerna går mellan webbläsare, krypterade hela vägen. Vi har aldrig nyckeln, och vi sparar den aldrig, så vi kan inte återskapa, radera eller granska dina filer åt dig. Skicka bara filer som du har rätt att dela, och bara till dem du vill dela dem med.",
          "Använd inte Fidant till något olagligt.",
        ],
      },
      {
        heading: "Länkar",
        body: [
          "Den som har en länk kan öppna filen den leder till. Varje länk fungerar en gång, och bara medan avsändarens sida är öppen.",
        ],
      },
      {
        heading: "Ändringar",
        body: ["Villkoren kan ändras. Varje ändring syns i projektets offentliga historik."],
        link: ["Historiken för texten", "https://github.com/fidant-labs/fidant/commits/main"],
      },
    ] as Sections,
  },
  security: {
    title: "Säkerhet",
    lede: "Hur din fil skyddas, vad Fidant inte skyddar mot och hur du berättar för oss om ett problem.",
    sections: [
      {
        heading: "Så skyddas filen",
        body: [
          "Din webbläsare krypterar filen med AES-256-GCM innan den lämnar din dator. Nyckeln finns i den del av länken som står efter #. Den delen skickar webbläsare aldrig till någon server.",
          "Filen går direkt mellan de två webbläsarna. Om ett nätverk stoppar det och vårt relä är tillgängligt går den i stället krypterad via reläet. Mellan webbläsarna skickar vår server vidare några små meddelanden. De som kopplar upp anslutningen är krypterade så att servern inte kan läsa dem.",
          "Mottagarens webbläsare kontrollerar filens SHA-256-kontrollsumma, så en fil som ändrats eller skadats på vägen sparas inte.",
        ],
        link: ["Så fungerar det, steg för steg", "/how"],
      },
      {
        heading: "Det här skyddar den inte mot",
        body: [
          "Den som får tag på en länk kan öppna filen. Skicka varje länk bara till personen den är avsedd för, på ett sätt du litar på.",
          "Avsändarens namn skrivs av avsändaren och kontrolleras inte.",
          "De två webbläsarna ser varandras IP-adress, precis som i ett videosamtal. Varje webbläsare frågar vårt relä om sin offentliga adress, så reläet ser båda IP-adresserna och kan oftast se att de hör ihop, även när filen går direkt. När filen går via reläet ser det också ungefär hur stor filen är.",
          "Din webbläsare kör den kod vår server skickar. En server som skickade annan kod skulle kunna läsa filer, och hoppa över kontrollnumret. Koden är offentlig, men webbläsare kan ännu inte kontrollera att det de fick stämmer med den.",
          "En dator som redan är kapad kan läsa filen innan den krypteras eller efter att den låsts upp.",
          "Fidant har ännu inte granskats av någon oberoende part.",
        ],
      },
      {
        heading: "Rapportera en sårbarhet",
        body: [
          "Rapportera säkerhetsproblem privat via GitHub, inte i ett offentligt ärende. Vi svarar där.",
        ],
        link: [
          "Rapportera privat på GitHub",
          "https://github.com/fidant-labs/fidant/security/advisories/new",
        ],
      },
    ] as Sections,
  },
  // En läsarversion av docs/how-fidant-works.md, som är källan. Ändra båda tillsammans.
  technical: {
    sections: {
      parts: {
        heading: "Delarna",
        body: [
          "Fidant har tre delar. Webbappen körs i avsändarens och mottagarens webbläsare och sköter all kryptering. Vår server i Stockholm levererar webbappen och skickar vidare meddelanden för att koppla upp de två webbläsarna, över en WebSocket. Vårt relä, på en egen maskin i Stockholm, talar om för webbläsare vilken offentlig adress de har (STUN). Om avsändaren tillåter det och reläet är tillgängligt skickar reläet också vidare krypterad trafik (TURN). Det sker när två webbläsare inte har nått varandra direkt 3 sekunder efter att mottagaren har svarat.",
          "Det finns inga konton, ingen fillagring och ingen databas över personer eller överföringar. Servern har det den vet om sidor och överföringar bara i minnet. På disk har servern egna hemligheter, bland dem den som reläets hemlighet kommer från. Reläet har sin nuvarande och sin förra hemlighet i en liten databasfil.",
          "Allt är öppen källkod, så varje påstående på den här sidan går att kontrollera mot koden.",
        ],
        link: ["Koden på GitHub", "https://github.com/fidant-labs/fidant"],
      },
      link: {
        heading: "Länken",
        body: [
          "För varje mottagare skapar avsändarens webbläsare en länk av formen https://fidant.se/r/<länk-ID>#<hemlighet>. Länk-ID:t är 16 slumpmässiga byte och hemligheten 32 slumpmässiga byte, båda från webbläsarens kryptografiska slumptalsgenerator.",
          'Länk-ID:t är bara ett namn på länken: vår server använder det för att koppla ihop avsändaren med mottagaren. Hemligheten står i fragmentet, delen efter #, som webbläsare inte skickar till servrar. Webbplatsen säger också åt webbläsare att inte skicka sidans adress vidare till andra webbplatser. Appen skickar aldrig hemligheten någonstans. Den tar bara fram nycklar ur hemligheten och håller mottagarsidans första adress, med hemligheten, i minnet. Det gör att fältet "Gå tillbaka" kan föra dig tillbaka till en överföring som inte är klar. Länken i fältet har bara sökvägen; när du följer den hamnar hemligheten i adressfältet igen.',
          "Varje mottagare får ett eget länk-ID och en egen hemlighet, så en mottagares länk säger ingenting om någon annans.",
        ],
      },
      keys: {
        heading: "Nycklar",
        body: [
          "Två nycklar tas fram ur hemligheten med HKDF-SHA-256. Båda är AES-256-GCM-nycklar som webbläsaren markerar som icke-exporterbara: sidan kan använda dem men inte läsa ut dem.",
          "Signalnyckeln krypterar meddelandena för uppkopplingen. Dess salt är länk-ID:t.",
          "Filnyckeln krypterar varje ram mellan webbläsarna utom den första, INIT, som bara innehåller det slumpmässiga överförings-ID:t. Filnyckelns salt består av två slumpmässiga värden: det överförings-ID:t, som avsändaren väljer för varje försök, och ett försöks-ID som mottagarens sida väljer för varje ny anslutning. Därför använder varken en omstartad överföring eller en återuppspelad första ram samma nyckel och nonce två gånger.",
        ],
      },
      signal: {
        heading: "Så kopplas webbläsarna ihop",
        body: [
          "Avsändarens sida öppnar en WebSocket mot vår server och anmäler sina länk-ID:n. När mottagaren öppnar sin länk ansluter deras sida med länk-ID:t och ett slumpmässigt försöks-ID, nytt för varje sidladdning och varje nytt försök. Servern kopplar ihop högst en mottagarsida med en länk åt gången och meddelar båda sidor.",
          "Sedan sätter webbläsarna upp en WebRTC-anslutning. Erbjudandet, svaret och nätverkskandidaterna krypteras med signalnyckeln innan de når vår server. Varje meddelande är knutet till sin länk, sitt försök och sin riktning, så servern kan inte läsa eller ändra meddelandena. Servern kan inte heller skicka tillbaka ett meddelande till den sida som skickade det, flytta det till en annan länk eller spela upp det i ett annat försök. Att spela upp gamla meddelanden kan som mest få ett försök att misslyckas, vilket en server ändå kan åstadkomma genom att kasta dem.",
          "Det betyder mer än integritet: meddelandena innehåller fingeravtrycken för WebRTC:s egen DTLS-kryptering. Eftersom servern inte kan ändra dem kan den inte ställa sig mellan de två webbläsarna. Allt det här bygger på att vår server inte har nyckeln.",
          "Det är vad kontrollnumret är till för. Varje webbläsare gör ett nytt certifikat för varje anslutning. Mottagarens webbläsare skickar ett åtagande för sitt fingeravtryck, en hash, innan avsändarens webbläsare gör sitt erbjudande. Båda webbläsarna räknar sedan fram sex siffror ur de två fingeravtrycken i sin egen anslutning. Med någon emellan finns det två anslutningar, så de två skärmarna visar olika nummer. Tack vare åtagandet kan den som står emellan bara gissa: en chans på miljonen per anslutning. Numret visas bara på skärmen och skickas eller sparas aldrig.",
          "Med kontrollnummer läser mottagaren upp sitt nummer och avsändaren jämför. Ingenting om filen skickas förrän båda har sagt att det stämmer, och ”Det skiljer sig” på någon av sidorna stoppar försöket. När mottagarens webbläsare har svarat på ett erbjudande gör den en ny anslutning bara när mottagaren klickar på Försök igen. När en bruten väg återställs, som beskrivs nedan, behålls samma anslutning och samma nummer. Avsändarens sida slutar erbjuda en länk efter 5 försök som tog slut innan båda bekräftat, vart och ett begränsat till 5 minuter. Ett försök som avsändarens sida stoppade för att de två sidorna kör olika versioner räknas inte: inget kontrollnummer visades. Kontrollen visar att ingen satt mellan de två webbläsarna. Den kan inte visa att själva sidans kod är ärlig.",
          "Om anslutningen till vår server bryts försöker båda sidorna ansluta igen av sig själva. Avsändarens sida anmäler sina länkar på nytt. En mottagare som ännu höll på att ansluta försöker igen några gånger innan den ger upp. Under den första minuten efter att vår server har startat ber den en mottagare vars länk den ännu inte känner till att vänta. Då fortsätter mottagaren försöka medan avsändarens sida anmäler länken igen. En överföring som redan har börjat behöver inte vår server och fortsätter, så länge vägen mellan webbläsarna håller.",
          "Om vägen mellan de två webbläsarna bryts medan deras anslutning är öppen försöker sidorna få tillbaka en väg utan att börja om. Mottagarens sida skickar sin anslutningsbegäran till vår server igen, och servern ger båda sidorna uppgifterna för uppkopplingen på nytt. Avsändarens webbläsare söker sedan en väg igen på samma anslutning, med ett nytt erbjudande och svar, krypterade precis som de första och kontrollerade mot samma två certifikat. Nycklarna och kontrollnumret är desamma, och överföringen fortsätter där den stannade, utan något klick. Det här lägger aldrig till reläet på en anslutning som inte redan använde det. Om ingen väg kommer tillbaka inom 30 sekunder slutar försöket som en bruten anslutning, och Försök igen fortsätter nedladdningen av en fil. Det kräver att båda sidorna är anslutna till vår server. Ett byte av nätverk kan också bryta en sidas anslutning till vår server. När webbläsarnas anslutning har öppnats ger vår server varje sida ett slumpmässigt värde, och en sida vars anslutning till vår server bryts ansluter igen och tar tillbaka sin plats i överföringen med det. Vår server håller kvar platsen i upp till 30 sekunder efter att en anslutning brutits utan att stängas, och en sida som stängs släpper den direkt. Om sidan inte kommer tillbaka i tid slutar överföringen som en bruten anslutning. Den upprepade anslutningsbegäran visar vår server att överföringens anslutning bröts, och när. En sida som tar tillbaka sin plats visar den att sidans nya IP-adress hör till samma överföring. Vi har bara testat återställningen i Chromium, med en väg som var bruten i ungefär 6 till 8 sekunder. Firefox och Safari är otestade. Att ta tillbaka en plats har vi testat med en anslutning som bröts inne i webbläsaren, och i Chromium med en sida vars offentliga IP-adress byttes bakom en simulerad hemrouter mitt i en överföring. Ett riktigt byte av nätverk, till exempel från wifi till mobildata, är otestat.",
          "Det första meddelandet som varje webbläsare skickar för uppkopplingen anger vilken version av överföringsformatet sidan använder. Om versionerna skiljer sig kopplas webbläsarna inte ihop och ingenting om filen skickas. Sidor som har den här kontrollen säger då vilken av dem som behöver laddas om. Alla sidor i samma utgåva skickar samma version, så versionen avslöjar ingenting om överföringen.",
        ],
      },
      layers: {
        heading: "Två lager kryptering",
        body: [
          "WebRTC krypterar anslutningen mellan webbläsarna med DTLS. Fidant litar inte bara på det: varje ram efter INIT krypteras också med AES-256-GCM under filnyckeln, som bara de två webbläsarna har.",
          "Varje ram börjar med ett huvud på 10 byte med version, typ och löpnummer. Huvudet autentiseras tillsammans med ramen, och nonce byggs av riktningen och löpnumret, så de två riktningarna delar aldrig nonce. En webbläsare tar bara emot nästa löpnummer, så en ram som tappas, kastas om, upprepas eller ändras stoppar överföringen.",
        ],
      },
      frames: {
        heading: "Överföringen, ram för ram",
        body: [
          "När avsändaren väljer filen räknar webbläsaren ut dess SHA-256-kontrollsumma.",
          "INIT: avsändaren skickar överförings-ID:t. Det är den enda ramen som inte krypteras. Om den ändras blir filnyckeln en annan, och nästa ram går inte att dekryptera. Att spela upp den igen i ett senare försök fungerar inte heller, eftersom mottagarens nya försöks-ID ger en annan nyckel.",
          "CHECK: med kontrollnumret på, varje sidas svar, krypterat, när personen på den sidan har jämfört numren: stämmer eller skiljer sig. META väntar på båda svaren.",
          "META: filens namn, storlek och typ och det namn avsändaren skrev, krypterat. Mottagaren ser dem och väljer.",
          "ACCEPT eller DECLINE: mottagarens svar, krypterat. ACCEPT anger också var avsändaren ska börja: från början, eller efter det som hann komma fram innan en anslutning bröts. ACCEPT visar dessutom att mottagaren har nyckeln. Inga fildata skickas före det.",
          "CREDIT: hur många delar avsändaren får skicka, krypterat. Mottagaren ger 128 i taget och fler allteftersom de skrivs, så en långsam mottagare har aldrig mer än ungefär 6 MiB som väntar. En avsändare som kommer längre före än så stoppas.",
          "CHUNK: filen i lika stora ramar, högst 48 KiB var, från den punkt som ACCEPT anger.",
          "END: hela filens exakta storlek och kontrollsumman som räknades ut när filen valdes.",
          "RECEIPT: kontrollsumman som mottagaren räknade ut på det som kom fram. Avsändaren räknar filen som levererad först när den stämmer. Det är inget bevis för att filen kom fram: END innehåller redan kontrollsumman, så en modifierad mottagarsida, som ju har nyckeln, kan hoppa över alla delar och skicka tillbaka kontrollsumman.",
        ],
      },
      check: {
        heading: "Kontrollen av filen",
        body: [
          "Mottagarens webbläsare räknar kontrollsumman medan filen kommer fram och kontrollerar storleken, antalet delar, utfyllnaden och kontrollsumman mot END. Filen blir färdig först när allt stämmer. En ram som inte går att dekryptera, en kontrollsumma som inte stämmer eller någon annan kontroll som inte går igenom kastar det som har skrivits.",
          "En bruten anslutning som inte kommer tillbaka (se Så kopplas webbläsarna ihop) är något annat. Om varje ram hittills har gått igenom kontrollerna behåller mottagarens sida det som har kommit fram, i minnet eller i filen som mottagaren valde att spara till, och Försök igen fortsätter därifrån. Försök igen gör en ny anslutning med en ny nyckel. Om avsändaren erbjuder samma fil igen, där namn, storlek, typ, delstorlek och avsändarens namn är desamma, visar sidan inte erbjudandet eller någon sparadialog igen. Den talar om för avsändaren hur mycket den redan har, så bara resten skickas. Med kontrollnumret på jämförs numret ändå först. Kontrollsumman gäller hela filen, så om resten inte hör ihop med det som redan har kommit fram går kontrollen inte igenom. Ett annat erbjudande börjar från början, och det gör också en delad hemlighet. Bara den fliken kan fortsätta nedladdningen, och sidan kastar det som har kommit fram om överföringen slutar på något annat sätt. När fliken stängs eller laddas om försvinner det som låg i minnet. Vad webbläsaren då gör med en ofärdig fil från sparadialogen har vi inte testat än.",
          "Chromium-webbläsare på datorn, som Chrome och Edge, kan skriva filen direkt till en plats på disken som mottagaren väljer. Andra webbläsare samlar den i minnet och startar nedladdningen i slutet, och för en fil över 256 MiB varnas mottagaren först. Nedladdningen märks alltid som rena binärdata, vilken typ avsändaren än anger, så en fil kan inte köras som en webbsida på Fidants webbplats.",
          "Namn nekas om de innehåller styrtecken, radavgränsare, Unicodes styrtecken för textriktning, tomma utfyllnadstecken eller långa följder av mellanslag. Därför kan ett namn som slutar på .exe inte se ut att sluta på .pdf.",
        ],
      },
      padding: {
        heading: "Den exakta storleken döljs",
        body: [
          "Den som kan se den krypterade trafiken, till exempel nätverken på vägen eller vårt relä, ser hur stora ramarna är. Därför avrundas storleken uppåt med metoden Padmé, som lägger till högst 12 %, och sedan till hela delar. Alla ramar med fildata är lika stora, och utfyllnaden är nollor som mottagaren kontrollerar. En nedladdning som fortsätter efter en bruten anslutning skickar bara resten, i ramar av samma storlekar, så den som ser båda försöken kan lägga ihop dem till minst den avrundade storleken för en hel överföring, mer om några delar skickades två gånger.",
          "Den exakta storleken finns bara i de krypterade META och END. META är alltid lika stor, så inte heller filnamnets längd syns.",
          "En delad hemlighet är högst 32 KiB, och varje delad hemlighet fylls ut till exakt en del. Appen ser till det: om en anslutning bara tillåter meddelanden som är för små för en del på 32 KiB skickas hemligheten inte över den, och avsändaren ser att den inte skickades. Utan kontrollnummer skickas ingenting alls över en sådan anslutning. Med kontrollnummer jämför de två först numret, som för en fil, så den som har länken kan inte skilja en hemlighet från en fil innan båda har bekräftat. Med alla webbläsare vi testade i november 2026 (Chromium, Firefox och WebKit) är delen 48 KiB. Så varje delad hemlighet ser likadan ut på nätet, oavsett längd, och likadan som vilken fil som helst på upp till 48 KiB som skickas i ett försök. En fil vars nedladdning fortsätter efter ett avbrott behöver ibland ingen del alls i det nya försöket, vilket aldrig händer en delad hemlighet, eftersom den alltid börjar om.",
        ],
      },
      travel: {
        heading: "Så färdas filen",
        body: [
          "Båda webbläsarna börjar med bara vår STUN-tjänst, så WebRTC provar de direkta vägarna först, utan reläet. De direkta vägarna går över det lokala nätverket, eller via varje sidas offentliga adress, som webbläsaren får veta från vår STUN-tjänst. Filen går då direkt mellan webbläsarna. Avsändarens sida visar vilken väg varje anslutning tog.",
          "På båda de direkta vägarna visar varje webbläsares fråga vår STUN-tjänst dess offentliga IP-adress. De två webbläsarna frågar ungefär samtidigt, så vår STUN-tjänst kan oftast se vilka två adresser som hör ihop. Webbläsarna lägger till reläet om du tillåter det, reläet är tillgängligt och ingen anslutning har kommit till stånd 3 sekunder efter att mottagaren har svarat. Reläet kan då få veta att de två adresserna hör ihop.",
          "På alla vägar ser varje webbläsare den andras IP-adress, precis som i ett videosamtal.",
        ],
      },
      relaying: {
        heading: "När reläet används",
        body: [
          "När ingen direkt väg fungerar, vilket är vanligt på mobildata och kontorsnätverk, går trafiken via vårt TURN-relä i Stockholm. Webbläsarna lägger till reläet bara om avsändaren tillåter det, om reläet är tillgängligt och om ingen anslutning har kommit till stånd 3 sekunder efter att mottagaren har svarat. En sida som öppnades innan vi började lägga till reläet på det här sättet reserverar fortfarande reläadresser från början, tills den laddas om.",
          "För att lägga till reläet börjar webbläsarna koppla upp på nytt, med ett nytt erbjudande och svar, krypterade precis som de första. En direkt väg kan fortfarande vinna efter det. En anslutning som behöver reläet kommer alltså i gång ungefär 3 sekunder senare. En direkt väg som ännu inte är uppkopplad 3 sekunder efter att mottagaren har svarat, till exempel på ett nätverk som tappar många paket, kan hamna på reläet.",
          "Reläet för vidare krypterade paket. Det kan inte dekryptera dem och sparar dem inte.",
          "För att använda reläet behöver en webbläsare inloggningsuppgifter, som vår server skapar varje gång den kopplar ihop två sidor, och på nytt varje gång en mottagares sida frågar igen efter en bruten väg, och bara ger till de två ihopkopplade sidorna. Med dem kan en reläanslutning starta i 5 minuter, och den kan sedan pågå längre. Vår server kontrollerar varje minut att reläet kan föra vidare trafik och erbjuder det när en kontroll lyckas. Servern slutar erbjuda det efter två misslyckade kontroller i rad. Reläet får hemligheten bakom inloggningsuppgifterna från vår server, förseglad så att bara reläet kan öppna den.",
          "Webbläsare når reläet över UDP, eller över TLS på port 443 där ett nätverk bara släpper igenom webbtrafik. Reläet skickar bara vidare över UDP, och bara från sin egen adress. Det vägrar skicka till andra datorer på privata eller interna nätverk, med ett godtaget undantag: reläets egen server (se beslut 0007). Det begränsar också hur många anslutningar som går via det samtidigt.",
          "När den uppskattade kostnaden för vår trafik under månaden når vår budget stängs reläet och vår STUN-tjänst av. De förblir avstängda till månadens slut, om vi inte slår på dem igen tidigare, till exempel genom att höja budgeten. Till dess kan en ny överföring bara ansluta där den klarar sig utan dem, till exempel på samma lokala nätverk, och misslyckas ofta annars.",
        ],
      },
      norelay: {
        heading: "Att neka reläet",
        body: [
          'Avsändaren kan bocka ur "Använd vårt relä vid behov". Vår server ger då inga inloggningsuppgifter till reläet för den sändningen, bara STUN-adressen, så en omodifierad webbläsare kan inte använda reläet. Avsändarens webbläsare upprätthåller också själv valet: den startar anslutningen utan inloggningsuppgifter till reläet, vad vår server än skickar. Som extra skydd avslutar avsändarens webbläsare anslutningen om den ändå ser att den går via reläet. Det extra skyddet är inte heltäckande: en modifierad mottagare kan dölja att dess sida går via ett relä.',
          "Gränsen: en modifierad mottagare kan ändå skicka sin del via vårt relä med uppgifter från en annan ihopkoppling, eller via vilket offentligt relä som helst. Den mottagaren har ju nyckeln ändå. Valet avgör vilken infrastruktur som bär den krypterade trafiken, inte vem som kan läsa filen.",
        ],
      },
      recipients: {
        heading: "Flera mottagare och engångslänkar",
        body: [
          "En sändning kan gå till upp till 256 personer. Var och en har en egen länk, nyckel, anslutning och överföring.",
          "En länk räknas som använd först när mottagarens RECEIPT stämmer. Därefter nekas den. En länk som redan är ansluten i en flik nekas i en annan, och så gör en länk som har haft 10 anslutningsförsök under den pågående perioden på 30 sekunder. En mottagares sida som frågar igen efter en bruten väg räknas som ett försök, men behåller sin anslutning om den nekas.",
          "Fram till dess kan länken öppnas igen: efter att mottagaren tackat nej, efter en bruten anslutning eller efter en misslyckad kontroll. Efter en bruten anslutning fortsätter Försök igen i samma flik en fils nedladdning där den avbröts, om det går. Varje nytt försök har ett nytt överförings-ID och ett nytt försöks-ID, och därmed en ny filnyckel. En länk med kontrollnummer slutar fungera efter 5 försök som tog slut innan båda hade bekräftat numret. Ett försök som avsändarens sida stoppade för att de två sidorna kör olika versioner räknas inte.",
          "Ingenting sparas, så en länk fungerar bara medan avsändarens sida är öppen. När den stängs glömmer vår server dess länkar inom en minut.",
        ],
      },
      secret: {
        heading: "Att dela en hemlighet",
        body: [
          "Sidan Dela en hemlighet skickar en hemlighet som avsändaren skriver eller klistrar in. Den delade hemligheten skickas på samma sätt som en fil: samma nycklar, ramar, kontroller och engångslänkar. Ingenting sparas, så avsändarens sida måste vara öppen tills varje mottagare har fått den delade hemligheten.",
          "Avsändarens webbläsare gör om den delade hemligheten till en fil som bara finns i minnet, med ett fast namn och en typ som visar att det är en delad hemlighet. Precis som för en fil finns namnet och typen bara i den krypterade META. En delad hemlighet kan ha upp till 10 000 tecken, vilket är högst 30 000 byte.",
          "Textrutan säger åt webbläsaren att stänga av stavningskontroll, autokorrigering, automatisk stor bokstav, autofyll, skrivförslag och översättning för den.",
          "Mottagarens webbläsare behandlar ett erbjudande som en delad hemlighet bara om det har exakt den typen och är högst 32 KiB. Allt annat erbjuds som en fil. För en delad hemlighet ser mottagaren namnet som avsändaren skrev men inte storleken, och väljer Visa eller Tacka nej. Efter Tacka nej fungerar länken fortfarande.",
          "Visa håller den delade hemligheten i webbläsarens minne, aldrig i en sparadialog eller en nedladdning. Först när kontrollerna mot END stämmer avkodas den och visas, som ren text med översättning avstängd. Sidan lägger in den som text och tolkar den aldrig som HTML. Den ligger inte i ett formulärfält, vars innehåll en webbläsare kan spara med sessionen. Knappen Kopiera hemligheten lägger den i urklippet.",
          "Vår server och vårt relä hanterar en delad hemlighet som vilken fil som helst. När sidan Dela en hemlighet laddas från vår server, genom att någon skriver adressen, laddar om sidan eller följer en länk, kan vår server se att någon har öppnat den. Sidan öppnar sedan en signaleringsanslutning som varje avsändarsida gör, och när man går till den inne i appen öppnas också en. Servern får aldrig den delade hemligheten eller dess längd, och en anslutning säger inte vilken sida som öppnade den. Men efter en full laddning kan servern koppla anslutningen som följer från samma adress till besöket. Då kan servern dra slutsatsen att den som besöker sidan delar en hemlighet, och med hur många länkar. En full laddning av någon annan sida kan också avslöja att besökaren delar en hemlighet. Varje avsändarsida ansluter när den visas första gången och förblir ansluten medan fliken är öppen. Om två avsändaranslutningar är öppna samtidigt från samma adress, utan någon sidladdning mellan dem, har besökaren alltså troligen öppnat både sidan Skicka en fil och sidan Dela en hemlighet i samma flik. Efter en full laddning av sidan Skicka en fil kommer den andra anslutningen från sidan Dela en hemlighet. Sidvisningar loggas inte.",
        ],
      },
      site: {
        heading: "Själva webbplatsen",
        body: [
          "Webbplatsen levereras bara över HTTPS, och webbläsare får besked om att aldrig använda vanlig HTTP för den. Att skicka och ta emot går inte utan en säker anslutning.",
          "En Content Security Policy låter sidorna hämta kod, stilar, typsnitt och anslutningar bara från vår egen webbplats och hindrar andra webbplatser från att visa dem i en ram. Det finns inga cookies, inga skript från tredje part och ingen spårning.",
          "WebSocketen för uppkopplingen nekar anslutningar som öppnas från andra webbplatser. Gränser skyddar servern mot överbelastning: antal anslutningar totalt och per adress, meddelanden per anslutning, kopplingar per länk, länkar per avsändare och storleken på varje meddelande.",
        ],
      },
      limits: {
        heading: "Det här skyddar den inte mot",
        body: [
          "Länken är nyckeln. Den som får tag på en länk kan öppna filen eller den delade hemligheten bakom den tills länken har använts. Skicka varje länk bara till personen den är avsedd för, på ett sätt du litar på.",
          "Din webbläsare kör den kod vår server skickar. En server som skickade annan kod skulle kunna läsa filer, och hoppa över kontrollnumret. Koden är offentlig, men webbläsare kan ännu inte kontrollera att det de fick stämmer med den.",
          "Avsändarens namn skrivs av avsändaren och kontrolleras inte.",
          "Den andra webbläsaren ser din IP-adress. Varje webbläsare frågar vårt relä om sin offentliga adress, så reläet ser båda IP-adresserna och kan oftast se att de hör ihop. Nätverken på vägen, och vårt relä när filen går via det, ser också när överföringen sker och ungefär hur stor filen är. Vår server ser båda IP-adresserna, vilken mottagare som ansluter till vilken avsändare och när, och hur många mottagare en avsändare har. Om en överförings anslutning bryts och mottagarens sida frågar vår server igen ser servern det också, och när. Om en sidas anslutning till vår server bryts och sidan tar tillbaka sin plats ser servern att den nya IP-adressen hör till samma överföring. Så den får veta vem som skickar till vem, men inte vad.",
          "Skadlig kod på någon av datorerna kan läsa filen innan den krypteras eller efter att den dekrypterats.",
          "När mottagaren kopierar en delad hemlighet hamnar den i enhetens urklipp, där urklippshistorik, synkning av urklippet till andra enheter och andra appar kan läsa den. När en delad hemlighet väl har visats kan Fidant inte nå den: den går varken att ta tillbaka eller radera.",
          "Fidant har ännu inte granskats av någon oberoende part.",
        ],
      },
      planned: {
        heading: "Planerat: verifierade överföringar",
        body: [
          "Inte byggt ännu. Planen: mottagaren skriver under ett kvitto med BankID innan filen går att öppna, och kvittot namnger filen. Nyckeln delas, och vår server lämnar ut sin halva först när kvittot är underskrivet. Händelser hamnar i en granskningslogg där manipulation syns, förankrad med betrodda tidsstämplar.",
          "När det finns beskriver den här sidan det som ett nytt läge.",
        ],
        link: [
          "Designbesluten på GitHub",
          "https://github.com/fidant-labs/fidant/tree/main/docs/decisions",
        ],
      },
    } satisfies Record<string, Section>,
    modes: {
      send: {
        heading: "Vad som skickas",
        items: {
          file: {
            heading: "En fil",
            body: "Vilken fil som helst. Namn, storlek och typ skickas krypterade, och mottagaren ser dem och väljer att ladda ner filen eller tacka nej.",
          },
          secret: {
            heading: "En delad hemlighet",
            body: "Upp till 10 000 tecken som avsändaren skriver eller klistrar in, till exempel ett lösenord. Den skickas som en fil, utfylld till en fast storlek, och mottagarens sida visar den som text och laddar aldrig ner den.",
          },
        },
      },
      link: {
        heading: "Hur länken når mottagaren",
        items: {
          link: {
            heading: "Avsändaren skickar den vidare",
            body: "Avsändaren kopierar varje länk och skickar den själv, till exempel i en chatt eller ett mejl. Nyckeln i länken når aldrig vår server.",
          },
        },
      },
      route: {
        heading: "Vägen trafiken tar",
        items: {
          local: {
            heading: "Direkt, på samma nätverk",
            body: "När båda webbläsarna är på samma lokala nätverk ansluter de över sina lokala adresser. Filen går direkt mellan dem, och vår server och vårt relä ser ingenting av den. Varje webbläsare frågar ändå vår STUN-tjänst om sin offentliga adress. Ett test i vår testsvit sätter båda webbläsarna på ett simulerat nätverk och kontrollerar att de ansluter över sina lokala adresser och att inget lämnar det nätverket utom webbläsarnas anslutningar till vår server och deras STUN-frågor.",
          },
          stun: {
            heading: "Direkt, via offentliga adresser",
            body: "Varje webbläsare frågar vår STUN-tjänst om sin offentliga adress. Filen går sedan direkt mellan webbläsarna över internet.",
          },
          relay: {
            heading: "Via vårt relä",
            body: "När ingen anslutning har kommit till stånd 3 sekunder efter att mottagaren har svarat och reläet är tillgängligt, lägger webbläsarna till vårt TURN-relä i Stockholm. Om inte en direkt väg ändå vinner går den krypterade trafiken sedan via reläet, över UDP eller över TLS på port 443. Reläet för vidare paket som det inte kan dekryptera och sparar dem inte.",
          },
          norelay: {
            heading: "Reläet nekat",
            body: "Avsändaren kan neka vårt relä för en sändning. Vår server ger då inga inloggningsuppgifter till reläet, och en anslutning utan direkt väg misslyckas.",
          },
        },
      },
    },
    glossary: {
      webrtc: [
        "WebRTC",
        "Tekniken som finns i alla moderna webbläsare för att koppla ihop två webbläsare direkt, mest känd från videosamtal. Fidant använder den för att skicka filen mellan webbläsarna. Orden nedan är dess delar, och de som Fidant lägger till.",
      ],
      signaling: [
        "Signalering",
        "Att skicka meddelandena för uppkopplingen mellan två webbläsare innan de når varandra. WebRTC lämnar det till appen. Fidant skickar dem via vår server, krypterade så att servern inte kan läsa eller ändra dem.",
      ],
      websocket: [
        "WebSocket",
        "En bestående anslutning åt båda hållen mellan en sida och en server. Fidants sidor håller en öppen mot vår server för att skicka meddelandena för uppkopplingen.",
      ],
      sdp: [
        "Erbjudande och svar",
        "Meddelandena som beskriver varje sida av en WebRTC-anslutning, bland annat fingeravtrycket för dess DTLS-certifikat. Avsändarens webbläsare gör erbjudandet och mottagarens webbläsare svaret.",
      ],
      ice: [
        "Kandidater",
        "Adresserna där en webbläsare kanske kan nås: på det lokala nätverket, dess offentliga adress eller en adress på ett relä. De två webbläsarna byter kandidater och provar par av dem tills ett fungerar. WebRTC kallar den här processen ICE.",
      ],
      stun: [
        "STUN",
        "En tjänst som talar om för en webbläsare vilken offentlig adress den har: adressen som internet ser när webbläsaren sitter bakom en router. Vår STUN-tjänst körs på samma maskin som vårt relä.",
      ],
      turn: [
        "TURN",
        "Ett relä som för vidare trafiken mellan två webbläsare som inte når varandra direkt. Vårt relä är en TURN-server. Det för vidare krypterade paket som det inte kan läsa.",
      ],
      dtls: [
        "DTLS",
        "Krypteringen som WebRTC alltid lägger på anslutningen mellan två webbläsare, ungefär som TLS som HTTPS använder. Varje webbläsare kontrollerar den andras certifikat mot fingeravtrycket i erbjudandet eller svaret.",
      ],
      channel: [
        "Datakanal",
        "En WebRTC-anslutning som bär data i stället för ljud och bild. Fidant skickar sina ramar över en sådan.",
      ],
      aes: [
        "AES-256-GCM",
        "Krypteringen som Fidant lägger till ovanpå DTLS, med en nyckel på 256 bitar. Den upptäcker också varje ändring av det den krypterat.",
      ],
      hkdf: [
        "HKDF-SHA-256",
        "Ett standardsätt att ta fram flera nycklar ur en hemlighet. Fidant tar fram signalnyckeln och filnyckeln ur hemligheten i länken.",
      ],
      sha: [
        "SHA-256",
        "En kontrollsumma: varje ändring av en fil, hur liten den än är, ger ett helt annat värde. Mottagarens webbläsare jämför filens kontrollsumma med avsändarens.",
      ],
      nonce: [
        "Nonce",
        "Ett tal som aldrig får användas två gånger med samma nyckel. Fidant bygger det av riktningen och ramens löpnummer.",
      ],
      fragment: [
        "Fragment",
        "Delen av en adress efter tecknet #. Webbläsare skickar den inte till servrar, så det är där länken har sin hemlighet.",
      ],
      padme: [
        "Padmé",
        "Ett sätt att avrunda en storlek uppåt så att den bara syns ungefär. Det lägger till högst 12 %.",
      ],
      hmac: [
        "HMAC",
        "En kontrollsumma gjord med en nyckel. Bara den som har nyckeln kan göra eller kontrollera den.",
      ],
    },
    linkRisks: {
      heading: "Vem som kan se nyckeln",
      body: ["Vem mer som kan se nyckeln beror på kanalen som länken skickas i."],
      columns: ["Hur länken skickas", "Vem mer som kan se nyckeln", "Det här begränsar risken"],
      rows: [
        [
          "Avsändaren skickar den vidare",
          "Den som kan läsa kanalen avsändaren använder, till exempel chatt- eller mejltjänsten.",
          "Länken fungerar bara tills dess fil har levererats, och bara medan avsändarens sida är öppen. Skicka varje länk bara till personen den är avsedd för, på ett sätt du litar på.",
        ],
      ],
    },
    protect: {
      heading: "Så skyddar Fidant dig",
      body: ["De tidigare stegen förklarar varje del."],
      columns: ["Risken", "Det här gör Fidant"],
      rows: [
        [
          "Vår server eller vårt värdföretag läser filen",
          "Filen krypteras i din webbläsare med en nyckel ur den del av länken som står efter #. Den delen skickar webbläsare aldrig till en server. Bara den som har länken kan dekryptera filen. Allt detta bygger på att koden vi levererar är den publicerade koden (se Det här skyddar den inte mot).",
        ],
        [
          "Vår server ställer sig mellan de två webbläsarna",
          "Meddelandena för uppkopplingen är krypterade och knutna till sin länk, sitt försök och sin riktning. De innehåller fingeravtrycken för WebRTC-krypteringen, som servern därför inte kan byta mot sina egna.",
        ],
        [
          "Nätverken på vägen eller vårt relä läser trafiken",
          "Två lager kryptering: WebRTC:s DTLS, och AES-256-GCM under en filnyckel som bara de två webbläsarna har, ny för varje försök.",
        ],
        [
          "Trafiken avslöjar filnamnet, den exakta storleken eller en hemlighets längd",
          "Namn, typ och storlek skickas bara krypterade, i en ram med fast storlek. En fil fylls ut så att storleken bara syns ungefär, och varje delad hemlighet fylls ut till samma enda del.",
        ],
        [
          "En del av filen ändras, tappas, upprepas eller kastas om",
          "Varje ram är autentiserad och numrerad, och mottagaren kontrollerar storleken och SHA-256-kontrollsumman. En ram eller kontrollsumma som inte stämmer stoppar överföringen och kastar det som har skrivits.",
        ],
        [
          "En länk öppnas två gånger, eller av någon annan efter leveransen",
          "En länk nekas när dess fil har levererats, och i en andra flik medan en flik är ansluten till den.",
        ],
        [
          "En fil som utger sig för något annat genom sitt namn, eller som körs som en sida",
          "Namn som döljer sin verkliga ändelse med tecken för textriktning nekas, och nedladdningar är alltid rena binärdata.",
        ],
        [
          "En delad hemlighet blir kvar i webbläsaren",
          "Hos mottagaren laddas den aldrig ner och läggs aldrig i ett formulärfält, och översättning är avstängd. Avsändarens textruta säger åt webbläsaren att hålla stavningskontroll, autokomplettering, skrivförslag och översättning borta från den. Den delade hemligheten kan ändå bli kvar på två sätt: en webbläsare kan spara avsändarens textruta med sessionen, och en kopierad hemlighet ligger kvar i urklippet (se Det här skyddar den inte mot).",
        ],
        [
          "Data som blir kvar på våra maskiner",
          "Inga konton, ingen fillagring och ingen databas över personer eller överföringar. Servern har det den vet om sidor bara i minnet och glömmer en sida inom en minut efter att sidan kopplat ner. Serverns loggar har fasta fält och innehåller aldrig namn, nycklar, filinnehåll eller IP-adresser. De raderas efter 30 dagar. Reläet för som standard ingen logg över trafiken. Medan reläet förnyar sitt certifikat loggar det adresserna som når det på port 80, aldrig webbläsarnas, och sparar dem i ungefär fem veckor.",
        ],
        [
          "Spårning, eller kod från andra webbplatser",
          "Bara HTTPS, inga cookies, inga skript eller spårare från tredje part, och en Content Security Policy som bara tillåter kod från vår egen webbplats.",
        ],
        [
          "Du vill inte att din trafik går via vårt relä",
          "Bocka ur reläet för den sändningen. Vår server ger då inga inloggningsuppgifter till reläet, och avsändarens webbläsare avslutar en anslutning som den ser går via det.",
        ],
      ],
    },
    explorer: {
      heading: "Se vad din överföring lämnar efter sig",
      body: [
        "Välj hur du skickar, så ser du varje plats som sparar ett spår av det: vad den sparar och hur länge. Platser som din väg inte använder säger det.",
      ],
      questions: {
        what: { legend: "Vad skickar du?", options: { file: "En fil", secret: "En hemlighet" } },
        link: {
          legend: "Hur når länken mottagaren?",
          options: { self: "Jag skickar den själv" },
        },
        route: {
          legend: "Vilken väg tar den krypterade trafiken?",
          options: {
            direct: "Direkt, med vårt relä tillåtet",
            relay: "Via vårt relä",
            norelay: "Direkt, med vårt relä avböjt",
          },
        },
      },
      kept: "Sparas",
      never: "Aldrig",
      notUsed: "Ingår inte i den här vägen.",
      link: ["Alla loggfält, på integritetssidan", "/privacy"] as readonly [string, string],
      places: {
        sender: {
          name: "Din webbläsare",
          kept: "Mest tills du stänger fliken",
          never: "Fidant sparar ingen fil, hemlighet, länk eller nyckel på din enhet.",
          lines: [
            [
              "",
              "Länkarna, deras nycklar och överföringarna, bara i den här flikens minne, tills du stänger den.",
            ],
            [
              "",
              "En länk du kopierar, i ditt urklipp tills du kopierar något annat. Urklippshistorik, synkade urklipp och andra appar kan spara den längre.",
            ],
            [
              "file",
              "Din fil ligger kvar där den är. Sidan läser den för att kryptera den och kopierar den ingenstans.",
            ],
            [
              "secret",
              "Hemligheten, i sin textruta tills du stänger fliken. Webbläsaren kan också spara den med sessionen, för att återställa den efter en krasch eller en återöppnad flik.",
            ],
            [
              "",
              "Flikens ikon som den senast var, en grön prick medan en överföring pågick, en bock när den var klar eller en röd stoppskylt där sidan behövde en säker anslutning, bland webbläsarens sparade webbplatsikoner, bredvid historikposten för varje sida fliken visade, tills du rensar historiken.",
            ],
            ["", "Ditt val av tema och språk, i webbläsarens lokala lagring, tills du rensar den."],
            [
              "",
              "Om du tillåter notiser: en notis för varje leverans, som din enhets notislista visar och sparar. Den säger bara om en fil eller en hemlighet skickades och hur många länkar som har levererat, aldrig ett filnamn, en persons namn, en länk eller en nyckel.",
            ],
            [
              "direct,relay",
              "Så länge vårt relä är tillgängligt: inloggningsuppgifter till reläet, gjorda för det här paret av webbläsare, i minnet medan sidan är öppen. Med dem kan en reläanslutning starta i 5 minuter.",
            ],
            [
              "",
              "När en mottagares anslutning öppnas: ett slumpmässigt värde från vår server för den länken, bara i den här flikens minne, så att sidan kan ta tillbaka sin plats om dess anslutning till vår server bryts. Ett nytt ersätter det varje gång sidan tar tillbaka sin plats. Det finns kvar tills sidans nästa anslutning till vår server använder det, länken ansluter igen eller du stänger fliken.",
            ],
          ],
        },
        channel: {
          name: "Där du klistrar in länken",
          kept: "Så länge den tjänsten sparar meddelanden",
          never: "Fidant ser aldrig det meddelandet.",
          lines: [
            [
              "self",
              "Hela länken, nyckeln också, i den chatt-, mejl- eller meddelandetjänst du skickar den med. Tjänstens förhandsvisning av länken kan öppna adressen men får aldrig nyckeln, som står efter #.",
            ],
          ],
        },
        server: {
          name: "Vår server, i minnet",
          kept: "Medan sidorna är öppna, och upp till en minut efter",
          never: "Din fil, dess namn, storlek eller typ, eller hemligheten eller dess längd.",
          lines: [
            [
              "",
              "Båda IP-adresserna, länkens ID och vilken sida som är ihopkopplad med vilken länk.",
            ],
            [
              "",
              "Krypterade uppkopplingsmeddelanden passerar och sparas inte. Den kan inte läsa dem.",
            ],
            [
              "direct,relay",
              "Så länge vårt relä är tillgängligt skapar den inloggningsuppgifter till reläet för det här paret av webbläsare, som en reläanslutning kan starta med i 5 minuter, och skickar dem till båda sidorna utan att spara dem. Den skapar nya varje gång mottagarens sida frågar igen efter en bruten väg.",
            ],
            [
              "",
              "När webbläsarnas anslutning öppnas: ett slumpmässigt värde för varje sida, så att en sida vars anslutning till vår server bryts kan ta tillbaka sin plats i överföringen. Om en sidas anslutning bryts utan att stängas: sidans plats, i upp till 30 sekunder. Värdena skrivs aldrig till loggen.",
            ],
          ],
        },
        proxy: {
          name: "Vår frontproxy",
          kept: "Medan någon anslutning från den är öppen, och upp till 2 minuter efter att den sista stängts",
          never:
            "Något av det den för vidare: den dekrypterar inte trafiken. Den loggar ingenting.",
          lines: [
            [
              "",
              "Varje IP-adress som ansluter (för IPv6 dess /64-block) och hur många anslutningar den har, i minnet.",
            ],
          ],
        },
        caddy: {
          name: "Vår webbserver (Caddy)",
          kept: "Ingen åtkomstlogg. Dess egen logg: 30 dagar",
          never: "Delen av länken efter #, som webbläsare aldrig skickar.",
          lines: [
            [
              "",
              "Den dekrypterar HTTPS och ser därför, bara i minnet, varje förfrågans sökväg (som /r/ med länkens ID), varje webbläsares IP-adress och alla meddelanden sidorna skickar till vår server. Uppkopplingsmeddelandena förblir krypterade.",
            ],
            [
              "",
              "Dess egen logg, om uppstart, går till systemets journal. Den har ingen åtkomstlogg, och dess fel- och TLS-loggar är avstängda.",
            ],
          ],
        },
        log: {
          name: "Vår serverlogg",
          kept: "30 dagar",
          never: "Namn, nycklar, IP-adresser eller filinnehåll.",
          lines: [
            [
              "",
              "Korta rader med en fast lista med fält: att en avsändare registrerade sig och hur många länkar, att en mottagare anslöt eller nekades och varför, storleken på varje uppkopplingsmeddelande och vilken väg anslutningen tog. En länk syns bara med sina 6 första tecken.",
            ],
            [
              "",
              "Att en mottagare lämnade, och att din sida stängdes, med hur många länkar den hade.",
            ],
            [
              "direct,relay",
              "Om vårt relä är tillgängligt och webbläsarna fortfarande inte är anslutna 3 sekunder efter att mottagaren svarat, lägger de till reläet. Det ger rader för ytterligare ett dussintal uppkopplingsmeddelanden, som antyder att du tillät reläet.",
            ],
            ["norelay", "Om din sida ändå ser en anslutning via reläet: att den avslutade den."],
            [
              "",
              "Om vägen mellan webbläsarna bryts under överföringen och mottagarens sida frågar vår server igen: ytterligare en rad om att en mottagare anslöt, eller om att den nekades som upptagen om länken hade haft 10 anslutningsförsök under den halvminuten, eller, om avsändaren just hade gett upp, en om att den anslöt och en om att avsändaren nekade den, och rader för de nya uppkopplingsmeddelandena. Tillsammans visar de att den här länkens anslutning bröts, och när. De visar inte varför, på vems sida eller om den kom tillbaka.",
            ],
            [
              "",
              "Om en sidas anslutning till vår server bryts under överföringen och sidan ansluter igen: en rad om att den tog tillbaka sin plats, eller om att den nekades. Den visar att en sidas anslutning bröts, och när, men inte vems.",
            ],
          ],
        },
        relay: {
          name: "Vårt relä",
          kept: "Inget när trafiken har passerat. En tillfällig logg, bara om vi slår på en: högst 7 dagar",
          never:
            "Nyckeln, filen eller hemligheten. Reläet kan inte låsa upp något av det som passerar.",
          lines: [
            [
              "",
              "Varje webbläsares publika IP-adress, när webbläsaren frågar efter den. De två webbläsarna frågar ungefär samtidigt, så reläet kan oftast se vilka två adresser som hör ihop.",
            ],
            [
              "direct",
              "Om vårt relä är tillgängligt och webbläsarna fortfarande inte är anslutna 3 sekunder efter att mottagaren svarat: båda IP-adresserna tillsammans, även om en direkt väg vinner till slut. Båda webbläsarna reserverar då en reläadress. Bara din gör det om mottagarens webbläsare redan var ansluten när din sidas begäran om att lägga till reläet kom fram. Reläet kan få veta båda IP-adresserna i båda fallen.",
            ],
            [
              "relay",
              "Båda IP-adresserna, och den krypterade trafiken, som det skickar vidare och inte sparar.",
            ],
            [
              "",
              "Om vägen mellan webbläsarna bryts och de söker en ny kan var och en fråga efter sin publika IP-adress igen.",
            ],
            [
              "direct,relay",
              "Om vägen bryts efter att webbläsarna har lagt till reläet, och vårt relä fortfarande är tillgängligt, får de nya inloggningsuppgifter och kan reservera reläadresser igen. Webbläsare som aldrig lade till reläet lägger inte till det då heller.",
            ],
            ["relay file", "Filens storlek, bara ungefär."],
            ["relay secret", "Inte hemlighetens längd: varje hemlighet är lika stor på nätet."],
            [
              "",
              "Ingen logg över trafiken. Vi slår bara på en för att rätta ett fel eller stoppa missbruk, i högst 7 dagar, med anslutningstider, IP-adresser och datamängder.",
            ],
            [
              "",
              "Medan reläet förnyar sitt certifikat, några sekunder ungefär varannan månad, loggar det adresserna som når det på port 80. De kommer från Let's Encrypts kontroller och skannrar på internet, aldrig från webbläsare, och raderas inom ungefär fem veckor.",
            ],
            [
              "",
              "Sin egen nuvarande och förra hemlighet, som inte innehåller några spår av din överföring.",
            ],
          ],
        },
        relayCap: {
          name: "Vår mätning av månadens trafik",
          kept: "Upp till 15 månader; hos vårt värdföretag 455 dagar",
          never:
            "Vilken överföring trafiken hör till, IP-adresser, nyckeln, filen eller hemligheten.",
          lines: [
            [
              "",
              "Sidorna din webbläsare hämtar, meddelandena den utbyter med vår server och dess frågor till vårt relä. De räknas ihop med all annan trafik genom dem, så att vi kan stänga av reläet när den uppskattade kostnaden når vår budget.",
            ],
            [
              "relay",
              "Din överförings krypterade storlek, avrundad uppåt, räknas in i trafiken för reläet som bar den. Vi sparar månadens summor för vår server och vårt relä var 5:e minut, så på ett lugnt relä kan steget mellan två sparade värden motsvara din överförings storlek och tid.",
            ],
            [
              "",
              "Månadens summor tills nästa månad börjar, och deras senaste 100 versioner, som täcker ungefär 8 timmar.",
            ],
            [
              "",
              "Månadens summa som den såg ut var 5:e minut, i 63 dagar, och varje timme, i 15 månader. Mätningens egen logg sparar den i 30 dagar.",
            ],
            [
              "",
              "Vårt värdföretag, Amazon Lightsail, sparar hur mycket trafik vår server och vårt relä har burit, i 455 dagar.",
            ],
          ],
        },
        recipient: {
          name: "Mottagarens webbläsare",
          kept: "Mest tills fliken stängs",
          never:
            "Fidant sparar ingen nyckel på deras enhet, utöver det webbläsaren sparar med sin historik: länken och flikens ikon som sparas för den.",
          lines: [
            [
              "",
              "Länken, nyckeln också, i webbläsarens historik som vilken adress som helst. Din sida nekar länken när leveransen är klar, och länken fungerar bara medan din sida är öppen.",
            ],
            [
              "file",
              "Filen, där de sparar den: Chromium-webbläsare på datorn, som Chrome och Edge, skriver den dit mottagaren väljer, andra webbläsare till sina nedladdningar.",
            ],
            [
              "file",
              "Om anslutningen bryts medan filen kommer fram: det som hann komma fram, i sidans minne eller i filen de valde att spara till, så att Försök igen kan fortsätta därifrån. Sidan kastar det om överföringen slutar på något annat sätt. När fliken stängs eller laddas om försvinner det som låg i minnet. Vad webbläsaren då gör med en ofärdig fil från sparadialogen har vi inte testat än.",
            ],
            [
              "secret",
              "Hemligheten, bara i sidans minne tills de kopierar den. Då ligger den också i deras urklipp, där urklippshistorik, synkade urklipp och andra appar kan läsa den.",
            ],
            [
              "direct,relay",
              "Så länge vårt relä är tillgängligt: inloggningsuppgifter till reläet, gjorda för det här paret av webbläsare, i minnet medan sidan är öppen. Med dem kan en reläanslutning starta i 5 minuter.",
            ],
            [
              "",
              "När anslutningen öppnas: ett slumpmässigt värde från vår server, bara i sidans minne, så att sidan kan ta tillbaka sin plats om dess anslutning till vår server bryts. Ett nytt ersätter det varje gång sidan tar tillbaka sin plats, och det försvinner när överföringen slutar eller fliken stängs.",
            ],
            [
              "",
              "Flikens ikon som den senast var, en grön prick medan överföringen pågick, en bock när den kommit fram eller en röd stoppskylt där sidan behövde en säker anslutning, bland webbläsarens sparade webbplatsikoner, bredvid historikposten för varje sida fliken visade, länken också, tills historiken rensas.",
            ],
            ["", "Deras val av tema och språk, i webbläsarens lokala lagring, tills de rensas."],
          ],
        },
        networks: {
          name: "Näten på vägen",
          kept: "Okänt",
          never: "Något läsbart: all trafik är krypterad.",
          lines: [
            ["", "Båda IP-adresserna och tidpunkterna."],
            ["file", "Filens storlek, bara ungefär."],
            ["secret", "Inte hemlighetens längd: varje hemlighet är lika stor på nätet."],
          ],
        },
      },
    },
    data: {
      heading: "Steg för steg",
      body: [
        "Samma sak i den ordning en överföring sker: vad vår server ser, sparar och loggar i varje steg, och vad vårt relä ser. En delad hemlighet går igenom samma steg som en fil.",
      ],
      columns: ["Steg", "Vår server ser", "Vår server sparar", "Vår server loggar", "Vårt relä"],
      rows: [
        [
          "Du öppnar webbplatsen",
          "Din IP-adress och dina webbläsaruppgifter, som alla webbplatser.",
          "Ingenting. En sändarsida öppnar också en anslutning till vår server, som servern håller i minnet medan sidan är öppen.",
          "Ingenting.",
          "Ingenting.",
        ],
        [
          "Du väljer fil eller skriver hemligheten, och lägger till mottagare",
          "Ingenting. Din webbläsare läser filen, räknar ut kontrollsumman och skapar länkarna själv.",
          "Ingenting.",
          "Ingenting.",
          "Ingenting.",
        ],
        [
          "Din sida anmäler sina länkar",
          "Länk-ID:na, ditt val om reläet och din IP-adress.",
          "Länk-ID:na och ditt val om reläet, i minnet, medan din sida är öppen.",
          "Att en avsändare anmälde sig, och hur många länkar.",
          "Ingenting.",
        ],
        [
          "En mottagare öppnar sin länk",
          "Länk-ID:t, ett slumpmässigt försöks-ID och mottagarens IP-adress och webbläsaruppgifter. Om din sida nekar mottagaren, varför: länken har redan använts, en annan sida är ansluten till den, din sida har inte länken eller din sida avbröt försöket.",
          "Vilken mottagarsida som är ihopkopplad med vilken länk, i minnet.",
          "Att en mottagare anslöt eller nekades och varför, med de 6 första tecknen i länk-ID:t.",
          "Ingenting än. Om du tillåter reläet och det är tillgängligt ger vår server de två sidorna inloggningsuppgifter till det, som en reläanslutning kan starta med i 5 minuter.",
        ],
        [
          "Webbläsarna kopplar upp sig",
          "Krypterade meddelanden för uppkopplingen och deras storlek. Den kan inte läsa dem.",
          "Ingenting. Den skickar dem vidare.",
          "Varje meddelandes storlek, med de 6 första tecknen i länk-ID:t.",
          "Varje webbläsares IP-adress, när den frågar efter sin offentliga adress (STUN). Om du tillåter reläet och det är tillgängligt, och webbläsarna fortfarande inte är anslutna 3 sekunder efter att mottagaren svarat, lägger de till reläet. Båda reserverar då en reläadress. Bara din gör det om mottagarens webbläsare redan var ansluten när din sidas begäran om att lägga till reläet kom fram. Reläet kan få veta båda IP-adresserna i båda fallen, även om en direkt väg vinner till slut.",
        ],
        [
          "Filen eller hemligheten skickas",
          "Ingenting av den. Din sida rapporterar vägen en gång, som den var när den öppnades: direkt, STUN, relä eller misslyckad. Om vägen bryts och mottagarens sida frågar igen: att den frågade, vilket visar att anslutningen bröts. Om en sidas anslutning till vår server bryts och sidan tar tillbaka sin plats: att den kom tillbaka, och från vilken IP-adress.",
          "Ett slumpmässigt värde för varje sida, så att en sida vars anslutning till vår server bryts kan ta tillbaka sin plats. Om en sidas anslutning bryts utan att stängas: sidans plats, i upp till 30 sekunder.",
          "Vägen. Om mottagarens sida frågade igen efter en bruten väg: att en mottagare anslöt eller nekades som upptagen, eller, om avsändaren just hade gett upp, anslöt och sedan nekades av avsändaren, och storleken på varje nytt uppkopplingsmeddelande. Om en sida försökte ta tillbaka sin plats: att den gjorde det, eller nekades.",
          "På vägen via reläet: de krypterade paketen, som det för vidare och inte sparar. Båda IP-adresserna så fort webbläsarna har lagt till reläet. Om vägen bryts kan varje webbläsare fråga efter sin offentliga adress igen, och webbläsare som hade lagt till reläet kan reservera reläadresser igen.",
        ],
        [
          "Mottagaren bekräftar leveransen",
          "Ingenting. Kvittot går mellan webbläsarna. Om länken öppnas igen nekar din sida den som använd.",
          "Ingenting.",
          'Ett senare nekande, med orsaken "used".',
          "Ingenting.",
        ],
        [
          "En sida stängs",
          "Att sidan kopplade ner.",
          "Ingenting om den sidan, inom en minut.",
          "Att en avsändare lämnade och hur många länkar den hade, eller att en mottagare lämnade, med de 6 första tecknen i länk-ID:t.",
          "Ingenting.",
        ],
        [
          "Efteråt",
          "Ingenting.",
          "Ingenting.",
          "Loggraderna raderas efter 30 dagar.",
          "Ingen logg över trafiken. Vi slår bara på en för att rätta ett fel eller stoppa missbruk, i högst 7 dagar, med anslutningstider, IP-adresser och datamängder. Medan reläet förnyar sitt certifikat loggar det också adresserna som når det på port 80, aldrig webbläsares, i ungefär fem veckor.",
        ],
      ],
    },
  },
  privacy: {
    title: "Integritet",
    lede: "Vi får aldrig din fil eller delade hemlighet, eller dess namn. Vi får inte heller nyckeln som låser upp den. Här nedan står vad vi ser och sparar, och hur länge.",
    neverHeading: "Det här får vi aldrig",
    never: [
      ["Din fil", "Varken innehållet, filnamnet, storleken eller filtypen."],
      [
        "Din hemlighet",
        "Varken hemligheten du delar från sidan Dela en hemlighet eller dess längd: varje delad hemlighet fylls ut till samma storlek innan den lämnar din webbläsare.",
      ],
      [
        "Nyckeln",
        "Den del av länken som låser upp filen eller den delade hemligheten når aldrig oss.",
      ],
      ["Mottagarnas namn", "Inte namnen du ger dem du skickar till."],
    ],
    seesHeading: "Det här ser vår server",
    sees: [
      [
        "Din IP-adress och uppgifter om din webbläsare",
        "Liksom alla webbplatser du besöker ser vi dem och vilken sida du öppnar. Sidans adress visar vilket språk du har valt. Vi använder dem för att visa dig sidan, koppla ihop er och begränsa missbruk. Vår server skriver aldrig in dem i sina loggar. Vårt relä loggar dem inte heller, utom medan vi åtgärdar ett fel eller stoppar missbruk (se nedan).",
      ],
      [
        "Ett länk-ID",
        "Varje länk har ett slumpmässigt ID, som ett nummer på en kölapp, så att rätt två webbläsare kan hitta varandra. Det kan inte låsa upp något. Vi glömmer det inom en minut efter att avsändarens sida har stängts, förutom de första tecknen i våra loggrader.",
      ],
      [
        "Uppkopplingsmeddelanden",
        "Några små, låsta meddelanden som hjälper de två webbläsarna att ansluta. Vi skickar dem vidare och sparar dem inte. Vi kan inte läsa dem.",
      ],
      [
        "Avsändarens val om reläet",
        "Om avsändaren tillåter vårt relä, så att vi bara ger mottagare tillgång till det när avsändaren gör det. Vi glömmer det inom en minut efter att avsändarens sida har stängts, och skriver aldrig in det i våra loggar.",
      ],
      [
        "Hur varje anslutning gick",
        "Avsändarens sida berättar för oss om varje anslutning gick direkt, via vårt relä eller misslyckades. Vi skriver in det i våra loggar, för att veta hur ofta anslutningar behöver vårt relä.",
      ],
      [
        "Varför en mottagare nekades",
        "När avsändarens sida nekar en mottagare berättar den för oss varför: länken har redan använts, en annan sida är ansluten till den, avsändarens sida har inte länken eller så avbröt avsändarens sida försöket. Därför kan vi se att en länk har levererats om den öppnas igen. Vi skriver in orsaken i våra loggar.",
      ],
      [
        "När varje sida ansluter och kopplar ner",
        "Vi ser när varje sida ansluter till vår server och när den kopplar ner, så vi kan se när någon öppnar en länk. Våra loggrader noterar när en avsändares sida registrerar eller ändrar sina länkar och när den stängs, och när en mottagare ansluter eller kopplar ner.",
      ],
      [
        "När en överförings anslutning bryts",
        "Om anslutningen mellan de två webbläsarna bryts under en överföring ber mottagarens sida vår server att hjälpa dem hitta en väg igen. Då ser vi att den här överföringens anslutning bröts, och när. Vår logg noterar det som ytterligare en rad om att en mottagare anslöt eller nekades, och storleken på de nya uppkopplingsmeddelandena. Vi ser inte varför den bröts eller hur långt överföringen hade kommit. Om också en sidas anslutning till vår server bryts, som när en dator byter nätverk, ansluter sidan igen och tar tillbaka sin plats i överföringen. Då ser vi också att sidans nya IP-adress hör till samma överföring. Vår logg noterar att en sida tog tillbaka sin plats, eller nekades.",
      ],
    ],
    keepHeading: "Vad vi sparar",
    keep: "Vi har inga konton, ingen databas över personer eller överföringar, inga cookies och ingen spårning. När avsändarens sida har stängts sparas ingenting om dig, inom högst två minuter, förutom loggraderna nedan, en relälogg medan vi åtgärdar ett fel eller stoppar missbruk, och våra månatliga trafiksummor. Summorna räknar ihop all trafik in och ut genom vår server och vårt relä, och vi sparar dem i upp till 15 månader. De pekar inte ut någon överföring. Men vi sparar en ny summa var 5:e minut, så på ett lugnt relä kan skillnaden mellan två summor visa ungefär hur stor en överföring var och när den skedde.",
    logFields,
    logRetention: "Loggraderna raderas efter 30 dagar.",
    relayLog:
      "Vårt relä, som kan föra den låsta filen vidare när två webbläsare inte kan ansluta direkt, för ingen logg över trafiken. Vi slår bara på en för att åtgärda ett fel eller stoppa missbruk. Loggen sparar då för varje vidarebefordrad anslutning båda IP-adresserna och portarna, när anslutningen började och slutade och hur mycket data som gick igenom. Aldrig namn, nycklar eller fildata. Vi stänger av den och raderar den inom 7 dagar. Dessutom loggar reläet adresserna som når det på port 80 medan det förnyar sitt certifikat, några sekunder ungefär varannan månad. Det är Let's Encrypts kontroller och skannrar på internet, aldrig webbläsare, och de raderas inom ungefär fem veckor.",
    limitsHeading: "Det här kan vi inte skydda dig mot",
    limits: [
      "Den som har länken kan öppna filen. Skicka varje länk bara till personen den är avsedd för.",
      "Din webbläsare kör den kod vår server skickar. En server som skickade annan kod skulle kunna läsa filer, och hoppa över kontrollnumret. Koden är offentlig, men webbläsare kan ännu inte kontrollera att det de fick stämmer med den.",
      "Den andra webbläsaren ser din IP-adress, precis som i ett videosamtal. Vår server ser båda IP-adresserna, vilken mottagare som ansluter till vilken avsändare och när, och hur många mottagare en avsändare har. Så den får veta vem som skickar till vem, men inte vad.",
      "Varje webbläsare frågar vårt relä om sin offentliga adress, så reläet ser varje IP-adress och kan oftast se vilka två som hör ihop. Nätverken på vägen, och vårt relä när filen går via det, ser båda IP-adresserna, när överföringen sker och ungefär hur stor filen är.",
    ],
    limitsLink: ["Varje risk, och vad Fidant gör åt den", "/how/protection"] as readonly [
      string,
      string,
    ],
    checkHeading: "Kontrollera själv",
    check:
      "Den här sidan är den korta versionen. Så fungerar det förklarar varje steg, och varje påstående här går att kontrollera mot den offentliga koden.",
    checkLinks: [
      ["Så fungerar det, steg för steg", "/how"],
      ["Det som ses och sparas i varje steg", "/how/traces"],
      ["Koden på GitHub", "https://github.com/fidant-labs/fidant"],
    ] as ReadonlyArray<readonly [string, string]>,
    contactHeading: "Kontakt",
    contact:
      "Fidant är ett projekt med öppen källkod, och inget företag eller ingen person ansvarar för det än. Frågor om integritet och dina uppgifter skickas till",
  },
};
