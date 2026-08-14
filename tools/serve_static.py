"""Static file server for local preview. Reads the port from the PORT env
var (falls back to 8000) instead of a hardcoded CLI flag, so the preview
tooling can assign a free port when 8000 is already taken."""
import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", 8000))

with socketserver.TCPServer(("", PORT), http.server.SimpleHTTPRequestHandler) as httpd:
    print(f"Serving on port {PORT}")
    httpd.serve_forever()
