"""WeRead + Dashboard 本地服务
运行: python3 web/server.py
访问: http://localhost:8080
"""

from __future__ import annotations

import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

_WEB_DIR = Path(__file__).resolve().parent
_ROOT_DIR = _WEB_DIR.parent
sys.path.insert(0, str(_ROOT_DIR))
sys.path.insert(0, str(_WEB_DIR))

from routes.api import handle_request
from services.cloud_sync import start_background_jobs as start_cloud_background_jobs
from services.config import LOCAL_BRIDGE_ALLOWED_ORIGINS, ROOT_DIR
from services.storage import coerce_int_id
from services.weread_sync import start_background_jobs as start_weread_background_jobs


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logging.info("%s %s", self.address_string(), fmt % args)

    def _cors_headers(self):
        origin = self.headers.get("Origin", "")
        if origin not in LOCAL_BRIDGE_ALLOWED_ORIGINS:
            return {}
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": (
                self.headers.get("Access-Control-Request-Headers") or "Content-Type, Authorization"
            ),
            "Vary": "Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network",
        }
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            headers["Access-Control-Allow-Private-Network"] = "true"
        return headers

    def _send_json(self, data, status=200, extra_headers=None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (ValueError, TypeError):
            length = 0
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    def do_OPTIONS(self):
        if not self.path.startswith("/api/"):
            self.send_error(405)
            return
        self.send_response(204)
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        self.end_headers()

    def _dispatch(self, method):
        path = self.path.split("?")[0]

        if path in ("/", "/dashboard.html"):
            html_path = os.path.join(ROOT_DIR, "dashboard.html")
            try:
                data = open(html_path, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except FileNotFoundError:
                self.send_error(404)
            return

        body = self._read_json_body() if method == "POST" else None
        cors = self._cors_headers() if path.startswith("/api/") else {}
        status, result = handle_request(method, path, body)
        self._send_json(result, status, cors)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    start_cloud_background_jobs()
    start_weread_background_jobs()
    host = os.environ.get("TASK_APP_HOST", "127.0.0.1")
    port = coerce_int_id(os.environ.get("TASK_APP_PORT", "8080")) or 8080
    print(f"Dashboard: http://{host}:{port}")
    ThreadingHTTPServer((host, port), _Handler).serve_forever()
