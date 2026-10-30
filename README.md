# Kicker-Kommentator

Eine Browser-App, die ein Tischkicker-Spiel filmt, den Ball verfolgt und das Spiel live kommentiert wie im Sportfernsehen. Die Kommentare schreibt Claude, eine Sprachausgabe liest sie vor.

Der Prototyp läuft auf dem Handy im Stativ. Später kann dieselbe App auf einem Raspberry Pi mit fest montierter Webcam laufen.

## So funktioniert es

```
Kamera ──► Bildverarbeitung ──► Spiel-Logik ──► Claude ──► Sprachausgabe
           (Ball & Sticker      (Tor, Schuss,    (Kommentar-  (+ Untertitel,
            per Farbe, 60×/s)    Parade, Ball-    satz)        Scoreboard)
                                 besitz, km/h)
```

Das Sprachmodell schaut **nicht** direkt auf das Video, dafür ist der Ball viel zu schnell. Die Bildverarbeitung erkennt Ereignisse in Echtzeit und schickt Claude nur eine kurze Textbeschreibung („Schuss von Heim, 34 km/h, aufs Tor“). Daraus macht Claude einen Kommentatorensatz.

### Kommentar wie im Fußball-Videospiel

Fußballspiele wirken lebendig, weil der Kommentar ohne Verzögerung reagiert und trotzdem die Geschichte des Spiels erzählt. Die App kombiniert dafür mehrere Ebenen:

1. **Sofort-Ausrufe** („Toooor!“, „Gehalten!“, „Jetzt wird es gefährlich!“): Sie werden vor dem Anpfiff erzeugt und kommen ohne Wartezeit (`js/lines.js`).
2. **Publikum**: Ein synthetisches Stadion reagiert mit Spannung beim Schuss, einem „Oooh“ bei Paraden und Jubel bei Toren. Dazu kommen Anpfiff- und Schlusspfiff.
3. **KI-Anschluss**: Während der Ausruf läuft, schreibt Claude schon den nächsten Satz, mit Spielstand und Story (Ausgleich, Führungswechsel, Aufholjagd, Serie, Matchball, Rekordschuss).
4. **Zwei Stimmen**: Der Reporter macht das Play-by-Play, der Experte analysiert in ruhigen Phasen.
5. **Regie mit Prioritäten**: Ein Tor unterbricht alles. Veraltete Sätze werden verworfen, statt zu spät zu kommen.

### Stimmen

| Option | Qualität | Reaktionszeit | Kosten |
|---|---|---|---|
| Browser-Stimme | eher monoton | sofort | kostenlos |
| ElevenLabs `eleven_flash_v2_5` | natürlich, Deutsch gut | sehr schnell | Abo/Zeichen |
| ElevenLabs `eleven_v3` | sehr emotional (versteht `[excited]`) | langsamer | Abo/Zeichen |

Erzeugte Ausrufe werden im Browser zwischengespeichert, damit sie beim nächsten Spiel nichts mehr kosten. Für den Raspberry Pi kommt später eine lokale Stimme (z. B. Piper) infrage, die ohne Internet läuft.

| Datei | Aufgabe |
|---|---|
| `js/homography.js` | Rechnet Kamerabild ↔ Spielfeld um (Perspektivkorrektur über die 4 Ecken) |
| `js/vision.js` | Findet Ball und Team-Sticker über ihre Farbe |
| `js/game.js` | Erkennt Tore, Schüsse, Paraden, Ballkontrolle; führt Spielstand und Statistik |
| `js/narrative.js` | Story-Gedächtnis: Ausgleich, Führungswechsel, Serien, Matchball |
| `js/commentator.js` | Regie: Sofort-Ausrufe, Claude-Anschluss, Sprechwarteschlange |
| `js/lines.js` | Texte der Sofort-Ausrufe und Ersatz-Kommentare (gern anpassen) |
| `js/tts.js` | Stimmen: Browser oder ElevenLabs |
| `js/audio.js` | Stadion-Atmosphäre, Pfiffe, Audiowiedergabe |
| `js/main.js` | Oberfläche, Kalibrierung, Hauptschleife |

## Starten

Für den Kamerazugriff muss die Seite über **https** (oder `localhost`) geöffnet werden.

**Variante A: GitHub Pages (für das Handy)**
1. Auf GitHub im Repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch `master`, Ordner `/ (root)`, speichern.
2. Nach ca. einer Minute ist die App erreichbar unter `https://subtvic.github.io/Website/`.

**Variante B: lokal am Rechner**
```bash
python3 -m http.server 8000
# dann http://localhost:8000 im Browser öffnen
```

## Bedienung

1. **Kamera starten.** Handy aufs Stativ, möglichst von oben, sodass das ganze Spielfeld im Bild ist. Alternativ eine Video-Datei laden.
2. **Spielfeld markieren.** Die 4 Ecken im Uhrzeigersinn antippen. Dabei an einer Ecke neben dem Heim-Tor beginnen und zuerst entlang der Seitenbande tippen. Die Tore werden danach farbig angezeigt. Falls sie vertauscht sind: **Seiten tauschen**.
3. **Ball antippen**, solange er ruhig liegt. Der gelbe Kreis sollte ihm danach folgen.
4. Optional: **Team-Sticker.** Farbige Sticker auf die Figuren kleben und deren Farbe antippen.
5. **Anpfiff!**

Unter ⚙ trägst du den **Claude API-Key** ein (von [console.anthropic.com](https://console.anthropic.com)). Ohne Key kommentiert die App mit Satzvorlagen. Für bessere Stimmen wählst du dort **ElevenLabs**, trägst den ElevenLabs-Key ein und je eine Voice-ID für Reporter und Experte. Die Voice-IDs findest du in der ElevenLabs Voice Library. Alle Keys werden nur auf deinem Gerät gespeichert.

Tore werden automatisch erkannt, sobald der Ball an der Torlinie verschwindet. Falls die Erkennung danebenliegt, korrigierst du sie mit den Buttons **Tor Heim / Tor Gast / −1**.

## Tipps für gute Erkennung

- **Farbiger Ball** (orange/gelb) statt weiß. Weiße Bälle verwechselt die App leicht mit Linien und Spiegelungen.
- **Gleichmäßiges Licht** ohne starke Schatten oder Spiegelungen.
- **Hohe Bildrate:** Ein harter Schuss legt bei 30 Bildern pro Sekunde fast einen halben Tisch pro Bild zurück. 60 fps sind deutlich besser.
- Mit **Maske zeigen** siehst du, welche Pixel als Ball erkannt werden (magenta). Mit dem Toleranz-Regler oben rechts kannst du nachjustieren.

## Testen ohne Tisch

`tests/make_test_video.py` erzeugt ein künstliches Kicker-Video mit Tor, Schuss und Parade:

```bash
python3 tests/make_test_video.py test.y4m
```

Das Video kannst du in Chrome als Fake-Kamera verwenden:

```bash
chromium --use-fake-device-for-media-stream --use-file-for-fake-video-capture=test.y4m
```

## Nächste Schritte

- **ArUco-Marker** in den Tischecken, damit sich die App selbst kalibriert (wichtig für die feste Installation)
- **KI-Erkennung (YOLO)** für Ball und Figuren, unabhängig von Farben
- **Raspberry Pi 5** mit fester USB-Webcam (60+ fps) über dem Tisch, Anzeige auf einem Bildschirm
- **Turniermodus**: Spielerprofile, Spielplan, Tabelle, Statistiken über mehrere Spiele
- **Bessere Stimmen** über einen Text-to-Speech-Dienst
