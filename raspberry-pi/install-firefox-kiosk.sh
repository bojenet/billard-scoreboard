#!/usr/bin/env bash
set -euo pipefail

KIOSK_URL="${1:-https://www.billard-studio.de/display.html}"
APP_NAME="Billard Studio Kiosk"
SCRIPT_PATH="$HOME/.local/bin/billard-kiosk.sh"
DESKTOP_PATH="$HOME/.config/autostart/billard-kiosk.desktop"

echo "Installing Firefox kiosk for: $KIOSK_URL"

sudo apt update
sudo apt install -y firefox-esr unclutter x11-xserver-utils python3-evdev python3-serial

mkdir -p "$HOME/.local/bin" "$HOME/.config/autostart"

cat > "$SCRIPT_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

URL="$KIOSK_URL"

if command -v xset >/dev/null 2>&1 && [ -n "\${DISPLAY:-}" ]; then
  xset s off || true
  xset -dpms || true
  xset s noblank || true
fi

if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.5 -root >/dev/null 2>&1 &
fi

while true; do
  firefox-esr --kiosk --private-window "\$URL" || true
  sleep 5
done
EOF

chmod +x "$SCRIPT_PATH"

if [ -f "./keypad-uinput.py" ] && [ -f "./billard-keypad.service" ]; then
  echo "Installing serial keypad service."
  sudo install -m 0755 ./keypad-uinput.py /usr/local/bin/billard-keypad
  sudo install -m 0644 ./billard-keypad.service /etc/systemd/system/billard-keypad.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now billard-keypad.service
fi

cat > "$DESKTOP_PATH" <<EOF
[Desktop Entry]
Type=Application
Name=$APP_NAME
Exec=$SCRIPT_PATH
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

if [ -f "./90-sharkoon-presenter.hwdb" ]; then
  echo "Installing Sharkoon presenter key remap."
  sudo cp ./90-sharkoon-presenter.hwdb /etc/udev/hwdb.d/90-sharkoon-presenter.hwdb
  sudo systemd-hwdb update
  sudo udevadm trigger
fi

echo
echo "Done."
echo "Reboot the Pi with: sudo reboot"
echo "Autostart file: $DESKTOP_PATH"
echo "Kiosk script:   $SCRIPT_PATH"
