# ESP32-S3 N16R8 controller

Open `esp32_controller/esp32_controller.ino` in Arduino IDE. The adjacent
`config.h` contains the proposed pin mapping, polarity, timeouts and motor guard.
Install **esp32 by Espressif Systems** through Boards Manager and **ArduinoJson 7**
through Library Manager.

## Board settings

Confirm the full module marking first. For an ESP32-S3-WROOM-1 **N16R8** module,
use ESP32S3 Dev Module, 16 MB flash, QIO flash and OPI PSRAM. Choose a partition
scheme compatible with 16 MB flash. WROOM-2 **N16R8V** is different and needs OPI
flash; do not select flash mode based solely on the memory size.

For the board's **native USB** connector, enable USB CDC On Boot and use
UART0 / Hardware CDC upload mode. For an external USB-to-UART bridge connector,
disable USB CDC On Boot so `Serial` uses UART0. Choose the connected COM port.
Use a USB data cable. If upload does not connect, hold BOOT, tap RESET, release
BOOT and select the download port. Reset once after the first upload.

References: [Espressif USB CDC setup](https://docs.espressif.com/projects/arduino-esp32/en/latest/tutorials/cdc_dfu_flash.html),
[module flash and PSRAM settings](https://docs.espressif.com/projects/arduino-esp32/en/latest/troubleshooting.html).

## First test: communication only

Leave `HARDWARE_ENABLED=false`. Open Serial Monitor at **115200 baud** and set
line ending to **Newline**. Send:

```json
{"cmd":"ping","request_id":"bench-1"}
```

The response reports `status: "ready"`, `hardware_enabled: false`, whether the
controller is busy, and detected flash/PSRAM sizes in bytes. N16R8 should report
16777216 flash bytes and 8388608 PSRAM bytes when correctly configured. A zero
PSRAM result means PSRAM was not initialized; confirm the board settings.

The existing dispense protocol remains:

```json
{"cmd":"dispense","request_id":"bench-2","items":[{"slot":"A1","qty":1}]}
```

With outputs disabled, this returns `hardware_not_configured` without running a
motor. Once wiring is confirmed and hardware enabled, the controller runs one
motor at a time, waits for a debounced active-low drop signal, stops the motor,
waits for the sensor to clear, and returns the delivered quantity for every slot.
The most recent completed request is cached in RAM; this is not durable across
resets. The backend must not automatically retry physical dispensing.

## Wiring to confirm

Proposed motor control pins: A1–A5 = GPIO 4–8, B1–B5 = GPIO 9–13.
Shared active-low drop sensor = GPIO 14, configured with an internal pull-up.
GPIO 19/20 are reserved for native USB. Verify the exact carrier-board schematic.

These outputs assume a single control signal per motor. Step/direction drivers,
H-bridges needing multiple inputs, and motors requiring a full-turn home switch
need different control logic. Do not connect motors directly to GPIO pins.
Use an appropriate driver and motor supply, and ensure sensor outputs are
compatible with 3.3 V ESP32 inputs. Confirm enable polarity before enabling outputs.

## Connecting the application

Close Serial Monitor before the Node server opens the same port. Configure
`SERIAL_PATH` to the actual COM port and `HARDWARE_MODE=serial` for physical testing.
The current Omise test provider rejects real hardware, so keep it in mock mode
until a separate controlled hardware test configuration is prepared.

The sketch has not yet been compiled or flashed in this workspace. Neither
Arduino CLI nor PlatformIO was found on PATH during preparation.
