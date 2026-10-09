FROM python:3.11-slim

WORKDIR /app

# Cài đặt các thư viện cần thiết
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Sao chép toàn bộ mã nguồn
COPY . .

# Mở cổng 8000
EXPOSE 8000

ENV HOST=0.0.0.0
ENV PORT=8000

# Khởi chạy server Python
CMD ["python", "server.py"]

