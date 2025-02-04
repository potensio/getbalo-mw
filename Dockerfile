FROM node:18-slim

WORKDIR /app

COPY package*.json ./
COPY .npmrc ./

RUN npm ci --only=production

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"] 