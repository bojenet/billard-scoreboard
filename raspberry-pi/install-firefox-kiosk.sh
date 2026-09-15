#!/usr/bin/env bash
set -euo pipefail

DEFAULT_URL="https://www.billard-studio.de/display.html"
KIOSK_URL="${BILLARD_KIOSK_URL:-}"
DISPLAY_TABLE="${BILLARD_DISPLAY_TABLE:-}"
KEYPAD_SECRET="${BILLARD_KEYPAD_SECRET:-}"
SERIAL_DEVICE="${BILLARD_SERIAL_DEVICE:-/dev/ttyUSB0}"
INSTALL_USER="${SUDO_USER:-$USER}"
INSTALL_HOME="$(getent passwd "$INSTALL_USER" | cut -d: -f6)"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$INSTALL_HOME/.local/bin/billard-kiosk.sh"
DESKTOP_PATH="$INSTALL_HOME/.config/autostart/billard-kiosk.desktop"

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}

usage() {
  cat <<'EOF'
Usage: ./install-firefox-kiosk.sh [OPTIONS]

Installiert Scoreboard-Kiosk, Sharkoon-Presenter-Mapping und serielles Keypad.

  --url URL             Scoreboard-URL (Standard: display.html)
  --table tisch1|tisch2 Zuordnung des Keypads
  --serial DEVICE       Serielles Geraet (Standard: /dev/ttyUSB0)
  --non-interactive     Fehlende Pflichtwerte nicht abfragen
  -h, --help            Hilfe anzeigen

Das Keypad-Secret wird sicher abgefragt. Alternativ koennen BILLARD_KIOSK_URL,
BILLARD_DISPLAY_TABLE, BILLARD_KEYPAD_SECRET und BILLARD_SERIAL_DEVICE als
Umgebungsvariablen gesetzt werden.
EOF
}

NON_INTERACTIVE=false
while (($#)); do
  case "$1" in
    --url) KIOSK_URL="${2:?Wert fuer --url fehlt}"; shift 2 ;;
    --table) DISPLAY_TABLE="${2:?Wert fuer --table fehlt}"; shift 2 ;;
    --serial) SERIAL_DEVICE="${2:?Wert fuer --serial fehlt}"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$KIOSK_URL" ]]; then
  if [[ "$NON_INTERACTIVE" == true ]]; then
    KIOSK_URL="$DEFAULT_URL"
  else
    read -r -p "Scoreboard-URL [$DEFAULT_URL]: " KIOSK_URL
    KIOSK_URL="${KIOSK_URL:-$DEFAULT_URL}"
  fi
fi

if [[ -z "$DISPLAY_TABLE" && "$NON_INTERACTIVE" == false ]]; then
  read -r -p "Tisch (tisch1 oder tisch2): " DISPLAY_TABLE
fi
DISPLAY_TABLE="${DISPLAY_TABLE,,}"
if [[ "$DISPLAY_TABLE" != "tisch1" && "$DISPLAY_TABLE" != "tisch2" ]]; then
  echo "Fehler: --table muss tisch1 oder tisch2 sein." >&2
  exit 2
fi

if [[ -z "$KEYPAD_SECRET" && "$NON_INTERACTIVE" == false ]]; then
  read -r -s -p "Gemeinsames Keypad-Secret: " KEYPAD_SECRET
  echo
fi
if [[ -z "$KEYPAD_SECRET" ]]; then
  echo "Fehler: Keypad-Secret fehlt (Eingabe oder BILLARD_KEYPAD_SECRET)." >&2
  exit 2
fi

for required_file in keypad-uinput.py billard-keypad.service 90-sharkoon-presenter.hwdb billard-kiosk.sh.template billard-kiosk.desktop.template; do
  if [[ ! -f "$SOURCE_DIR/$required_file" ]]; then
    echo "Fehler: $SOURCE_DIR/$required_file fehlt." >&2
    exit 1
  fi
done

echo "Installiere Billard-Scoreboard fuer $DISPLAY_TABLE ..."
sudo apt-get update
sudo apt-get install -y firefox-esr unclutter x11-xserver-utils python3-evdev python3-serial

install -d -m 0755 "$INSTALL_HOME/.local/bin" "$INSTALL_HOME/.config/autostart"
ESCAPED_URL="$(escape_sed_replacement "$KIOSK_URL")"
ESCAPED_SCRIPT_PATH="$(escape_sed_replacement "$SCRIPT_PATH")"
sed "s|@@KIOSK_URL@@|$ESCAPED_URL|g" "$SOURCE_DIR/billard-kiosk.sh.template" > "$SCRIPT_PATH"
chmod 0755 "$SCRIPT_PATH"
sed "s|@@KIOSK_SCRIPT@@|$ESCAPED_SCRIPT_PATH|g" "$SOURCE_DIR/billard-kiosk.desktop.template" > "$DESKTOP_PATH"
chmod 0644 "$DESKTOP_PATH"
chown -R "$INSTALL_USER:$INSTALL_USER" "$INSTALL_HOME/.local/bin" "$INSTALL_HOME/.config/autostart"

sudo install -m 0755 "$SOURCE_DIR/keypad-uinput.py" /usr/local/bin/billard-keypad
sudo install -m 0644 "$SOURCE_DIR/billard-keypad.service" /etc/systemd/system/billard-keypad.service
KEYPAD_CONFIG="$(mktemp)"
trap 'rm -f "$KEYPAD_CONFIG"' EXIT
{
  printf 'BILLARD_DISPLAY_TABLE=%q\n' "$DISPLAY_TABLE"
  printf 'BILLARD_KEYPAD_SECRET=%q\n' "$KEYPAD_SECRET"
  printf 'BILLARD_SERIAL_DEVICE=%q\n' "$SERIAL_DEVICE"
} > "$KEYPAD_CONFIG"
sudo install -m 0600 "$KEYPAD_CONFIG" /etc/default/billard-keypad

sudo install -m 0644 "$SOURCE_DIR/90-sharkoon-presenter.hwdb" /etc/udev/hwdb.d/90-sharkoon-presenter.hwdb
sudo systemd-hwdb update
sudo udevadm trigger
sudo systemctl daemon-reload
sudo systemctl enable billard-keypad.service
sudo systemctl restart billard-keypad.service

echo
echo "Installation abgeschlossen."
echo "  URL:    $KIOSK_URL"
echo "  Tisch:  $DISPLAY_TABLE"
echo "  Keypad: $SERIAL_DEVICE"
echo "Jetzt neu starten: sudo reboot"
