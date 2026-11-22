/* ==========================================================================
   ERGEBNISSE: HIER STELLST DU EIN, WAS AM ENDE HERAUSKOMMT
   ==========================================================================

   Am Ende des Quiz wird eines der Ergebnisse aus der Liste unten gezogen.
   Jedes Ergebnis ist gleich wahrscheinlich, egal wie die Fragen beantwortet
   wurden. Die Zahl der Einträge ist beliebig (1, 5, 12 …).

   So änderst du etwas:
   - Text zwischen den Anführungszeichen "…" ersetzen.
   - Neues Ergebnis: einen { … }-Block kopieren, einfügen, Komma dahinter nicht vergessen.
   - Ergebnis löschen: den ganzen { … }-Block entfernen.
   - Anführungszeichen im Text bitte als „…“ schreiben, nicht als "…".

   Felder pro Ergebnis:
     titel         Name der Challenge (groß, das Erste, was man sieht)       Pflicht
     frage         Leitfrage, z. B. „Wie können wir …?“                       Pflicht
     beschreibung  Worum geht es? Ein bis drei Sätze                           Pflicht
     partner       Wer stellt die Challenge? (optional, "" = nicht anzeigen)
     link          Link zur Challenge-Beschreibung (optional, "" = kein Button)

   Vorschau: Hänge ?ergebnis=2 an die Adresse (index.html?ergebnis=2), dann
   siehst du direkt das zweite Ergebnis, ohne das Quiz durchzuklicken.
   ========================================================================== */

/* Texte rund um das Ergebnis */
window.ERGEBNIS_TEXTE = {
  kopf: "Du bist perfekt dafür geeignet, diese Challenge zu entwickeln:",
  frageLabel: "Die Leitfrage",
  teilenText: "Ich soll beim Design Thinking diese Challenge entwickeln: „{titel}“. Welche ist deine?"
};

/* Die möglichen Ergebnisse.
   ACHTUNG: Das sind nur BEISPIELE, damit die Seite sofort funktioniert.
   Bitte durch die echten Challenges ersetzen. */
window.ERGEBNISSE = [
  {
    titel: "Von der Idee zum Problem",
    frage: "Wie können wir Studierenden helfen, aus einer vagen Idee ein Problem zu machen, das sich zu lösen lohnt?",
    beschreibung: "Viele Gründungsideen starten mit einer Lösung statt mit einem echten Problem. Entwickle einen Weg, der früh zu Gesprächen mit Betroffenen führt.",
    partner: "",
    link: ""
  },
  {
    titel: "Wissen, das in Köpfen steckt",
    frage: "Wie können wir erreichen, dass Erfahrungen einzelner Personen im ganzen Team ankommen?",
    beschreibung: "Wichtiges Wissen steckt oft nur in einzelnen Köpfen und geht verloren, wenn jemand geht. Finde eine Lösung, die im Alltag wirklich genutzt wird.",
    partner: "",
    link: ""
  },
  {
    titel: "Forschung trifft Markt",
    frage: "Wie können wir Forschenden den ersten Schritt zu Menschen erleichtern, die ihr Ergebnis brauchen könnten?",
    beschreibung: "Aus guter Forschung wird nicht automatisch ein Produkt. Entwickle einen Ansatz, der Forschung und Bedarf zusammenbringt.",
    partner: "",
    link: ""
  },
  {
    titel: "Teams, die sich finden",
    frage: "Wie können wir erreichen, dass sich Menschen mit passenden Fähigkeiten für ein gemeinsames Vorhaben finden?",
    beschreibung: "Gute Ideen scheitern oft nicht an der Idee, sondern am fehlenden Team. Gestalte, wie Menschen zueinanderfinden.",
    partner: "",
    link: ""
  },
  {
    titel: "Der erste Kontakt zu Kundschaft",
    frage: "Wie können wir den Mut stärken, früh mit echten Nutzerinnen und Nutzern zu sprechen?",
    beschreibung: "Interviews sind der Anfang jeder guten Lösung, und genau davor drücken sich viele. Entwickle etwas, das den ersten Schritt leicht macht.",
    partner: "",
    link: ""
  }
];
