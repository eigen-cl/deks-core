FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/document/package.json packages/document/package.json
COPY packages/renderer-core/package.json packages/renderer-core/package.json
COPY packages/render-preview/package.json packages/render-preview/package.json
COPY packages/react/package.json packages/react/package.json
RUN npm ci
COPY . .
CMD ["npm", "run", "verify"]
