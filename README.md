# Little Treats — Local Vending System v2

A complete local project with a pastel touch kiosk, an authenticated admin dashboard, Express/SQLite API, PromptPay QR generation, and an ESP32-S3 queue controller.

**Customer screen:** http://localhost:3000/  
**Admin dashboard:** http://localhost:3000/admin  
**First-run sample password:** `1234` (change before use).

This is a working implementation with a production build and automated API tests. It is **not yet commissioned for unattended real-world operation**: the actual motor drivers, drop sensors, cash acceptor and payment verification must be integrated and tested. Firmware is provided for your board configuration; it has not been compiled or tested on physical hardware here.

## Quick start: Windows, Raspberry Pi or Mini PC

Install Node.js **22.12+**. Extract the entire ZIP, then open a terminal in `vending-machine`:

```bash
npm ci
npm --prefix admin ci
```

Copy `.env.example` to `.env`. On Linux/macOS: `cp .env.example .env`. On Windows Command Prompt: `copy .env.example .env`.

The default configuration uses a simulated controller and simulated payment. To populate a new, empty database with 10 example products:

```bash
npm run seed:demo
npm run build
npm start
```

Now open **http://localhost:3000/** for the customer kiosk and **http://localhost:3000/admin** for administration. The ZIP also includes the compiled frontend. Both screens are served by the same local Express process. You do not open a `.jsx` file directly in a browser.

Select products, set quantities, add them to the bottom bag, choose Cash or Coin, and select **Simulate payment**. This button exists only when `DEMO_PAYMENTS=true` and the server enforces mock hardware. To try PromptPay, enter your registered PromptPay ID in Admin → Settings. The sample catalog uses emoji fallbacks; upload real product images to show them in both the grid and marquee.

Dependencies are installed once while online. All application assets, API, database, QR creation and fonts work without internet at runtime. A customer's bank transfer still needs the customer's banking connection, and confirming settlement requires a trusted integration or staff verification.

## Project architecture

```text
vending-machine/
├── server.js                         HTTP API, settings, orders, payment orchestration
├── database.js                       SQLite tables, password hashing, recovery
├── hardware.js                       Correlated JSON serial queue bridge
├── shared/ui-text.js                 Default labels / translation keys
├── admin/
│   ├── src/main.jsx                  / selects kiosk; /admin selects dashboard
│   ├── src/Kiosk.jsx                 Product selection, cart, payment, screensaver
│   ├── src/AdminDashboard.jsx        Login, stock, transactions, motors, reconciliation
│   ├── src/AdminSettings.jsx         Logo, text JSON, timezone, PromptPay, password
│   ├── src/Modal.jsx                 Native accessible dialog with focus handling
│   ├── src/api.js                    Fetch wrapper and THB formatting
│   ├── src/styles.css                Tailwind + pastel responsive layouts
│   ├── dist/                        Compiled offline frontend
│   ├── vite.config.js
│   ├── package.json
│   └── package-lock.json
├── firmware/esp32_controller/esp32_controller.ino
├── scripts/seed-demo.js
├── test/system.test.js
├── public/uploads/                   Product images and logos
├── ecosystem.config.cjs              One PM2 fork only
├── .env.example
├── package.json
└── package-lock.json
```

| Component | Responsibility |
|---|---|
| Kiosk React app | Shopping session, payment display, order status, idle reset |
| Node.js server | Authoritative prices/stock, payment ledger, serial orchestration |
| SQLite | Persistent settings, sessions, inventory, order and payment history |
| ESP32-S3 | Sequential motors, debounced drop detection, final delivery receipt |
| Trusted payment adapter / staff | Confirm actual received funds before dispensing |

Use exactly one kiosk browser session and one backend process per physical machine. The API serializes orders globally. Keep the kiosk browser profile persistent so an active order token survives reloads.

## Kiosk behavior

