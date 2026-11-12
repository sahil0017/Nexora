FROM python:3.15-slim

WORKDIR /app

# Core inference + AWS SQS event consumer dependencies (fits in 256 MB on free-tier t3.micro).
RUN pip install --no-cache-dir \
    "fastapi>=0.115" \
    "uvicorn>=0.32" \
    "pydantic>=2.9" \
    "numpy>=2.1" \
    "boto3>=1.35"

COPY src/ ./src/

ENV PYTHONPATH=/app/src
EXPOSE 8000

CMD ["uvicorn", "nexora.inference.api:app", "--host", "0.0.0.0", "--port", "8000"]
