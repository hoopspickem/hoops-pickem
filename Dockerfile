FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV DB_PATH=/data/pickem.db
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
