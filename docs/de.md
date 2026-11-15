# Sector Alarm

Diese Integration verbindet Gladys mit deiner **Sector-Alarm**-Alarmanlage:
die Zentrale scharf und unscharf schalten, die smarten Schlösser ver- und
entriegeln, die smarten Steckdosen schalten und den Sensoren folgen (Türen und
Fenster, Rauch, Wasserlecks, Temperatur, Luftfeuchtigkeit).

## Bevor du beginnst

- **Gladys 5.3 oder neuer** ist erforderlich.
- Ein **Sector-Alarm-Konto**: die E-Mail-Adresse und das Passwort der
  Sector-Alarm-App.
- Gladys braucht **Internetzugang**. Sector Alarm hat keine lokale API: Alles
  läuft über die Sector-Alarm-Cloud (`mypagesapi.sectoralarm.net`). Deshalb
  trägt die Integration das Tag **cloud**.

## Konfiguration

| Feld                             | Was eintragen                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **E-Mail**                       | Die E-Mail-Adresse deines Sector-Alarm-Kontos.                                                                                         |
| **Passwort**                     | Sein Passwort. Als Geheimnis gespeichert, nie in die Protokolle geschrieben.                                                           |
| **Code der Zentrale**            | Der Code, den du am Bedienteil eingibst. Optional, siehe unten.                                                                        |
| **ID der Zentrale**              | Leer, um allen Zentralen des Kontos zu folgen. Sonst eine ID oder mehrere, durch Kommas getrennt.                                      |
| **Aktualisierungsintervall (s)** | Wie oft Sector Alarm gelesen wird. Standard 60 s, mindestens 30 s. Sector Alarm begrenzt Anfragen: Unter einer Minute bringt es wenig. |

Speichere und klicke dann auf **Verbindung testen**: Die Antwort listet die
gefundenen Zentralen, ihren Modus, ob sie online sind und wie viel Zubehör sie
haben. Öffne danach den Reiter **Geräteerkennung** der Integration und lege die
gewünschten Geräte an.

### Der Code der Zentrale

Der Code wird **nur** benötigt, um:

- den Alarm aus Gladys unscharf zu schalten (eine Szene, die Gerätekarte);
- ein smartes Schloss zu ver- oder entriegeln;
- eine Zentrale scharf zu schalten, deren **Schnellaktivierung** ausgeschaltet
  ist.

Ohne Code kann Gladys trotzdem alles lesen und eine Zentrale mit
Schnellaktivierung scharf schalten. Lass ihn leer, wenn Gladys nicht unscharf
schalten können soll.

## Geräte

| Gerät in Gladys                   | Funktionen                                                  | Werte                          |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| **Zentrale** (eine pro Zentrale)  | Alarmmodus (eine Liste: Unscharf, Teilweise scharf, Scharf) | `disarmed`, `partial`, `armed` |
| **Smartes Schloss**               | Schloss (steuerbar), Batterie schwach                       | 1 = verriegelt, 0 = entriegelt |
| **Smarte Steckdose**              | Strom (steuerbar)                                           | 1 = an, 0 = aus                |
| **Tür-/Fenstersensor**            | Öffnung, Batterie schwach                                   | 1 = geschlossen, 0 = offen     |
| **Rauchmelder**                   | Rauch, oft Temperatur                                       | 1 = Rauch erkannt              |
| **Wassermelder**                  | Wasserleck                                                  | 1 = Leck erkannt               |
| **Temperatur / Luftfeuchtigkeit** | Temperatur (°C), Luftfeuchtigkeit (%)                       |                                |

„Teilweise scharf“ erscheint nur bei einer Zentrale, die es kann. Jedes Gerät
zeigt ein **cloud**-Abzeichen; es wechselt auf **nicht erreichbar**, wenn die
Zentrale offline ist oder Sector Alarm nicht antwortet.

Gladys fragt die Geräte nicht einzeln ab: Die Integration liest jede Zentrale
als Ganzes, im gewählten Intervall, und schickt Gladys nur die geänderten
Werte. Nach einem Befehl wird die Zentrale einige Sekunden später erneut
gelesen, um ihn zu bestätigen.

## Dashboard-Widget

Füge das Widget **Sector Alarm** einem Dashboard hinzu. Es zeigt:

- den Alarmmodus (rot scharf, orange teilweise scharf, grün unscharf);
- die Verbindung der Zentrale;
- offene Türen und Fenster, entriegelte Schlösser;
- eine Rauch- oder Wasserwarnung.

Seine Schaltflächen: **Scharf schalten** und **Teilweise** (mit Bestätigung),
**Unscharf schalten**, **Aktualisieren**.

