# Umbau des Noteneintragungssystems SPA — Fachliche & technische Spezifikation

> Überführung der Spezifikation **v0.2 (Entwurf), 2. Juni 2026**, Autor: Dennis
> Clausen, in Markdown. Inhaltlich unverändert; Quelle für den Umsetzungsplan.

## 1. Ausgangslage

Die Noten der SPA-Bildungsgänge werden heute in drei dateiübergreifend
verknüpften Excel-Online-Dateien geführt: zwei Berechnungsdateien für die
Lernfelder (LF2, LF3) sowie eine zusammenführende Datei „Liste Zeugnis".

Vier strukturelle Schwachstellen:

1. **Fragile Verknüpfungen** über externe Datei-Referenzen (z. B.
   `='[1]1. Hj.'!A2`), die beim Umbenennen/Verschieben/Kopieren brechen.
2. **Keine Rechtetrennung** — alle arbeiten auf denselben Dateien.
3. **Datenschutz** — personenbezogene Noten ohne sauberes Zugriffsmodell.
4. **Wartbarkeit** — Rechenlogik über hunderte Zellformeln verteilt, manuell
   kopiert.

## 2. Ziele & Anforderungen

- **Niedrigschwellig:** geführte Eingabemaske ohne Formelwissen.
- **Sicher & zuverlässig:** zentrale, deterministische, automatisiert getestete
  Berechnung; keine brechbaren Verknüpfungen.
- **Datenschutzkonform:** rollenbasierter Zugriff; ausschließlich
  lokale/landeseigene Datenhaltung.
- **Nachhaltig:** schlanke, dokumentierte Lösung; übergebbar oder mit
  überschaubarem Aufwand neu baubar.

### 2.1 Rahmenbedingungen

| Aspekt | Festlegung |
| --- | --- |
| Infrastruktur | Eigener Server (Node.js-fähig), neu eingeführtes Nextcloud, Moodle vorhanden. |
| Datenhaltung | Ausschließlich on-premise / landesgehostet — keine Public Cloud. |
| Zugriff | Jede Lehrkraft nur eigenes Lernfeld/Fach; Klassenleitung und Administration sehen alles. |
| Wartung | Zunächst durch den Autor; Bus-Faktor durch Einfachheit und Dokumentation abgefedert. |

## 3. Lösungsentscheidung

**Entscheidung: Richtung B** — eine bewusst kleine Web-Anwendung auf dem
eigenen Server (Node + DB). Optional Nextcloud nur für Anmeldung (SSO) und
Ablage von Zeugnis-Exporten.

## 4. Datenmodell

**Leitprinzip:** Fächer, Bewertungskomponenten und Gewichtungsregeln sind
**Konfigurationsdaten, nicht fest verdrahteter Code**. Neue Lernfelder oder
geänderte Gewichte werden per Eingabemaske gepflegt — ohne Programmierung.

**n/a-Logik:** „nicht belegt" ist ein eigener Zustand der Komponentennote
(kein Zahlenwert). Die Gewichtsverteilung schließt n/a-Komponenten aus, bevor
das Restbudget verteilt wird.

| Entität | Schlüsselfelder | Zweck |
| --- | --- | --- |
| Lehrkraft | id, name, login (SSO), rolle | Benutzer:innen inkl. Rolle (Fachlehrkraft / Klassenleitung / Admin). |
| Klasse | id, bezeichnung, schuljahr | Lerngruppe eines Bildungsgangs in einem Schuljahr. |
| Schüler:in | id, name, vorname, klasse_id | Stammdatensatz der bewerteten Person. |
| Lehrauftrag | lehrkraft_id, fach_id, klasse_id, halbjahr | Steuert den Zugriff: ohne passenden Auftrag keine Sicht/Eingabe. |
| Fach / Lernfeld | id, name, typ (LF \| Fach) | Bewertungsgegenstand (LF1–LF4, Deutsch, Praxis …). |
| Bewertungsschema | id, fach_id, halbjahr, modus | Definiert je (Fach × Halbjahr) die geltenden Komponenten und ob kumulativ gerechnet wird. |
| Komponente | id, schema_id, name, gewicht_fix \| rest_anteil | Einzelbewertung mit festem Gewicht ODER Anteil am Restbudget. |
| Notenskala | punkte (0–15) → notentext | Umsetzung Punkte in Schulnote (15→1+, …, 0→6). |
| Komponentennote | schueler_id, komponente_id, punkte \| n/a | Eingegebene Rohnote bzw. „nicht belegt" (n/a). |
| Ergebnis (berechnet) | schueler_id, fach_id, halbjahr, endpunkte, zwischennote, tendenznote | Abgeleitetes Resultat. |

