"""Static server for previewing the built side panel. Serves .mjs as JavaScript (Windows maps it to text/plain)."""
import functools, http.server, mimetypes, sys

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
port = int(sys.argv[1])
root = sys.argv[2]
class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def end_headers(self):
        # Rebuilds keep the same file names; never let the browser reuse a stale copy.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


Handler = functools.partial(NoCacheHandler, directory=root)
http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