> **Sicherheit.** Ein Dashboard kann an der Wand hängen, und jeder kann darauf
> tippen. Die Schaltfläche **Unscharf schalten** verwendet daher **nie** den
> Code der Konfiguration: Sie öffnet ein kleines Formular, in das der Code
> jedes Mal eingegeben werden muss.

Bei mehreren Zentralen wählst du die anzuzeigende in den Widget-Einstellungen.

## Szenen

### Auslöser

| Auslöser                                         | Schlüssel                  | Filter                    | Variablen                                                                    |
| ------------------------------------------------ | -------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| **Der Alarmmodus ändert sich**                   | `alarm_mode_changed`       | Zentrale, Neuer Modus     | `mode`, `previous_mode`, `panel_name`, `user`, `channel`                     |
| **Eine Zentrale geht offline oder kommt zurück** | `panel_connection_changed` | Zentrale, Verbindung      | `state` (`offline` / `online`), `panel_name`                                 |
| **Ein smartes Schloss wird betätigt**            | `lock_operated`            | Schloss, Was passiert ist | `action` (`lock` / `unlock` / `lock_failed`), `lock_name`, `user`, `channel` |

`user` und `channel` stammen aus dem Ereignisprotokoll von Sector Alarm (wer,
und womit: Bedienteil, App, Tag…); sie sind leer, wenn das Protokoll es nicht
sagt.

Die Auslöser reagieren auf **Änderungen** zwischen zwei Lesevorgängen, egal
woher sie kommen (Bedienteil, App, Tag oder Gladys). Beim ersten Lesen nach
einem Start wird nichts ausgelöst: Die Historie ist keine Neuigkeit. Eine
Änderung, die zwischen zwei Lesevorgängen kommt und wieder geht, kann
übersehen werden: Verringere das Intervall, wenn das wichtig ist.

Beispiele:

- _Wenn der Alarm unscharf geschaltet wird und niemand zu Hause ist, schicke
  mir eine Benachrichtigung mit `{{triggerEvent.data.user}}`._
- _Wenn die Zentrale offline geht, sende eine Nachricht._
- _Wenn die Haustür entriegelt wird, schalte das Licht im Flur ein._

### Aktionen

| Aktion                       | Schlüssel        | Felder              | Ausgaben                             |
| ---------------------------- | ---------------- | ------------------- | ------------------------------------ |
| **Alarmmodus setzen**        | `set_alarm_mode` | Zentrale, Modus     | `applied` (ja/nein), `mode`, `error` |
| **Sector Alarm jetzt lesen** | `refresh_now`    | Zentrale (optional) | `mode`, `online`                     |

`set_alarm_mode` verwendet den Code der Zentrale aus der Konfiguration. Ein
abgelehnter Befehl hält die Szene nicht an: Prüfe `applied` in einer Bedingung
und verwende `error` in einer Benachrichtigung. Beispiel: _Um 23 Uhr den Alarm
teilweise scharf schalten; wenn `applied` nein ist, schicke mir `error`._

Die Standardaktionen von Gladys steuern die Geräte ebenfalls: Alarmmodus,
Schlösser und Steckdosen lassen sich mit **Gerät steuern** setzen.

## Schaltflächen der Konfigurationsseite

- **Verbindung testen**: meldet sich neu an und liest jede Zentrale.
- **Jetzt aktualisieren**: liest Sector Alarm sofort.

## Fehlerbehebung

| Was du siehst                                  | Was zu tun ist                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| „Sector Alarm lehnt E-Mail oder Passwort ab“   | Prüfe sie in der Sector-Alarm-App und speichere erneut.                                                                       |
| „Sector Alarm bittet um weniger Anfragen“      | Sector Alarm begrenzt Anfragen. Die Integration liest seltener und kehrt dann zum Normalbetrieb zurück. Erhöhe das Intervall. |
| „Sector Alarm ist nicht erreichbar“            | Prüfe den Internetzugang von Gladys.                                                                                          |
| „Der Code der Zentrale wird benötigt…“         | Trage den Code ein oder schalte nur mit Schnellaktivierung scharf.                                                            |
| Ein Sensor fehlt                               | Klicke auf **Jetzt aktualisieren** und sieh im Reiter **Geräteerkennung** nach: Neues Zubehör erscheint dort.                 |
| Der Modus bleibt während eines Ausfalls stehen | Gewollt: Eine Zentrale meldet sich offline immer als „scharf“, Gladys behält daher den letzten bekannten Modus.               |

## Datenschutz

Deine E-Mail-Adresse, dein Passwort und dein Code bleiben in Gladys, als
Geheimnisse, und werden nur an Sector Alarm (`mypagesapi.sectoralarm.net`)
gesendet. Die Integration nutzt keinen anderen Dienst.

Diese Integration wird von Sector Alarm weder erstellt noch unterstützt. Sie
verwendet dieselbe API wie die Sector-Alarm-App, die sich ohne Vorankündigung
ändern kann.
