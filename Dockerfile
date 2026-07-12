FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_GOUO_IMAGE_MODEL=gpt-image-2
ENV VITE_GOUO_BACKEND_ENABLED=true \
    VITE_GOUO_BACKEND_URL= \
    VITE_GOUO_IMAGE_MODEL=${VITE_GOUO_IMAGE_MODEL}
RUN npm run build

FROM nginx:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
