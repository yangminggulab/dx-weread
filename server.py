"""
WeRead + Dashboard 本地服务
运行: python3 server.py
访问: http://localhost:8080
"""

from __future__ import annotations

from flask import Flask, make_response, request

from routes.api import api
from services.cloud_sync import start_background_jobs as start_cloud_background_jobs
from services.config import LOCAL_BRIDGE_ALLOWED_ORIGINS
from services.storage import coerce_int_id
from services.weread_sync import start_background_jobs as start_weread_background_jobs


app = Flask(__name__)
app.register_blueprint(api)


def _apply_local_bridge_headers(response):
    origin = request.headers.get("Origin", "")
    if origin in LOCAL_BRIDGE_ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = request.headers.get("Access-Control-Request-Headers") or "Content-Type, Authorization"
        response.headers["Vary"] = "Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network"
        if request.headers.get("Access-Control-Request-Private-Network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.before_request
def _handle_local_bridge_preflight():
    if request.method == "OPTIONS" and request.path.startswith("/api/"):
        return _apply_local_bridge_headers(make_response("", 204))
    return None


@app.after_request
def _after_request(response):
    if request.path.startswith("/api/"):
        return _apply_local_bridge_headers(response)
    return response


if __name__ == "__main__":
    start_cloud_background_jobs()
    start_weread_background_jobs()
    host = "127.0.0.1"
    port = 8080
    try:
        import os

        host = os.environ.get("TASK_APP_HOST", host)
        port = coerce_int_id(os.environ.get("TASK_APP_PORT", str(port))) or port
    except Exception:
        pass
    print(f"Dashboard: http://{host}:{port}")
    app.run(host=host, port=port, debug=False)
