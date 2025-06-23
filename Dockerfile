# Stage 1: Base image with dependencies
FROM ubuntu:22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    icecast2 \
    ffmpeg \
    libmp3lame-dev \
    supervisor \
    opam \
    m4 \
    git \
    wget \
    ca-certificates \
    libfaad2 \
    libvorbis0a \
    libogg0 \
    libopus0 \
    libmad0 \
    libflac8 \
    libmp3lame0 \
    libtag1v5 \
    libtag1v5-vanilla \
    libssl-dev \
    libao-common \
    libao4 \
    liquidsoap \
    && rm -rf /var/lib/apt/lists/*

# Create a user for icecast, ensuring not to fail if group/user already exists
RUN if ! getent group icecast > /dev/null; then groupadd -r icecast; fi && \
    if ! getent passwd icecast > /dev/null; then useradd -r -g icecast -d /usr/share/icecast2 -s /sbin/nologin icecast; fi

# Setup working directory
WORKDIR /app

# Copy application files from the sub-directory into the container's /app directory
COPY bernie-radio-stream/ .

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Overwrite the default icecast config with our custom one
COPY bernie-radio-stream/icecast.xml /etc/icecast2/icecast.xml

# Ensure icecast user owns its log directory and config file
RUN mkdir -p /var/log/icecast2 && \
    chown -R icecast:icecast /var/log/icecast2 && \
    chown icecast:icecast /etc/icecast2/icecast.xml

# Expose ports
EXPOSE 8000 8001

# Start supervisord
CMD ["/usr/bin/supervisord", "-c", "/app/supervisord.conf"] 