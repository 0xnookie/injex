# injex CLI and MCP server. No npm dependencies: Node and the source are all it needs (git only lets
# `injex scan` follow .gitignore in a mounted repository).
#
#   docker run --rm -v "$PWD:/work:ro" ghcr.io/0xnookie/injex scan
#   docker run --rm -i ghcr.io/0xnookie/injex clean < in.txt > out.txt
#   docker run --rm -i -v "$PWD:/work:ro" ghcr.io/0xnookie/injex mcp      # MCP server on stdio
#
# Build: docker build -t injex .

FROM node:22-alpine

LABEL org.opencontainers.image.title="injex" \
      org.opencontainers.image.description="Find, remove and decode hidden text and prompt injection in text, files, PDFs, Office documents and URLs" \
      org.opencontainers.image.source="https://github.com/0xnookie/injex" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      io.modelcontextprotocol.server.name="io.github.0xnookie/injex"

# a mounted repository belongs to another user: let git list its files anyway (read-only use)
RUN apk add --no-cache git && git config --system safe.directory '*'

WORKDIR /opt/injex
COPY package.json LICENSE ./
COPY cli/ cli/
COPY src/core/ src/core/
COPY src/data/ src/data/
COPY src/transforms/ src/transforms/
COPY vendor/gpt-tokenizer/ vendor/gpt-tokenizer/
RUN ln -s /opt/injex/cli/injex.mjs /usr/local/bin/injex && chmod +x cli/injex.mjs

USER node
WORKDIR /work
ENTRYPOINT ["node", "/opt/injex/cli/injex.mjs"]
CMD ["--help"]