- Pastel backgrounds, translucent rounded cards, large touch controls, `clamp()` typography/padding, gentle animations and reduced-motion support.
- The product grid uses viewport-dependent pagination rather than a main-page scrollbar. Short/portrait displays show fewer products per page. The cart strip can pan horizontally; dialogs can scroll when necessary. Validate the final layout on your exact touchscreen, especially unusual resolutions or large OS text scaling.
- Cart supports multiple products, max 10 units per product and max 20 units per order, bounded by stock. The server independently validates everything and calculates prices in integer satang.
- Cart is persisted in localStorage within the shopping session. An old cart is discarded after 60 seconds of inactivity. Product edits can change availability; server validation remains authoritative.
- At 60 seconds without pointer/touch or keyboard activity, the cart clears, dialogs close, and a full-screen duplicated image marquee appears. One touch wakes it. Reduced-motion mode keeps the marquee static.
- An already-created order is stored separately from the cart. Idle timeout does **not** erase accepted money or an in-progress motor queue. Waking restores that order's status. Unpaid, zero-credit orders expire after five minutes; partially paid orders require staff help and never expire silently.
- Logo, labels and timezone come from `/api/settings`. Defaults are merged with translated keys, so untranslated labels still work. Admin changes appear within 10 seconds. PromptPay payloads are generated by the backend from its stored ID and authoritative order total, then rendered with `qrcode.react`.

## Dynamic settings

`settings` stores `store_logo`, `ui_text_json`, `timezone`, `promptpay_id`, and `admin_password`. The password value is a **salted scrypt hash**, never plaintext and never returned to the kiosk. ADMIN_PASSWORD initializes the database only; later change it through the dashboard. Changing it invalidates all admin sessions.

Settings API is deliberately whitelisted. UI text JSON accepts flat string values keyed by lowercase letters/underscores. Start with the existing dictionary in Admin → Settings, edit values (including Thai), and save. Timezones are validated against Node's Intl timezone support. PromptPay IDs accept a 10-digit Thai mobile number, 13-digit ID/tax number, or 15-digit wallet ID. Confirm the receiving account name in a bank app during commissioning.

Example update (authenticated):

```json
{
  "store_logo": "/uploads/actual-generated-uuid.webp",
  "ui_text_json": {
    "store_name": "มุมขนม",
    "headline": "เลือกขนมที่ชอบได้เลย",
    "touch_to_order": "แตะหน้าจอเพื่อสั่งซื้อ",
    "add_to_cart": "เพิ่มลงตะกร้า"
  },
  "timezone": "Asia/Bangkok",
  "promptpay_id": "YOUR_REGISTERED_ID"
}
```

Use an actual uploaded image_url, or `""` to clear the logo. Uploads use multipart field `image`, maximum 5 MB. The server decodes actual image bytes, limits pixels, strips metadata by re-encoding to WebP, and generates filenames. Old uploaded files are retained to avoid accidentally breaking references; clean up unreferenced files during maintenance.

## API

Prices, payments and totals are integer **satang**: ฿35.00 → `3500`. Stored times use UTC; the kiosk clock uses the configured timezone.

| Method | Route | Authentication / body |
|---|---|---|
| POST | `/api/login` | `{password}` → opaque 8-hour token |
| POST | `/api/logout` | Admin bearer token |
| GET | `/api/settings` | Public safe settings; excludes password |
| PUT | `/api/settings` | Admin; logo/text/timezone/PromptPay fields |
| PUT | `/api/password` | Admin; `{current_password,new_password}` |
| GET | `/api/products` | Public product catalog |
| POST / PUT / DELETE | `/api/products`, `/api/products/:id` | Admin; validated stock/product changes |
| POST | `/api/upload` | Admin; multipart `image` |
| POST | `/api/checkout` | `Idempotency-Key`, `X-Order-Token`; cart and method |
| GET | `/api/orders/:id` | Same `X-Order-Token`; status / QR payload |
| POST | `/api/orders/:id/cancel` | Order token; only unpaid, not started |
| POST | `/api/orders/:id/demo-payment` | Order token; server-enforced demo only |
| POST | `/api/payments` | Trusted `X-Payment-Key`; payment event |
| POST | `/api/orders/:id/confirm-payment` | Admin; after independently verifying funds |
| POST | `/api/orders/:id/resolve` | Admin; actual delivered quantity for every slot |
| GET | `/api/stats` | Admin; totals, active orders, history, low stock |
| GET | `/api/hardware` | Admin; connection state and last 200 raw log entries |
| POST | `/api/hardware/test` | Admin; `{slot:"A1"}`, one physical vend |

