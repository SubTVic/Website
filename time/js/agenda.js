/* ==========================================================================
   TIMEKEEPER: DIE ABLÄUFE DER TAGE
   ==========================================================================

   Pro Tag ein Block. „wochentag“ bestimmt, an welchem Tag er automatisch
   gilt (1 = Montag, 2 = Dienstag, 3 = Mittwoch, 4 = Donnerstag, 5 = Freitag).
   In der App lässt sich der Tag unter Optionen → Ablauf auch von Hand wählen.

   Eine Zeile pro Abschnitt:
     start    Uhrzeit "HH:MM"                                           Pflicht
     dauer    Minuten (das Ende ergibt sich aus Start + Dauer)          Pflicht
     typ      z. B. "Input", "Aktion", "Pause / Mittag", "Übergang", "Energizer",
              "Puffer", "Check-in/out, Retro", "Nur Coaches" (bestimmt die Farbe;
              Puffer und Pausen werden bei Verzug automatisch zuerst gekürzt)
     session  Titel des Abschnitts                                      Pflicht
     track    Für wen, z. B. "Alle" ("" = nicht anzeigen)
     wer      Optional, z. B. wer moderiert
     notiz    Optional: Anmerkung für Coaches, steht klein unter dem Titel
     phasen   Optional: Unterteilung mit eigenem Countdown und Ton bei jedem
              Wechsel, z. B. Crazy 8:
              [{ name: "Feld", dauer: 1, anzahl: 8 }, { name: "Diskussion", dauer: 7 }]
              Die letzte Phase läuft bis zum Ende des Abschnitts.

   So läuft die Zeit:
   - Die App richtet sich nach der Uhr des Geräts.
   - Läuft ein Abschnitt länger (Verlängern, Energizer, Sync), rücken die
     folgenden nach hinten. Ist man schneller (Sync), rücken sie nach vorne.
     Lücken im Plan fangen das auf: Was nach einer Lücke kommt, beginnt nie
     früher als geplant.

   Quelle: Miro-Frame „Jena Sprint WS 26 – Agenda Draft“ (Stand 4. November).
   ========================================================================== */

