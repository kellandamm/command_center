# TODO: pin python:3.12-slim by digest when registry lookup is available in CI.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker ./worker

RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && chown -R app:app /app
USER 10001

ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "worker.main"]
