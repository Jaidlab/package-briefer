ARG BUN_IMAGE=oven/bun:slim
FROM ${BUN_IMAGE}

WORKDIR /probe
COPY src/prepareDependencies.js /inspect/prepareDependencies.js
COPY src/discover.js /inspect/discover.js
COPY src/probe.js /inspect/probe.js

ARG PACKAGE_NAME
ARG PACKAGE_SPEC
ENV PACKAGE_NAME=${PACKAGE_NAME}
ENV PACKAGE_SPEC=${PACKAGE_SPEC}

RUN printf '{"private":true}' > package.json \
  && bun add --no-save "$PACKAGE_SPEC" \
  && bun /inspect/prepareDependencies.js

CMD ["bun", "/inspect/probe.js"]
