"""Verify that web compression never buffers chat events or binary API data."""

import unittest

from backend.http_performance import WebCompressionMiddleware


class WebCompressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_api_chunks_are_forwarded_without_compression(self):
        for path, content_type in (("/api/aura/chat", "text/event-stream"),
                                   ("/api/manage/backups/download", "application/zip")):
            with self.subTest(path=path):
                messages = []
                first = b"data: first\n\n" * 200
                second = b"data: done\n\n"

                async def application(scope, receive, send):
                    await send({"type": "http.response.start", "status": 200,
                                "headers": [(b"content-type", content_type.encode())]})
                    await send({"type": "http.response.body", "body": first, "more_body": True})
                    self.assertEqual(messages[-1]["body"], first, "First chunk must be sent before producing the next one")
                    await send({"type": "http.response.body", "body": second})

                async def send(message):
                    messages.append(message)

                middleware = WebCompressionMiddleware(application, minimum_size=1000, compresslevel=5)
                await middleware({"type": "http", "path": path, "headers": [(b"accept-encoding", b"gzip")]}, None, send)
                self.assertEqual(len(messages), 3)
                self.assertEqual(messages[2]["body"], second)
                self.assertNotIn(b"content-encoding", dict(messages[0]["headers"]))
