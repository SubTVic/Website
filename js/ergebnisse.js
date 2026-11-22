/* ==========================================================================
   ERGEBNISSE: HIER STELLST DU EIN, WAS AM ENDE HERAUSKOMMT
   ==========================================================================

   Welche Challenge jemand bekommt, bestimmt die eingegebene Matrikelnummer:
   Die Zuordnung Matrikelnummer -> Challenge steht (gehasht) in zuordnung.js
   und wird mit tools/zuordnung-erzeugen.js aus deiner Liste erzeugt (siehe
   README). Die Antworten im Quiz ändern daran nichts.

   So änderst du etwas:
   - Text zwischen den Anführungszeichen "…" ersetzen.
   - Neue Challenge: einen { … }-Block kopieren, einfügen, Komma dahinter nicht
     vergessen. Challenge löschen: den ganzen { … }-Block entfernen.
   - Anführungszeichen im Text bitte als „…“ schreiben, nicht als "…".

   Felder pro Challenge:
     id            Kurze, eindeutige Kennung (nur Kleinbuchstaben, Ziffern, "-").
                   Die Zuordnung hängt daran. NACH dem Erzeugen der Liste nicht
                   mehr ändern, den Titel dagegen darfst du jederzeit ändern. Pflicht
     titel         Name der Challenge (groß, das Erste, was man sieht)       Pflicht
     frage         Leitfrage, z. B. „Wie können wir …?“                       Pflicht
     beschreibung  Worum geht es? Ein bis drei Sätze                           Pflicht
     partner       Wer stellt die Challenge? (optional, "" = nicht anzeigen)
     link          Link zur Challenge-Beschreibung (optional, "" = kein Button)

   Vorschau: Hänge ?ergebnis=2 an die Adresse (index.html?ergebnis=2), dann
   siehst du direkt die zweite Challenge, ohne das Quiz durchzuklicken.
   ========================================================================== */

/* Texte rund um das Ergebnis */
window.ERGEBNIS_TEXTE = {
  kopf: "Du bist perfekt dafür geeignet, diese Challenge zu entwickeln:",
  schonGemacht: "Du hast den Check schon gemacht. Das ist deine Challenge:",
  schonGemachtOhne: "Du hast den Check schon gemacht.",
  einmal: "Der Check lässt sich auf diesem Gerät nur einmal machen.",
  frageLabel: "Die Leitfrage",
  teilenText: "Ich soll beim Design Thinking diese Challenge entwickeln: „{titel}“. Welche ist deine?"
};

/* Einstellungen und Meldungen rund um die Matrikelnummer */
window.MATRIKEL_TEXTE = {
  /* Was passiert, wenn eine Matrikelnummer nicht in der Liste steht?
       "fehler": Meldung anzeigen, das Quiz startet nicht (Standard)
       "zufall": trotzdem starten und eine zufällige Challenge ziehen */
  unbekannt: "fehler",
  ungueltig: "Bitte gib deine Matrikelnummer ein (nur Ziffern).",
  teamUngueltig: "Bitte gib auch die Matrikelnummer deiner Kollegin oder deines Kollegen ein (nur Ziffern).",
  nichtGefunden: "Zu dieser Matrikelnummer haben wir keine Challenge gefunden. Bitte prüfe deine Eingabe.",
  keineListe: "Es ist noch keine Liste mit Matrikelnummern hinterlegt.",
  technik: "Der Abgleich funktioniert in diesem Browser nicht. Bitte öffne die Seite in einem aktuellen Browser."
};

/* Die möglichen Challenges.
   ACHTUNG: Das sind nur BEISPIELE, damit die Seite sofort funktioniert.
   Bitte durch die echten Challenges ersetzen. */
window.ERGEBNISSE = [
  {
    id: "idee-problem",
    titel: "Von der Idee zum Problem",
    frage: "Wie können wir Studierenden helfen, aus einer vagen Idee ein Problem zu machen, das sich zu lösen lohnt?",
    beschreibung: "Viele Gründungsideen starten mit einer Lösung statt mit einem echten Problem. Entwickle einen Weg, der früh zu Gesprächen mit Betroffenen führt.",
    partner: "",
    link: ""
  },
  {
    id: "wissen",
    titel: "Wissen, das in Köpfen steckt",
    frage: "Wie können wir erreichen, dass Erfahrungen einzelner Personen im ganzen Team ankommen?",
    beschreibung: "Wichtiges Wissen steckt oft nur in einzelnen Köpfen und geht verloren, wenn jemand geht. Finde eine Lösung, die im Alltag wirklich genutzt wird.",
    partner: "",
    link: ""
  },
  {
    id: "forschung-markt",
    titel: "Forschung trifft Markt",
    frage: "Wie können wir Forschenden den ersten Schritt zu Menschen erleichtern, die ihr Ergebnis brauchen könnten?",
    beschreibung: "Aus guter Forschung wird nicht automatisch ein Produkt. Entwickle einen Ansatz, der Forschung und Bedarf zusammenbringt.",
    partner: "",
    link: ""
  },
  {
    id: "teams",
    titel: "Teams, die sich finden",
    frage: "Wie können wir erreichen, dass sich Menschen mit passenden Fähigkeiten für ein gemeinsames Vorhaben finden?",
    beschreibung: "Gute Ideen scheitern oft nicht an der Idee, sondern am fehlenden Team. Gestalte, wie Menschen zueinanderfinden.",
    partner: "",
    link: ""
  },
  {
    id: "erster-kontakt",
    titel: "Der erste Kontakt zu Kundschaft",
    frage: "Wie können wir den Mut stärken, früh mit echten Nutzerinnen und Nutzern zu sprechen?",
    beschreibung: "Interviews sind der Anfang jeder guten Lösung, und genau davor drücken sich viele. Entwickle etwas, das den ersten Schritt leicht macht.",
    partner: "",
    link: ""
  }
];
