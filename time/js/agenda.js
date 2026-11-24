/* ==========================================================================
   TIMEKEEPER: DER ABLAUF DES TAGES
   ==========================================================================

   Eine Zeile pro Abschnitt:
     start    Uhrzeit "HH:MM"                                           Pflicht
     dauer    Minuten (das Ende ergibt sich aus Start + Dauer)          Pflicht
     typ      z. B. "Input", "Aktion", "Pause / Mittag", "Übergang",
              "Puffer", "Check-in/out, Retro", "Nur Coaches" (bestimmt die Farbe)
     session  Titel des Abschnitts                                      Pflicht
     track    Für wen, z. B. "Alle" oder "Studierende" ("" = nicht anzeigen)
     wer      Optional, z. B. wer moderiert

   So läuft die Zeit:
   - Die App richtet sich nach der Uhr des Geräts, jeden Tag mit diesen Uhrzeiten.
   - Ein Abschnitt beginnt nie vor seiner Startzeit. Läuft der vorige länger,
     beginnt er entsprechend später. Lücken im Plan (z. B. 12:50 bis 13:00)
     fangen eine Verlängerung auf.

   Statt diese Datei zu ändern, kann man einen Ablauf auch direkt in der App
   aus Excel einfügen (Einstellungen → Ablauf aus Excel einfügen). Der gilt
   dann nur auf diesem Gerät.

   Quelle: Miro-Frame „Jena Sprint WS 26 – Agenda Draft“ (Stand 4. November).
   Die Excel-Zeilen 5 bis 7 (vor 12:00) waren auf dem Foto nicht zu sehen und
   fehlen hier noch.
   ========================================================================== */

window.AGENDA = {
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
};
