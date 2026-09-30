FROM python:3.12-alpine

RUN pip install --no-cache-dir requests

WORKDIR /loadgen
COPY loadgen.py ./loadgen.py

ENV PYTHONUNBUFFERED=1 \
    LOADGEN_RATE_RPS=5 \
    LOADGEN_WINDOW_S=60 \
    LOADGEN_COUNTER_PATH=/var/metrics/loadgen_counter.json \
    LOADGEN_RANDOM_STATE=42

CMD ["python", "-u", "loadgen.py"]
