# Raspberry Pi Firefox Kiosk

Setup fuer einen Raspberry Pi, der nach dem Login automatisch Firefox im Kiosk-Modus startet.

## Installation

Auf dem PI:

```bash
sudo apt update
sudo apt install -y git
git clone https://github.com/bojenet/billard-scoreboard.git
cd billard-scoreboard/raspberry-pi
chmod +x install-firefox-kiosk.sh
./install-firefox-kiosk.sh "https://www.billard-studio.de/display.html"
sudo reboot
```

Fuer Display 1 oder 2 die passende URL einsetzen, zum Beispiel:

```bash
./install-firefox-kiosk.sh "https://www.billard-studio.de/display.html?display=1"
./install-firefox-kiosk.sh "https://www.billard-studio.de/display.html?display=2"
```

## Was installiert wird

- `firefox-esr`
- `unclutter`
- `x11-xserver-utils`
- Autostart-Datei: `~/.config/autostart/billard-kiosk.desktop`
- Startscript: `~/.local/bin/billard-kiosk.sh`
- Optional: `90-sharkoon-presenter.hwdb`, wenn das Script aus diesem Ordner gestartet wird.
- Serieller Keypad-Dienst fuer `/dev/ttyUSB0` mit 115200 Baud

## 3x4-Keypad

Der Keypad-Dienst startet automatisch und verbindet sich nach einem USB-Ausfall erneut.

- `0` bis `9`: mehrstellige Serie eingeben
- `*`: letzte Ziffer loeschen
- `#`: Serie verbuchen und zum anderen Spieler wechseln
- `#` ohne Zifferneingabe: Nullaufnahme verbuchen und wechseln

Status und Protokoll pruefen:

```bash
systemctl status billard-keypad.service
journalctl -u billard-keypad.service -f
```

Vor dem ersten Start `/etc/default/billard-keypad` anlegen. Das Secret muss mit
dem Supabase-Secret `BILLARD_KEYPAD_SECRET` uebereinstimmen:

```bash
sudo nano /etc/default/billard-keypad
```

Beispiel fuer Display 1:

```text
BILLARD_DISPLAY_TABLE=tisch1
BILLARD_KEYPAD_SECRET=HIER_DAS_GEMEINSAME_SECRET
```

Danach:

```bash
sudo systemctl restart billard-keypad.service
```

## URL spaeter aendern

```bash
nano ~/.local/bin/billard-kiosk.sh
```

Dort die Zeile `URL="..."` anpassen und neu starten:

```bash
sudo reboot
```

## Autostart deaktivieren

```bash
mv ~/.config/autostart/billard-kiosk.desktop ~/.config/autostart/billard-kiosk.desktop.disabled
sudo reboot
```

## Bildschirm-Blanking

Das Script versucht per `xset`, Bildschirmschoner und DPMS zu deaktivieren. Falls der Monitor trotzdem schwarz wird, auf dem Pi zusaetzlich im Raspberry-Pi-Menue pruefen:

`Preferences -> Raspberry Pi Configuration -> Display -> Screen Blanking -> Off`
