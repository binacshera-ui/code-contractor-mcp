# Code Contractor MCP Server
# Professional MCP Server with AST-powered code intelligence

FROM node:20

ENV DEBIAN_FRONTEND=noninteractive

# Install all required tools and build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Basic tools
    git \
    zip \
    unzip \
    curl \
    wget \
    jq \
    nano \
    # ripgrep - super fast search engine (Rust-based)
    ripgrep \
    # Build tools (required for tree-sitter native modules)
    build-essential \
    make \
    cmake \
    g++ \
    python3 \
    python3-pip \
    python3-dev \
    # Node.js headers for native module compilation
    && rm -rf /var/lib/apt/lists/*

# Install Python linters
RUN pip3 install --no-cache-dir --break-system-packages \
    flake8 \
    pylint

# Install global Node.js tools
RUN npm install -g typescript ts-node eslint

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (including native tree-sitter modules)
# Use --build-from-source to ensure native modules compile correctly
RUN npm install --build-from-source

# Copy source code
COPY . .

# Create workspace mount point
RUN mkdir -p /workspace

# Environment
ENV MCP_WORKSPACE=/workspace
ENV NODE_ENV=production

# Run as MCP server (stdio)
CMD ["node", "server.js"]
