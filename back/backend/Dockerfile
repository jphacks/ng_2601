FROM python:3.12-slim
WORKDIR /app
COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir \
    'fastapi>=0.115,<1.0' \
    'httpx>=0.27,<1.0' \
    'psycopg[binary]>=3.2,<4.0' \
    'PyJWT[crypto]>=2.9,<3.0' \
    'uvicorn[standard]>=0.30,<1.0'
COPY backend/app ./app
COPY config /app/config
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