window.AGENDEN = {

  /* Dienstag. Die Excel-Zeilen 5 bis 7 (vor 12:00) waren auf dem Foto nicht zu sehen. */
  dienstag: {
    wochentag: 2,
    titel: "Jena Innovation Sprint WS26",
    tag: "Dienstag: Interviews & Synthese",
    abschnitte: [
      { start: "12:00", dauer: 45, typ: "Pause / Mittag", session: "Mittagessen Studierende + Rückkehr", track: "Studierende" },
      { start: "12:45", dauer: 5, typ: "Input", session: "Intro Tag 2", track: "Alle" },
      { start: "13:00", dauer: 20, typ: "Input", session: "Synthese & Downloading: Ablauf des Tages und warum. Demo: Downloading + Silent Clustering", track: "Alle" },
      { start: "13:20", dauer: 40, typ: "Aktion", session: "Downloading + Aha-Momente für weitere Interviews", track: "Alle" },
      { start: "14:00", dauer: 20, typ: "Aktion", session: "Welche Kernthemen zeigen sich?", track: "Alle" },
      { start: "14:20", dauer: 15, typ: "Pause / Mittag", session: "Kaffeepause", track: "Alle" },
      { start: "14:35", dauer: 10, typ: "Input", session: "Demo: Needs / Challenges / Insights", track: "Alle" },
      { start: "14:45", dauer: 30, typ: "Aktion", session: "Needs / Challenges / Insights erarbeiten", track: "Alle" },
      { start: "15:15", dauer: 20, typ: "Input", session: "Input: Persona & POV", track: "Alle" },
      { start: "15:35", dauer: 5, typ: "Übergang", session: "Pause", track: "Alle" },
      { start: "15:40", dauer: 10, typ: "Aktion", session: "Personas erstellen", track: "Alle" },
      { start: "15:50", dauer: 30, typ: "Aktion", session: "POVs erstellen", track: "Alle" },
      { start: "16:20", dauer: 10, typ: "Input", session: "Einführung Ideation", track: "Alle" },
      { start: "16:30", dauer: 10, typ: "Check-in/out, Retro", session: "Check-Out", track: "Alle" },
      { start: "16:40", dauer: 15, typ: "Puffer", session: "Puffer", track: "Alle" },
      { start: "16:55", dauer: 15, typ: "Nur Coaches", session: "Aufräumen, nächsten Tag vorbereiten, Fotos machen", track: "" },
      { start: "17:10", dauer: 30, typ: "Nur Coaches", session: "Coach-Debrief: Herausforderungen und was gut lief", track: "" }
    ]
  },

  mittwoch: {
    wochentag: 3,
    titel: "Jena Innovation Sprint WS26",
    tag: "Mittwoch: Ideation & Konzept",
    abschnitte: [
      { start: "08:30", dauer: 30, typ: "Nur Coaches", session: "Räume vorbereiten + Coach Morning Briefing", track: "", wer: "alle Coaches", notiz: "Input für die Coaches" },
      { start: "09:00", dauer: 5, typ: "Energizer", session: "Energizer + Ziel des Tages", track: "Alle" },
      { start: "09:05", dauer: 15, typ: "Input", session: "Input Ideation", track: "Alle", wer: "Coaches" },
      { start: "09:20", dauer: 20, typ: "Aktion", session: "HMW-Fragen formulieren", track: "Alle", notiz: "Deliverable: Jedes Team hat am Ende 2 HMW-Fragen." },
      { start: "09:40", dauer: 5, typ: "Input", session: "Demo Brainwriting", track: "Alle", wer: "Coaches" },
      { start: "09:45", dauer: 40, typ: "Aktion", session: "Brainwriting", track: "Alle", notiz: "20 Minuten pro Team, alle ideieren an einer Idee." },
      { start: "10:25", dauer: 10, typ: "Pause / Mittag", session: "Pause", track: "Alle" },
      { start: "10:35", dauer: 5, typ: "Input", session: "Input Crazy 8", track: "Alle" },
      { start: "10:40", dauer: 15, typ: "Aktion", session: "Crazy 8", track: "Alle", wer: "Coaches",
        notiz: "8 × 1 Minute Ideen (1 Minute pro Feld), dann 7 Minuten Diskussion.",
        phasen: [{ name: "Feld", dauer: 1, anzahl: 8 }, { name: "Diskussion", dauer: 7 }] },
      { start: "10:55", dauer: 30, typ: "Aktion", session: "Top 3 Ideen auswählen", track: "Alle", wer: "Coaches" },
      { start: "11:25", dauer: 30, typ: "Aktion", session: "Ideenbewertung: Top-Idee auswählen", track: "Alle", wer: "Coaches", notiz: "Mit dem Bewertungsbogen (Assessment Sheet)." },
      { start: "11:55", dauer: 20, typ: "Aktion", session: "Ideenkonzept entwickeln", track: "Alle", notiz: "Teilnehmenden sagen: nicht auf Name und Logo fokussieren." },
      { start: "12:15", dauer: 60, typ: "Pause / Mittag", session: "Mittagspause", track: "Alle" },
      { start: "13:15", dauer: 20, typ: "Input", session: "Input Business Model", track: "Alle" },
      { start: "13:35", dauer: 45, typ: "Aktion", session: "Erstes Business Model entwickeln", track: "Alle" },
      { start: "14:20", dauer: 20, typ: "Input", session: "Input Pitch", track: "Alle" },
      { start: "14:40", dauer: 20, typ: "Aktion", session: "Startup in 10 Sätzen beschreiben", track: "Alle" },
      { start: "15:00", dauer: 15, typ: "Pause / Mittag", session: "Pause", track: "Alle" },
      { start: "15:15", dauer: 10, typ: "Input", session: "Input: Wie erzeugt man Traction?", track: "Alle", wer: "Coaches" },
      { start: "15:25", dauer: 20, typ: "Aktion", session: "Traction-Plan für die eigene Idee", track: "Alle" },
      { start: "15:45", dauer: 10, typ: "Check-in/out, Retro", session: "Check-Out", track: "Alle" },
      { start: "15:55", dauer: 35, typ: "Puffer", session: "Puffer", track: "Alle" },
      { start: "16:30", dauer: 30, typ: "Nur Coaches", session: "Aufräumen, nächsten Tag vorbereiten, Fotos machen", track: "" }
    ]
  }
};
