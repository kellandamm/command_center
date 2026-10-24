# TODO: pin python:3.12-slim by digest when registry lookup is available in CI.
FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir httpx==0.28.1
COPY proxy.py .

RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && chown app:app proxy.py
USER 10001

ENV PORT=8080
CMD ["python", "proxy.py"]
