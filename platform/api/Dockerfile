FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/nexora-api ./cmd/server

FROM alpine:3.20
RUN adduser -D nexora
USER nexora
COPY --from=build /bin/nexora-api /usr/local/bin/nexora-api
EXPOSE 8080
ENTRYPOINT ["nexora-api"]
