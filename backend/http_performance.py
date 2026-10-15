"""Compress public web responses without buffering API streams or backups."""

from starlette.middleware.gzip import GZipMiddleware


class WebCompressionMiddleware(GZipMiddleware):
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
        else:
            await super().__call__(scope, receive, send)