Admin uses `Authorization: Bearer <session-token>`. Order access uses a separate high-entropy client-generated token, stored hashed in SQLite. Public settings never include admin or payment secrets. Admin sessions are stored in sessionStorage.

Cart request:

```json
{"items":[{"product_id":1,"qty":2},{"product_id":7,"qty":1}],"payment_method":"promptpay"}
```

Generate and persist an idempotency key and order token **before** submitting checkout. If the HTTP response is lost, retry the identical cart with the same keys. Creating the order reserves inventory but never starts motors. The included kiosk implements this flow.

## Omise PromptPay test mode

1. Sign in to https://dashboard.omise.co/ and switch to **Test** mode. Copy the **secret** test key from Keys.
2. Set these values in your local `.env`, keeping the other existing settings:

   ```dotenv
   PAYMENT_PROVIDER=omise_test
   OMISE_SECRET_KEY=skey_test_REPLACE_WITH_YOUR_KEY
   HARDWARE_MODE=mock
   DEMO_PAYMENTS=false
   ```

3. Run `npm run build`, then restart the server with `npm start`. Choose **PromptPay** for a cart worth at least THB 20. No PromptPay ID or public key is needed for this server-side integration.
4. In the Omise test dashboard, open the charge matching the order ID in its description. Before the five-minute expiry, use **Actions → Successful** or **Failed**. The kiosk polls the charge through the server and simulates dispensing only after a verified successful payment. Do not pay the test QR with a banking app.

The kiosk shows **Omise test** and disables local demo payments in this mode. Live keys and real hardware are rejected. The secret key stays on the server. Internet access is required; localhost works without a webhook or tunnel. Polling runs while the kiosk order page is open, including while the idle screen is displayed.

If charge creation fails, check the test key, connection and whether PromptPay is enabled on your Omise account. Check the dashboard before starting another order: a network timeout can leave a test charge there. Creation is never retried automatically for the same order. Failed, cancelled or locally expired orders never dispense, even if their test charge is subsequently marked successful; local cancellation does not cancel a charge at Omise. This adapter is for testing only; live payments need webhook/reconciliation and late-payment handling.

