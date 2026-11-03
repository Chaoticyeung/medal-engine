"""本地预览服务器：和 python -m http.server 一样，但每个响应都带 Cache-Control: no-store。
浏览器会缓存 ES 模块，改了 src/ 下的文件后强制刷新也可能拿到旧模块，新旧文件混用就加载失败。

用法：python3 tools/serve.py [端口，默认 8765]（在仓库根目录运行）
"""
import functools, http.server, os, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=root)).serve_forever()