### 4.1 Aggregationsmodi des Bewertungsschemas

| Modus | Bedeutung / Beispiel |
| --- | --- |
| `halbjahr: komponenten_gewichtet` | Zwischennote = gewichtete Summe der Komponenten (LF2, LF3). |
| `halbjahr: direkt` | Zwischennote = ein einzeln eingetragener Punktwert (LF1, LF4, alle Fächer). |
| `kumulation: fortlaufend_50_50` | Endnote(Hj≥2) = 0,5·Endnote(Hj−1) + 0,5·Zwischennote(Hj). Gilt für LF1–LF4. |
| `kumulation: keine` | Zeugnisnote = aktuelle Halbjahresnote (Deutsch, Englisch, WiPo, Religion, Mathematik). |
| `kumulation: gewichtet_vorgaenger` | Endnote = 0,3·Vor-Hj. + 0,7·aktuelles Hj. (Praxis-Endnote im 4. Hj.). |
| `kumulation: mittelwert_halbjahre` | Endnote = Mittelwert ausgewählter Halbjahre (WPK = Ø aus 1. + 2. Hj.). |
| `flag: deaktivierbar` | Fach kann je Halbjahr auf „n/a" gesetzt werden; dann wird der Vorwert unverändert fortgeschrieben (LF4). |

## 5. Rechenregeln

Berechnung je **(Schüler:in × Fach)**.

### 5.1 Zwischennote (pro Halbjahr)

```
Zwischennote(Hj) = Σ ( Gewicht_i · Punkte_i )   über alle belegten Komponenten
```

Gewichte sind **fest** (z. B. LF2: Gesundheit 0,4 / Erziehung 0,3 /
Entwicklung 0,3) oder **dynamisch**: Bei LF3 ist eine Komponente fix (z. B.
Pädagogik 40 %), das verbleibende Budget (60 %) wird gleichmäßig auf die
aktiven (nicht-n/a-) Komponenten verteilt.

### 5.2 Endnote (kumulativ über Halbjahre)

```
Endnote(1. Hj) = Zwischennote(1. Hj)
Endnote(Hj ≥ 2) = 0,5 · Endnote(Hj−1) + 0,5 · Zwischennote(Hj)
```

Das aktuelle Halbjahr trägt 50 %, frühere klingen exponentiell ab
(vorletztes 25 %, davor 12,5 % …).

### 5.3 Tendenznote

```
Tendenznote(Hj) = Notenskala[ RUNDEN( Endnote(Hj), 0 ) ]
```

**Kritisch:** Die Kumulation rechnet mit den **ungerundeten** Endpunkten
weiter — gerundet wird ausschließlich am Ende für die Tendenznote. Das Feld
`endpunkte` speichert daher den ungerundeten Wert.

### 5.4 Durchgerechnetes Beispiel (LF2)

| Halbjahr | Zwischennote | Endnote (ungerundet) | Tendenznote |
| --- | --- | --- | --- |
| 1. Hj. | 5,80 | 5,80 | 4+ |
| 2. Hj. | 9,00 | 7,40 | 3- |
| 3. Hj. | 11,00 | 9,20 | 3+ |
| 4. Hj. | 12,00 | 10,60 | 2 |

(1.-Hj.-Zwischennote 5,80 = 0,4·7 + 0,3·5 + 0,3·5, aus realen Daten.)

## 6. Vollständige Inventur

