# syntax=docker/dockerfile:1
# This is an unbuilt deployment recipe. See README.md for the actual probe evidence.
ARG BASE_IMAGE=python:3.12-slim-bookworm
FROM ${BASE_IMAGE}

# Session-specific CAs are mounted only for the networked build steps, never
# copied into image layers. Use a complete public CA bundle for replacing trust.
RUN --mount=type=secret,id=proxy_ca,required=true \
    apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca update && \
    apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca install -y --no-install-recommends \
        chromium libnss3-tools ca-certificates fonts-liberation && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN --mount=type=secret,id=proxy_ca,required=true \
    PIP_CERT=/run/secrets/proxy_ca python -m pip install --no-cache-dir -r requirements.txt
COPY *.py /app/
COPY takeover/ /app/takeover/
COPY deploy/agent-public.pem /app/deploy/agent-public.pem
COPY runtime/entrypoint.py runtime/browser_smoke.py /app/runtime/
RUN groupadd --gid 1000 browser && useradd --uid 1000 --gid 1000 --create-home browser && \
    mkdir -p /browser-state && chown browser:browser /browser-state
USER browser
WORKDIR /app
ENTRYPOINT ["python", "/app/runtime/entrypoint.py"]
CMD ["python", "/app/runtime/browser_smoke.py"]
