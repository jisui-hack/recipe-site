#!/usr/bin/env python3
"""
public/ をローカルに出すだけのサーバ。ただし **キャッシュを一切効かせない。**

素の `python3 -m http.server` だと、ブラウザが ES モジュールを強く抱え込み、
JS を直したのに古いものが動き続ける。原因が分からないまま
「直したはずなのに変わらない」で時間を溶かすので、毎回取りに行かせる。

    python3 tools/serve.py [ポート]        # 既定 3000
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # 404 だけ出す。200 の羅列は読みにくい
        if args and str(args[1]).startswith("4"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    root = Path(__file__).resolve().parent.parent / "public"
    handler = partial(NoCacheHandler, directory=str(root))
    print(f"http://localhost:{port}/add.html  ({root})")
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