Punktesystem 0–15; Umsetzung in Schulnoten über die zentrale Notenskala
(15→1+, …, 0→6, „-" für keine Note).

### 6.1 Lernfelder (LF1–LF4)

| Lernfeld | Quelle / Eingabe | Halbjahresnote | Fortschreibung |
| --- | --- | --- | --- |
| LF1 | Direkt in der Zeugnisdatei | Einzelner Punktwert | fortlaufend 50/50 |
| LF2 | Eigene Datei | Gewichtet: Gesundheit 0,4 / Erziehung 0,3 / Entwicklung 0,3 | 50/50; Zeugnis rundet |
| LF3 | Eigene Datei | Gewichtet, je Hj. wechselnde Komponenten (s. 6.2) | 50/50; Zeugnis rundet |
| LF4 | Direkt in der Zeugnisdatei | Einzelner Punktwert | fortlaufend 50/50; je Hj. per „n/a" abschaltbar |

**Inkonsistenz, die das neue System auflöst:** LF2/LF3 kumulieren in ihrer
eigenen Datei und werden im Zeugnis nur gerundet übernommen, während LF1/LF4
erst im Zeugnis kumulieren. Im neuen Modell ist die Fortschreibung für alle
Lernfelder dieselbe, zentral definierte Regel.

### 6.2 LF3 — Komponenten je Halbjahr

| Halbjahr | Komponenten (Restanteil-Komponenten *kursiv*) | Feste Gewichte |
| --- | --- | --- |
| 1. Hj. | Pädagogik \| *Kunst, Spiel, Musik* | Päd. 40 %, Rest 60 % gleichmäßig |
| 2. Hj. | Pädagogik, Bericht \| *Bewegung, Spiel, Kunst, Musik* | Päd. 20 %, Bericht 20 %, Rest 60 % |
| 3. Hj. | Pädagogik, Bericht \| *Bewegung, Spiel, Kunst, Musik* | Päd. 20 %, Bericht 20 %, Rest 60 % |
| 4. Hj. | Pädagogik \| *Kunst, Spiel, Musik, Bewegung* | Päd. 40 %, Rest 60 % gleichmäßig |

### 6.3 Fächer & Wahlpflichtkurs

| Fach | Eingabe | Bildung der Zeugnisnote |
| --- | --- | --- |
| Praxis | Direkt; im 3. Hj. zusätzlich „Blockpraxis" | Meist aktuelles Hj.; Praxis-Endnote (4. Hj.) = 0,3·Praxis(3. Hj.) + 0,7·Praxis(4. Hj.) |
| Deutsch | Direkt | Aktuelles Halbjahr (keine Kumulation) |
| Englisch | Direkt | Aktuelles Halbjahr |
| WiPo | Direkt | Aktuelles Halbjahr |
| Religion | Direkt | Aktuelles Halbjahr |
| Mathematik | Direkt | Aktuelles Halbjahr |
| WPK (Wahlpflichtkurs) | Kurs aus Liste + Note in 1. & 2. Hj. | Zeugnis = Mittelwert(1. Hj., 2. Hj.); Kursnamen zusammengeführt |

**Hinweis:** Noten werden über das **Fach** adressiert, nicht über die
Spaltenposition (die sich heute zwischen Halbjahren verschiebt).

### 6.4 Konfigurationslisten

- **WPK-Kurse:** Tierpädagogik, Nahrungsmittelzubereitung, U3-Kurs, OGS, Erste
  Hilfe am Kind (erweiterbar).
- **Notenskala:** 0–15 → 6 … 1+, „-" für „keine Note". Künftig zentral.
- **LF4-Schalter:** Pro Halbjahr „belegt" / „n/a".

## 7. Zugriffs- & Rollenkonzept

Zugriff gesteuert über die Entität **Lehrauftrag**. Drei Rollen:

- **Fachlehrkraft:** sieht/bearbeitet nur Komponentennoten der
  Fächer/Klassen/Halbjahre mit bestehendem Lehrauftrag.
- **Klassenleitung:** liest alle Fächer der eigenen Klasse(n), erzeugt die
  Zeugnisansicht.
- **Administration:** pflegt Stammdaten, Bewertungsschemata, Gewichte,
  Lehraufträge.

Anmeldung idealerweise per SSO (Nextcloud/LDAP oder Moodle).

## 8. Datenschutz

- Datenhaltung ausschließlich on-premise/landeseigen.
- Datensparsamkeit durch rollenbasierten Zugriff (Need-to-know).
- Transportverschlüsselung (TLS) + verschlüsseltes, regelmäßiges Backup.
- Nachvollziehbarkeit: Änderungsprotokoll (wer/wann/welche Note).
- Klare Lösch- und Aufbewahrungsfristen (mit Schulleitung/Datenschutz).

## 9. Verifikation

Die Rechenlogik wurde unabhängig nachgebaut und gegen die in den Excel-Dateien
gespeicherten Ergebniswerte verglichen; für alle gefüllten LF2-Datensätze des
1. Halbjahres stimmten Endpunkte und Tendenznoten exakt überein. Empfehlung:
diese Vergleichsprüfung als automatisierten Testfall hinterlegen.

## 10. Offene Punkte & nächste Schritte

- Verbindliche Festlegung der Notenskala-Rundung an Grenzwerten (kaufmännisch)
  und etwaiger Sonderfälle (nicht erteilt, befreit).
- Technische Detailentscheidung (Stack, DB, SSO, Hosting/Backup) ausarbeiten.
- Skizze der Eingabemasken und der Zeugnisansicht (UX).
- Abstimmung Datenschutzkonzept mit Schulleitung und Datenschutzbeauftragten.
- Migrationsplan: Übernahme bestehender Daten aus den Excel-Dateien.
- Prüfen, ob weitere Klassen/Bildungsgänge abweichende Fächer oder Gewichte
  nutzen (Generalisierbarkeit des Schemas).
