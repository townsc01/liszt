FROM node:22-bookworm-slim
WORKDIR /srv/liszt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY public/ ./public/
COPY data/catalogue.json ./data/catalogue.json
ENV PORT=10000
CMD ["npm", "start"]
