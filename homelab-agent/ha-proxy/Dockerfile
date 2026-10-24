FROM python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704

WORKDIR /app
RUN pip install --no-cache-dir httpx==0.28.1
COPY proxy.py .

RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && chown app:app proxy.py
USER 10001

ENV PORT=8080
CMD ["python", "proxy.py"]
