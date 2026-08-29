#!/usr/bin/env python3
"""Forward a serial 3x4 keypad to Firefox as distinct numpad keys."""

import logging
import time

import serial
from evdev import UInput, ecodes


SERIAL_DEVICE = "/dev/ttyUSB0"
BAUD_RATE = 115200
RECONNECT_DELAY_SECONDS = 2

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


def run() -> None:
    capabilities = {ecodes.EV_KEY: sorted(set(KEY_MAP.values()))}
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
                            emit_key(keyboard, character)
            except (OSError, serial.SerialException) as error:
                logging.warning("Keypad unavailable: %s; retrying", error)
                time.sleep(RECONNECT_DELAY_SECONDS)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run()
