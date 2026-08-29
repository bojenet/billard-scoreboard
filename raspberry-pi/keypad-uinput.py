#!/usr/bin/env python3
"""Forward a serial 3x4 keypad to Firefox as distinct numpad keys."""

import logging
import os
import time
import json
import uuid
from urllib import error, request

import serial
from evdev import UInput, ecodes


SERIAL_DEVICE = "/dev/ttyUSB0"
BAUD_RATE = 115200
RECONNECT_DELAY_SECONDS = 2
SUPABASE_URL = os.environ.get("BILLARD_SUPABASE_URL", "https://kstqhcaazuuxchqtnyfc.supabase.co").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("BILLARD_SUPABASE_ANON_KEY", "sb_publishable_0C-Hj42NxQ1UCHMkadC-Pw_KWDg6o2r")
KEYPAD_SECRET = os.environ.get("BILLARD_KEYPAD_SECRET", "")
DISPLAY_TABLE = os.environ.get("BILLARD_DISPLAY_TABLE", "").strip().lower()

KEY_MAP = {
    "0": ecodes.KEY_KP0,
    "1": ecodes.KEY_KP1,
    "2": ecodes.KEY_KP2,
    "3": ecodes.KEY_KP3,
    "4": ecodes.KEY_KP4,
    "5": ecodes.KEY_KP5,
    "6": ecodes.KEY_KP6,
    "7": ecodes.KEY_KP7,
    "8": ecodes.KEY_KP8,
    "9": ecodes.KEY_KP9,
    "*": ecodes.KEY_KPASTERISK,
    "#": ecodes.KEY_KPENTER,
}


def emit_key(keyboard: UInput, character: str) -> None:
    key_code = KEY_MAP.get(character)
    if key_code is None:
        logging.warning("Ignoring unexpected serial input: %r", character)
        return
    keyboard.write(ecodes.EV_KEY, key_code, 1)
    keyboard.syn()
    keyboard.write(ecodes.EV_KEY, key_code, 0)
    keyboard.syn()


def commit_series(points: int, request_id: str) -> bool:
    if not KEYPAD_SECRET or DISPLAY_TABLE not in {"tisch1", "tisch2"}:
        logging.error("BILLARD_KEYPAD_SECRET and BILLARD_DISPLAY_TABLE must be configured")
        return False

    payload = json.dumps({
        "table": DISPLAY_TABLE,
        "points": points,
        "requestId": request_id,
    }).encode("utf-8")
    api_request = request.Request(
        f"{SUPABASE_URL}/functions/v1/apply-keypad-series",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            "x-keypad-secret": KEYPAD_SECRET,
        },
    )
    try:
        with request.urlopen(api_request, timeout=10) as response:
            if response.status != 200:
                logging.error("Keypad backend returned HTTP %s", response.status)
                return False
        return True
    except (error.HTTPError, error.URLError, TimeoutError) as exc:
        logging.error("Could not commit keypad series: %s", exc)
        return False


def run() -> None:
    capabilities = {ecodes.EV_KEY: sorted(set(KEY_MAP.values()))}
    digits = ""
    pending_request_id = ""
    with UInput(capabilities, name="Billard Scoreboard Keypad") as keyboard:
        while True:
            try:
                logging.info("Opening %s at %s baud", SERIAL_DEVICE, BAUD_RATE)
                with serial.Serial(SERIAL_DEVICE, BAUD_RATE, timeout=1) as keypad:
                    while True:
                        raw_line = keypad.readline()
                        if not raw_line:
                            continue
                        line = raw_line.decode("ascii", errors="ignore").strip()
                        for character in line:
                            if character.isdigit():
                                if len(digits) < 4:
                                    digits += character
                                    pending_request_id = ""
                                    emit_key(keyboard, character)
                            elif character == "*":
                                digits = digits[:-1]
                                pending_request_id = ""
                                emit_key(keyboard, character)
                            elif character == "#":
                                points = int(digits) if digits else 0
                                if not pending_request_id:
                                    pending_request_id = str(uuid.uuid4())
                                if commit_series(points, pending_request_id):
                                    digits = ""
                                    pending_request_id = ""
                                    emit_key(keyboard, character)
                            else:
                                logging.warning("Ignoring unexpected serial input: %r", character)
            except (OSError, serial.SerialException) as error:
                logging.warning("Keypad unavailable: %s; retrying", error)
                time.sleep(RECONNECT_DELAY_SECONDS)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run()
