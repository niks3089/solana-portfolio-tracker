FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* tsconfig.json ./
RUN npm install

COPY server ./server
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
