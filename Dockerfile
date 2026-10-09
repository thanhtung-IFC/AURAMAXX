FROM python:3.12-slim-bookworm

WORKDIR /app

# Microsoft ODBC Driver 18 is required by pyodbc in this Linux image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libgssapi-krb5-2 \
    && curl -fsSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o /tmp/microsoft-prod.deb \
    && dpkg -i /tmp/microsoft-prod.deb \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -f /tmp/microsoft-prod.deb \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-sqlserver.txt ./
RUN pip install --no-cache-dir -r requirements-sqlserver.txt

# Sao chép toàn bộ mã nguồn
COPY . .

# Mở cổng 8000
EXPOSE 8000

ENV HOST=0.0.0.0
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

# Khởi chạy server Python
CMD ["python", "server.py"]

