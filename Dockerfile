FROM node:22-alpine

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY packages/document/package.json packages/document/package.json
COPY packages/renderer-core/package.json packages/renderer-core/package.json
COPY packages/react/package.json packages/react/package.json
RUN npm ci
COPY . .
CMD ["npm", "test"]
