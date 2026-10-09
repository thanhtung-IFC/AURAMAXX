import http.client
import socket
import sys
import threading
import unittest
from contextlib import closing
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import VisionFaceHTTPServer


class PingHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", "4")
        self.end_headers()
        self.wfile.write(b"pong")

    def log_message(self, *args):
        pass


class HTTPServerTests(unittest.TestCase):
    def setUp(self):
        self.server = VisionFaceHTTPServer(("127.0.0.1", 0), PingHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": .01})
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def test_cannot_start_another_server_on_the_same_port(self):
        with self.assertRaises(OSError):
            VisionFaceHTTPServer(self.server.server_address, PingHandler)

    def test_idle_browser_connection_does_not_block_other_requests(self):
        with closing(socket.create_connection(self.server.server_address, timeout=2)) as idle:
            idle.sendall(b"GET /")  # A partial request from a second browser connection.
            with closing(http.client.HTTPConnection(*self.server.server_address, timeout=2)) as connection:
                connection.request("GET", "/")
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.read(), b"pong")
            idle.sendall(b" HTTP/1.0\r\n\r\n")
            self.assertIn(b"200 OK", idle.recv(1024))


if __name__ == "__main__":
    unittest.main()
