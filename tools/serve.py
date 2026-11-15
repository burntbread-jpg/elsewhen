# -*- coding: utf-8 -*-
"""로컬 확인용 정적 서버. 사용법: python tools/serve.py [포트]

윈도우의 기본 http.server 는 .js 를 text/plain 으로 보내 ES 모듈이 막히는 경우가 있어
MIME 형식을 직접 지정한다.
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
    })

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        # 배포 환경(Vercel)과 같은 함수를 부른다: api/interpret.py
        if self.path.split("?")[0] != "/api/interpret":
            self.send_error(404)
            return
        import json
        sys.path.insert(0, os.path.join(ROOT, "api"))
        from interpret import interpret
        try:
            length = int(self.headers.get("content-length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if 0 < length <= 4000 else None
        except (ValueError, UnicodeDecodeError):
            payload = None
        result, status = interpret(payload)
        body = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


os.chdir(ROOT)
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print("serving %s at http://127.0.0.1:%d" % (ROOT, PORT))
    httpd.serve_forever()
