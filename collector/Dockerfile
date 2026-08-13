FROM python:3.12-alpine

COPY requirements.txt /tmp/requirements.txt

RUN apk add --no-cache docker-cli postgresql-libs \
    && apk add --no-cache --virtual .build-deps gcc musl-dev postgresql-dev \
    && pip install --no-cache-dir -r /tmp/requirements.txt \
    && apk del .build-deps

WORKDIR /collector
COPY collect.py ./collect.py

ENV PYTHONUNBUFFERED=1 \
    METRICS_DIR=/var/metrics \
    COLLECT_INTERVAL_S=10 \
    PROBE_TIMEOUT_S=5 \
    ERROR_WINDOW_S=60 \
    MAX_FILE_MB=50

CMD ["python", "-u", "collect.py"]
