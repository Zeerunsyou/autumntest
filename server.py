"""Host the local Settings Studio UI and its private profile-sync API."""

from __future__ import annotations

import hmac
import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data" / "profiles.json"
TELEMETRY_FILE = BASE_DIR / "data" / "telemetry.json"
MAX_BODY_BYTES = 1_000_000
TELEMETRY_LOCK = threading.Lock()
DEFAULT_SETTINGS = {
    "movement": "Walk",
    "walkspeedenabled": False,
    "walkspeed": 45,
    "walkdynamic": False,
    "walkspeed2": 1.5,
    "tweenspeed": 6,
    "jumpshortcuts": False,
    "cannon": False,
}
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
}


def validate_settings(candidate: object) -> dict:
    if not isinstance(candidate, dict):
        raise ValueError("Each profile must contain a settings object.")
    settings = {**DEFAULT_SETTINGS, **candidate}
    if settings["movement"] not in ("Walk", "Tween"):
        raise ValueError("Movement style must be Walk or Tween.")
    for key in ("walkspeedenabled", "walkdynamic", "jumpshortcuts", "cannon"):
        if not isinstance(settings[key], bool):
            raise ValueError(f"{key} must be true or false.")
    for key, low, high, integer in (
        ("walkspeed", 30, 90, True),
        ("walkspeed2", 1, 2, False),
        ("tweenspeed", 1, 12, True),
    ):
        value = settings[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
            raise ValueError(f"{key} must be between {low} and {high}.")
        settings[key] = round(value) if integer else round(value * 10) / 10
    return {key: settings[key] for key in DEFAULT_SETTINGS}


def validate_profiles(payload: object) -> list[dict]:
    if not isinstance(payload, dict) or not isinstance(payload.get("profiles"), list):
        raise ValueError("Request must contain a profiles array.")
    if not payload["profiles"] or len(payload["profiles"]) > 100:
        raise ValueError("Provide between 1 and 100 profiles.")
    profiles = []
    names = set()
    ids = set()
    for candidate in payload["profiles"]:
        if not isinstance(candidate, dict):
            raise ValueError("Each profile must be an object.")
        name = candidate.get("name")
        profile_id = candidate.get("id")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 40:
            raise ValueError("Profile names must contain 1 to 40 characters.")
        if not isinstance(profile_id, str) or not profile_id or len(profile_id) > 100:
            raise ValueError("Each profile needs a valid id.")
        normalized_name = name.strip().casefold()
        if normalized_name in names or profile_id in ids:
            raise ValueError("Profile names and ids must be unique.")
        names.add(normalized_name)
        ids.add(profile_id)
        profiles.append({
            "id": profile_id,
            "name": name.strip(),
            "settings": validate_settings(candidate.get("settings")),
        })
    return profiles


class DashboardHandler(BaseHTTPRequestHandler):
    server_version = "SettingsStudio/1.0"
    sys_version = ""

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "connect-src 'self'; img-src 'self' data:; base-uri 'none'; "
            "form-action 'self'; frame-ancestors 'none'",
        )
        super().end_headers()

    def send_json(self, status: int, body: dict) -> None:
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def authorized(self) -> bool:
        supplied = self.headers.get("X-API-Key", "")
        if not supplied:
            authorization = self.headers.get("Authorization", "")
            prefix = "Bearer "
            if authorization.startswith(prefix):
                supplied = authorization[len(prefix):]
        return hmac.compare_digest(supplied, self.server.api_key)

    def require_auth(self) -> bool:
        if not self.authorized():
            self.send_json(401, {"error": "Unauthorized. Check the server access key."})
            return False
        return True

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/health":
            if self.require_auth():
                self.send_json(200, {"message": "Connected to your Settings Studio host."})
            return
        if path == "/api/profiles":
            if not self.require_auth():
                return
            try:
                profiles = load_profiles()
            except (OSError, json.JSONDecodeError) as error:
                self.log_error("Unable to load saved profiles: %s", error)
                self.send_json(500, {"error": "The host could not read its saved profiles."})
                return
            self.send_json(200, {"profiles": profiles})
            return
        if path == "/api/telemetry":
            if not self.require_auth():
                return
            try:
                with TELEMETRY_LOCK:
                    telemetry = load_telemetry()
            except (OSError, json.JSONDecodeError, ValueError) as error:
                self.log_error("Unable to load telemetry: %s", error)
                self.send_json(500, {"error": "The host could not read saved dashboard data."})
                return
            self.send_json(200, telemetry)
            return
        if path.startswith("/api/roblox-config/"):
            if not self.require_auth():
                return
            account_id = path.removeprefix("/api/roblox-config/")
            if not account_id.isdigit():
                self.send_json(400, {"error": "A numeric Roblox account id is required."})
                return
            try:
                with TELEMETRY_LOCK:
                    telemetry = load_telemetry()
            except (OSError, json.JSONDecodeError, ValueError) as error:
                self.log_error("Unable to load Roblox settings: %s", error)
                self.send_json(500, {"error": "The host could not read saved settings."})
                return
            settings = telemetry.get("roblox_configs", {}).get(account_id)
            if settings is None:
                self.send_json(404, {"error": "No Roblox settings have been synced for this account."})
            else:
                self.send_json(200, settings)
            return
        if path.startswith("/accounts/"):
            if not self.require_auth():
                return
            account_id = path.removeprefix("/accounts/")
            if not account_id.isdigit():
                self.send_json(400, {"error": "A numeric account id is required."})
                return
            try:
                with TELEMETRY_LOCK:
                    telemetry = load_telemetry()
            except (OSError, json.JSONDecodeError, ValueError) as error:
                self.log_error("Unable to load account data: %s", error)
                self.send_json(500, {"error": "The host could not read saved account data."})
                return
            self.send_json(200 if account_id in telemetry["accounts"] else 404, {})
            return
        static_file = STATIC_FILES.get(path)
        if static_file is None:
            self.send_json(404, {"error": "Not found."})
            return
        file_name, content_type = static_file
        try:
            contents = (BASE_DIR / file_name).read_bytes()
        except OSError as error:
            self.log_error("Unable to serve %s: %s", file_name, error)
            self.send_json(500, {"error": "The dashboard file could not be read."})
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(contents)))
        self.end_headers()
        self.wfile.write(contents)

    def do_PUT(self) -> None:
        if urlsplit(self.path).path != "/api/profiles":
            self.send_json(404, {"error": "Not found."})
            return
        if not self.require_auth():
            return
        raw_length = self.headers.get("Content-Length", "")
        try:
            length = int(raw_length)
        except ValueError:
            self.send_json(400, {"error": "A valid Content-Length header is required."})
            return
        if length < 1 or length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "Request body must be between 1 byte and 1 MB."})
            return
        try:
            payload = json.loads(self.rfile.read(length))
            profiles = validate_profiles(payload)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
            self.send_json(400, {"error": str(error)})
            return
        try:
            save_profiles(profiles)
        except OSError as error:
            self.log_error("Unable to save profiles: %s", error)
            self.send_json(500, {"error": "The host could not save profiles."})
            return
        self.send_json(200, {"message": f"Saved {len(profiles)} profile(s) on this host."})

    def do_POST(self) -> None:
        if not self.require_auth():
            return
        path = urlsplit(self.path).path
        allowed_paths = {
            "/accounts", "/graph", "/macro-stats", "/inventory",
            "/hive-state", "/sticker-index", "/logs/batch_new",
        }
        if path not in allowed_paths:
            if path.startswith("/api/roblox-config/"):
                if not self.require_auth():
                    return
                account_id = path.removeprefix("/api/roblox-config/")
                if not account_id.isdigit():
                    self.send_json(400, {"error": "A numeric Roblox account id is required."})
                    return
                raw_length = self.headers.get("Content-Length", "")
                try:
                    length = int(raw_length)
                    if length < 1 or length > MAX_BODY_BYTES:
                        raise ValueError
                    payload = json.loads(self.rfile.read(length))
                    settings = validate_settings(payload.get("settings") if isinstance(payload, dict) else None)
                except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                    self.send_json(400, {"error": str(error) or "Invalid settings payload."})
                    return
                try:
                    with TELEMETRY_LOCK:
                        telemetry = load_telemetry()
                        telemetry.setdefault("roblox_configs", {})[account_id] = {
                            "settings": settings,
                            "updated_at": int(time.time()),
                        }
                        save_telemetry(telemetry)
                except (OSError, json.JSONDecodeError, ValueError) as error:
                    self.log_error("Unable to save Roblox settings: %s", error)
                    self.send_json(500, {"error": "The host could not save Roblox settings."})
                    return
                self.send_json(200, {"message": "Roblox settings synced."})
                return
            self.send_json(404, {"error": "Not found."})
            return
        raw_length = self.headers.get("Content-Length", "")
        try:
            length = int(raw_length)
        except ValueError:
            self.send_json(400, {"error": "A valid Content-Length header is required."})
            return
        if length < 1 or length > MAX_BODY_BYTES:
            self.send_json(413, {"error": "Request body must be between 1 byte and 1 MB."})
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            self.send_json(400, {"error": f"Invalid JSON body: {error}"})
            return
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "Request body must be a JSON object."})
            return
        account_id = payload.get("roblox_account_id")
        if not isinstance(account_id, str) or not account_id.isdigit():
            self.send_json(400, {"error": "A numeric roblox_account_id is required."})
            return
        try:
            with TELEMETRY_LOCK:
                telemetry = load_telemetry()
                account = telemetry["accounts"].setdefault(account_id, {})
                if path == "/accounts":
                    account["account"] = {
                        "roblox_account_id": account_id,
                        "roblox_account_name": payload.get("roblox_account_name", ""),
                    }
                elif path == "/logs/batch_new":
                    logs = account.setdefault("logs", [])
                    incoming_logs = payload.get("logs", [])
                    if not isinstance(incoming_logs, list):
                        raise ValueError("logs must be an array.")
                    logs.extend(incoming_logs[-500:])
                    account["logs"] = logs[-1000:]
                    account["logs_received_at"] = int(time.time())
                else:
                    key = {
                        "/graph": "graph",
                        "/macro-stats": "macro_stats",
                        "/inventory": "inventory",
                        "/hive-state": "hive_state",
                        "/sticker-index": "sticker_index",
                    }[path]
                    account[key] = payload
                    account[f"{key}_received_at"] = int(time.time())
                save_telemetry(telemetry)
        except (OSError, json.JSONDecodeError) as error:
            self.log_error("Unable to save dashboard data: %s", error)
            self.send_json(500, {"error": "The host could not save dashboard data."})
            return
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        self.send_json(200, {"message": "Dashboard data saved on this host."})


