# Raspberry Pi Firefox Kiosk

Komplettpaket fuer einen Raspberry Pi, der nach dem Login automatisch das
Scoreboard in Firefox startet. Der Installer richtet gleichzeitig Firefox-Kiosk,
Sharkoon-Presenter-Tasten und das serielle 3x4-Keypad ein.

## Installation

Auf dem PI:

```bash
sudo apt update
sudo apt install -y git
git clone https://github.com/bojenet/billard-scoreboard.git
cd billard-scoreboard/raspberry-pi
chmod +x install-firefox-kiosk.sh
./install-firefox-kiosk.sh --table tisch1 --url "https://www.billard-studio.de/display.html?table=1"
sudo reboot
```

Das Script fragt das gemeinsame Keypad-Secret verdeckt ab. Fuer den zweiten Pi:

```bash
./install-firefox-kiosk.sh --table tisch2 --url "https://www.billard-studio.de/display.html?table=2"
```

Der Installer kann erneut ausgefuehrt werden, um die Konfiguration zu
aktualisieren. Ohne `--url` fragt er die URL ab. Das serielle Geraet laesst sich
bei Bedarf mit `--serial /dev/ttyACM0` aendern.

## Was installiert wird

- `firefox-esr`
- `unclutter`
- `x11-xserver-utils`
- Autostart-Datei: `~/.config/autostart/billard-kiosk.desktop`
- Startscript: `~/.local/bin/billard-kiosk.sh`
- Presenter-Mapping: `/etc/udev/hwdb.d/90-sharkoon-presenter.hwdb`
- Serieller Keypad-Dienst fuer `/dev/ttyUSB0` mit 115200 Baud
- Zentrale Keypad-Konfiguration: `/etc/default/billard-keypad`

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

Das Secret muss mit dem Supabase-Secret `BILLARD_KEYPAD_SECRET`
uebereinstimmen. Es wird waehrend der Installation verdeckt abgefragt und mit
nur fuer root lesbaren Rechten gespeichert.

## URL spaeter aendern

Den Installer erneut mit der neuen URL ausfuehren und neu starten:

```bash
./install-firefox-kiosk.sh --table tisch1 --url "https://www.billard-studio.de/display.html?table=1"
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

## Countdown-Warnton ueber HDMI

Das Main Scoreboard spielt bei Dreiband einmal einen kurzen Warnton ab, wenn
der laufende Countdown 10 Sekunden Restzeit erreicht. Ein neuer Countdown
oder ein Time-out aktiviert den Warnton erneut.

Auf jedem Pi einmal Firefox ausserhalb des Kioskmodus oeffnen und unter
`Einstellungen -> Datenschutz & Sicherheit -> Berechtigungen -> Automatische
Wiedergabe -> Einstellungen` die Vorgabe `Audio und Video erlauben` waehlen.
Der Kiosk startet private Fenster; deshalb die Vorgabe einstellen, statt sich
auf eine nur fuer die Website gespeicherte Ausnahme zu verlassen.

In den Audioeinstellungen des Pi den angeschlossenen HDMI-Ausgang waehlen.
TV und Pi duerfen nicht stummgeschaltet sein. Anschliessend Firefox im
Kioskmodus neu starten und einen 40-Sekunden-Countdown bis 10 laufen lassen.
Der Ton kommt vom Pi/TV, nicht von der steuernden App.

Mozilla-Anleitung: https://support.mozilla.org/en-US/kb/block-autoplay
