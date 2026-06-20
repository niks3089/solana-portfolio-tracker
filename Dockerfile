FROM node:22-alpine AS build
WORKDIR /app

# Server deps + build
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install

COPY server ./server
RUN npm run build

# Client deps + build (Vite outputs to ../public/dist)
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install

COPY client ./client
COPY public ./public
RUN cd client && npm run build

FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