Official references: [test and live keys](https://docs.omise.co/what-are-test-keys-and-live-keys), [PromptPay setup and test actions](https://docs.omise.co/promptpay).

### QR API and webhook

`POST /api/payments/omise/qr` creates an order and its test PromptPay charge. Send `Content-Type: application/json`, an `Idempotency-Key` (16–100 characters), and an `X-Order-Token` (32–100 characters). Body:

```json
{"items":[{"product_id":1,"qty":1}]}
```

Prices come from the database. The response includes the order `id`, `omise_charge_id`, and `qr_image_url`. The image may initially be null while Omise generates it; poll `GET /api/orders/:id` with the same order token. Retry creation only with the same idempotency key and cart to avoid duplicate charges. Existing `/api/checkout` remains supported.

Register this **test-mode webhook URL** in the Omise dashboard:

```text
https://tinfoil-twins-capitol.ngrok-free.dev/api/webhooks/omise
```

Forward that ngrok domain to the app's port (normally 3000) and keep both processes running. Restart the app after code changes. Omise sends `POST` notifications; opening the URL in a browser does not test webhook delivery.

The endpoint processes `charge.complete` without a customer token. It independently retrieves the stored charge from Omise using the server secret key and checks test mode, order metadata, currency, amount and paid status. It never trusts payment claims in the webhook body. Duplicate notifications and polling share the same charge-based payment deduplication. Unknown charges and unrelated event types receive HTTP 200 and are ignored. Failed verification returns a non-2xx response; polling remains the fallback. Cancelled/expired orders never dispense on late notifications.

This implements Omise's [independent charge verification](https://docs.omise.co/api-webhooks) alternative; webhook signature verification is not configured. To test end to end, create a fresh QR order and mark its charge Successful in the Omise test dashboard before expiry. The webhook can trigger simulated dispensing even with the kiosk page closed.

## Payment integration boundary

`promptpay-qr` generates a Thai EMV QR payload locally. `qrcode.react` renders it. This requires no paid QR generation service. **QR generation does not verify payment**, and a browser “I paid” flag is never accepted as live payment proof.

In demo mode, the simulation button credits the order. In live mode, staff may independently verify funds and use **Confirm received payment**, or an authenticated local adapter can report confirmed credits:

```http
POST /api/payments
X-Payment-Key: YOUR_OS_PROTECTED_ADAPTER_KEY
Content-Type: application/json
```

```json
{"order_id":"actual-order-uuid","amount":1000,"event_id":"durable-unique-device-event-123"}
```

Cash/coin credits may accumulate. The adapter must durably retry each event with the same event_id; duplicate events are not credited twice. The last credit starts dispensing exactly once in the normal running process. Put the payment key in OS-protected adapter configuration, **never** in the customer or admin JS bundle.

The generic controller supplied here handles dispensing, not a specific cash acceptor protocol. The adapter must associate each physical payment with the active order, verify its method, manage acceptor inhibition, and reject/refund unexpected or late payments. There is no change-making hardware: overpayment is rejected by the API, so real acceptors must be inhibited before accepting excess denominations. A cancelled/expired QR can still be paid later at the bank; those transfers require external matching and refund handling. Do not run unattended live payments until this adapter path is completed and tested.

## Serial protocol and recovery

Fixed ten-slot layout: **A1–A5 and B1–B5**. Change the backend and firmware mappings together if the cabinet differs.

```json
{"cmd":"dispense","request_id":"order-uuid","items":[{"slot":"A1","qty":2},{"slot":"B2","qty":1}]}
```

Every message ends with `\n`. Controller response:

```json
{"status":"success","request_id":"order-uuid","delivered":[{"slot":"A1","qty":2},{"slot":"B2","qty":1}]}
```

Failure / partial delivery:

```json
{"status":"error","request_id":"order-uuid","error_code":"motor_jam","delivered":[{"slot":"A1","qty":1},{"slot":"B2","qty":0}]}
```

The bridge requires an exact request_id and a complete per-slot receipt for success. It never retries a physical command automatically. Timeout scales with total quantity. One active order blocks other orders and stock/settings edits. The ESP32 validates the entire cart before energizing any motor, dispenses sequentially, stops on the first failure, and waits for the sensor to clear between units.

A hardware timeout, malformed success receipt, disconnect or server restart during dispensing marks the order **uncertain**, keeps stock reserved and locks vending. Paid orders awaiting dispatch also become uncertain on restart. Staff must inspect physical quantities and enter delivered counts in **Reconcile / refund**. Only undelivered reserved stock is restored. The difference between paid funds and actual delivered value becomes `refund_due`; **this records an obligation and does not transfer money**. Refund separately using the payment system. Then power-cycle the controller and restart the API to clear a hardware lock and stale serial messages.

A motor and SQLite cannot share one atomic transaction. This system handles ambiguous physical outcomes with manual reconciliation; it does not claim exactly-once delivery through power loss. The firmware caches only its most recent result in RAM, so do not replay old commands after a reset.

## ESP32-S3 N16R8 wiring and configuration

1. Use a data-capable USB cable from Pi/Mini PC to the ESP32's serial-capable connector. Native USB vs UART-bridge connectors vary by board. For native USB Serial, enable USB CDC on boot in Arduino where required. Baud: **115200**. Close Serial Monitor before the Node server opens the device.
2. Install the ESP32 Arduino board package and **ArduinoJson 7**. Select the exact board's 16 MB flash / 8 MB PSRAM configuration. Open `firmware/esp32_controller/esp32_controller.ino`.
3. Example motor GPIOs: A1–A5 → **4,5,6,7,8**; B1–B5 → **9,10,11,12,13**. Drop sensor → **14**. Verify against your board schematic. Reserve native USB 19/20; avoid flash/PSRAM, boot-strapping and onboard peripheral pins.
4. Connect GPIOs only to compatible motor-driver or relay inputs, never directly to motors. Use a suitable separate motor supply, fuse, flyback protection, and a common logic ground for non-isolated drivers. Follow the module schematic for isolated drivers. Do not back-power USB.
5. The sensor is normally HIGH and active LOW. Its output must be 3.3 V safe. Set MOTOR_ON/OFF for your driver's polarity; use hardware pull resistors or driver enable circuitry so reset/boot keeps motors off.
6. `HARDWARE_ENABLED=false` initially. Verify the unloaded driver outputs and sensor first, then enable it. `SIMULATE_SENSOR=false` must remain false for real vending. Simulated sensing is only for bench tests. Tune the 3.5-second motor cutoff, 25 ms debounce, and inter-unit clearance time for actual mechanics.
7. Provide a physical means to cut motor power. Test all slots, a blocked sensor, no-drop timeout, cable disconnect and power loss before real operation.

The non-blocking loop limits serial parsing work so motor timeouts still execute. A no-drop timeout is labeled motor_jam but is not a definitive diagnosis of a mechanical jam.

## Live configuration and PM2

Set a fresh payment key (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and update `.env`:

```dotenv
HARDWARE_MODE=serial
DEMO_PAYMENTS=false
SERIAL_PATH=/dev/serial/by-id/YOUR_ACTUAL_DEVICE
PAYMENT_API_KEY=YOUR_RANDOM_SECRET
DB_PATH=./data/vending-v2.sqlite
HOST=127.0.0.1
PORT=3000
```

Use a fresh DB_PATH for live use so demo transactions do not contaminate revenue. Set ADMIN_PASSWORD before initializing that database.

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
# Run the exact startup command printed by PM2, then:
pm2 save
pm2 logs vending
```

PM2 runs exactly one fork. Do not use cluster mode. Linux serial permission may require `sudo usermod -aG dialout "$USER"`, then logging out and back in. Use `ls -l /dev/serial/by-id/` to choose the stable device path. If better-sqlite3 cannot use a prebuilt binary, install `build-essential` and `python3` before npm ci.

The API binds to loopback. For remote maintenance, use an SSH tunnel rather than exposing the PIN-based admin publicly. Keep `.env` readable only to the service account. A local kiosk browser is a trusted machine interface, not protection against someone with full OS/developer-tools access.

## Tests, backups and version 1 migration

```bash
npm test
npm run build
```

Seven automated tests cover multi-item stock reservation/payment/dispense, idempotency, expiry/cancel, partial cash/refund reconciliation, partial hardware failure, settings/password/PromptPay validation, image upload, and strict serial receipts. These tests use HTTP, SQLite and simulated serial; no browser visual QA or real board compile is claimed.

Version 2 intentionally uses a new database filename, `data/vending-v2.sqlite`. It refuses the old version 1 transaction schema. The old A1–A10 layout has changed to A1–A5/B1–B5. Keep the v1 database as an archive, export/re-enter products with verified slot mapping, and reconcile physical inventory before switching. Do not simply rename the old database.

Stop PM2 before backing up `data/` and `public/uploads/` together. Never copy just a live SQLite main file while ignoring WAL state. Keep `.env` protected separately. Restoring an old backup also restores old inventory: reconcile stock before enabling vending. Configure PM2 log rotation on the host.

Primary references: [promptpay-qr](https://github.com/dtinth/promptpay-qr), [qrcode.react](https://github.com/zpao/qrcode.react), [SerialPort](https://serialport.io/docs/), [ArduinoJson 7](https://arduinojson.org/v7/tutorial/deserialization/).
