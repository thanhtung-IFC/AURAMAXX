FROM python:3.12-slim-bookworm

WORKDIR /app

COPY requirements.txt requirements-postgres.txt ./
RUN pip install --no-cache-dir -r requirements-postgres.txt

# Sao chép toàn bộ mã nguồn
COPY . .

# Mở cổng 8000
EXPOSE 8000

ENV HOST=0.0.0.0
ENV PORT=8000
ENV PYTHONUNBUFFERED=1

# Khởi chạy server Python
CMD ["python", "run_web.py"]

