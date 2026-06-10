# NIVAO Stundenzettel

Mobile Arbeitszeiterfassung als Progressive Web App für den Außendienst.

## Funktionen

- Bürozeit, Kundentermine sowie aktive und passive Fahrzeit erfassen
- Laufende Phasen nach Schließen der App fortsetzen
- Pausen, Urlaub, Wochenenden und bayerische Feiertage berücksichtigen
- Zeiten nachträglich korrigieren
- Jahresübersicht als CSV oder Excel-kompatible XLS-Datei exportieren
- Vollständige Datensicherung und Wiederherstellung per JSON

## Datenschutz

Alle erfassten Daten bleiben lokal im Browser des verwendeten Geräts. Das Hosting enthält keine persönlichen Arbeitszeitdaten.

## Entwicklung

```bash
npm install
npm run dev
```

Der Produktions-Build wird mit `npm run build` erstellt und über GitHub Actions auf GitHub Pages veröffentlicht.
