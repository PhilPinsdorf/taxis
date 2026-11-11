# Taxis – Eventplanung auf dem Lageplan

[![CI](https://github.com/PhilPinsdorf/taxis/actions/workflows/ci.yml/badge.svg)](https://github.com/PhilPinsdorf/taxis/actions/workflows/ci.yml)

Web-App zum Planen von Events: Lageplan hochladen, Maßstab setzen, Zelte, Mobiliar, Licht, Ton,
Stageboxen, Defender und Kabel maßstabsgetreu einzeichnen – und daraus automatisch eine Materialliste
mit Abgleich gegen Eigenbestand und Anfragen erhalten.

## Schnellstart (Docker)

Fertiges Image aus GitHub Packages:

```bash
docker compose pull && docker compose up -d
# → http://localhost:8080
```

Oder lokal selbst bauen: `docker compose up -d --build`.

Ohne Compose: `docker run -d -p 8080:8080 -v taxis-data:/data ghcr.io/philpinsdorf/taxis:latest`

Die CI (GitHub Actions) prüft jeden Push (Typecheck, Tests, Build) und veröffentlicht das Image:
`latest` vom `main`-Branch, `1.2.3` / `1.2` für Git-Tags `v1.2.3`, außerdem ein Tag je Commit (`sha-…`).

Die Daten (SQLite-Datenbank + hochgeladene Pläne) liegen im Docker-Volume `taxis-data` (`/data` im Container).

### Konfiguration

Über Umgebungsvariablen bzw. eine `.env`-Datei neben `docker-compose.yml` (siehe `.env.example`):

| Variable         | Standard | Bedeutung                                                                 |
| ---------------- | -------- | ------------------------------------------------------------------------- |
| `PORT`           | `8080`   | Port auf dem Host                                                         |
| `AUTH_MODE`      | `none`   | `none` = offen, `password` = gemeinsames Passwort mit Login-Seite         |
| `APP_PASSWORD`   | –        | Passwort für `AUTH_MODE=password`                                         |
| `SESSION_SECRET` | –        | Optional: Schlüssel für Session-Cookies (sonst aus dem Passwort abgeleitet) |
| `COOKIE_SECURE`  | `false`  | `true`, sobald die App über HTTPS erreichbar ist                          |

**Online hosten:** `AUTH_MODE=password` setzen und die App hinter einen Reverse-Proxy mit HTTPS
(z.B. Caddy oder Traefik) stellen, dann `COOKIE_SECURE=true`. Beispiel Caddy:

```
plan.example.de {
  reverse_proxy localhost:8080
}
```

Echte Benutzerkonten sind vorbereitet (Projekte haben bereits eine `owner_id`, die Authentifizierung
steckt gekapselt in `apps/server/src/auth.ts`).

### Backup

```bash
docker run --rm -v taxis_taxis-data:/data -v "$PWD":/backup busybox tar czf /backup/taxis-backup.tgz -C /data .
```

## Bedienung

**Material** – Katalog für alle Projekte: Art (Objekt / Kabel / Strecke), Maße, Farbe, Eigenbestand,
Anschlüsse (z.B. XLR-In, DMX-Out, Schuko – mit Anzahl und „Pflicht“). Bei Kabeln die vorhandenen
Stücklängen, bei Defender/Kabelmatten die Segmentlänge. „Nur verfügbare Menge verplanbar“ begrenzt,
wie viele Stück im Plan platziert werden können (Eigenbestand + nicht abgelehnte Anfragen).

**Plan** – Lageplan (Bild oder PDF) hochladen, mit dem Maßstab-Werkzeug eine bekannte Strecke markieren.

| Taste            | Funktion                                        |
| ---------------- | ----------------------------------------------- |
| `V` / `H`        | Auswählen / Verschieben (auch Leertaste halten) |
| `K`              | Kabel verlegen                                  |
| `L`              | Defender / Kabelmatte                           |
| `R` / `O` / `T`  | Rechteck / Ellipse / Text                       |
| `M`              | Maßstab setzen                                  |
| `Q` / `E`        | Drehen ±15° (mit Umschalt ±90°)                 |
| `Strg+D`         | Duplizieren                                     |
| `Strg+Z` / `Strg+Umschalt+Z` | Rückgängig / Wiederholen            |
| `Entf`           | Löschen                                         |
| `Enter` / Doppelklick | Kabel/Strecke abschließen                  |
| `0`              | Plan einpassen                                  |

Objekte aus der Palette per Klick (Mehrfach-Platzieren, `Esc` beendet) oder Drag & Drop setzen.

**Kabel:**
- *Frei*: beliebig lang zeichnen – die Materialliste rechnet `(gezeichnet + Höhe Start + Höhe Ende) / (1 − Reserve)`.
- *Feste Länge*: z.B. ein 10 m-Kabel – das Werkzeug lässt nur `10 m × (1 − Reserve) − Höhen` zeichnen.
- Start/Ende auf einem Gerät verbindet automatisch mit einem passenden freien Anschluss (änderbar in den Eigenschaften).
- Am Kabelende starten oder „Am Ende anknüpfen“ = Verlängerung.
- Sind Stücklängen im Bestand gepflegt, schlägt Taxis je Kabel passende Stücke vor (`→ 25 m`) und meldet Fehlmengen.

**Versionen** – Arbeitsstand wird automatisch gespeichert. Benannte Versionen lassen sich ansehen,
wiederherstellen (der aktuelle Stand wird vorher automatisch gesichert) oder als neues Projekt (Variante) weiterführen.

**Design** – Hell, Dunkel oder automatisch nach System über das Symbol oben rechts (Ausdrucke sind immer hell).

**Übersicht** – Materialliste mit Bedarf, Eigenbestand, bestätigten/offenen Anfragen und Fehlmengen,
Zusatzposten („noch ein 15 m-Kabel zur Kasse“), Anfragenverwaltung, offene Anschlüsse und
Patch-/Belegungslisten für Stageboxen, Pulte und Verteiler. Export als CSV oder Druck/PDF.

## Entwicklung

Voraussetzung: Node.js 24.

```bash
npm install
npm run dev        # API auf :8080, Frontend auf http://localhost:5173 (Proxy auf /api)
npm test           # Rechenlogik (Vitest)
npm run typecheck
npm run build
```

Aufbau (npm-Workspaces):

```
packages/shared   Schemas (zod) + Rechenlogik: Längen, Kabelzuordnung, Materialbedarf, Anschlüsse
apps/server       Fastify-API, SQLite (better-sqlite3), Uploads, Auth-Plugin
apps/web          React + Konva (Zeichenfläche), Zustand, TanStack Query, Tailwind
```

Der Plan eines Projekts ist ein JSON-Dokument (`PlanDoc`), das bei jedem Speichern mit einer Revision
versehen wird (optimistische Sperre gegen gleichzeitiges Überschreiben). Positionen liegen in Bild-Pixeln,
Maße in Metern – ein neu gesetzter Maßstab lässt Objekte an ihrem Ort und rechnet Größen und Längen neu.