def load_profiles() -> list[dict]:
    if not DATA_FILE.exists():
        return []
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    return validate_profiles(data)


def save_profiles(profiles: list[dict]) -> None:
    save_json_atomically(DATA_FILE, {"profiles": profiles})


def load_telemetry() -> dict:
    if not TELEMETRY_FILE.exists():
        return {"accounts": {}}
    data = json.loads(TELEMETRY_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("accounts"), dict):
        raise ValueError("Saved dashboard data has an invalid structure.")
    return data


def save_telemetry(telemetry: dict) -> None:
    save_json_atomically(TELEMETRY_FILE, telemetry)


def save_json_atomically(file_path: Path, data: dict) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=file_path.parent,
            prefix=f"{file_path.stem}-",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(data, temporary_file, indent=2)
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, file_path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main() -> None:
    api_key = os.environ.get("IDLELOCK_API_KEY", "")
    if len(api_key) < 24:
        raise SystemExit(
            "Set IDLELOCK_API_KEY to a random secret with at least 24 characters before starting."
        )
    host = os.environ.get("IDLELOCK_HOST", "0.0.0.0")
    port_value = os.environ.get("IDLELOCK_PORT", "8765")
    try:
        port = int(port_value)
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise SystemExit("IDLELOCK_PORT must be a number between 1 and 65535.") from None

    server = ThreadingHTTPServer((host, port), DashboardHandler)
    server.api_key = api_key
    print(f"Settings Studio is available on this PC at http://localhost:{port}")
    print(f"Listening on {host}:{port}.")
    print("Set IDLELOCK_HOST to 127.0.0.1 to restrict access to this PC.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Settings Studio.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
