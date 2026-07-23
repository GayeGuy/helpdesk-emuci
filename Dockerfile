# Build du frontend + exécution du backend (service unique, même origine).
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm run build:all

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/package.json ./package.json
EXPOSE 3001
CMD ["sh", "-c", "node backend/seed.js && node backend/server.js"]
