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
