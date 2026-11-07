FROM node:20-alpine
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY backend/src ./src
COPY frontend/public ./public
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "src/index.js"]