.PHONY: devdb demo-data web up down logs seed psql test test-integration events api-local tracker example

# --- no-Docker dev loop: run each in its own terminal ---
devdb:         ## local Postgres 17 on :5432, no Docker needed
	cd api && go run ./cmd/devdb

demo-data:     ## fill the DB with ~120 days of sample traffic
	cd api && go run ./cmd/demo-data -days 120

web:           ## dashboard on http://localhost:3001 (password from web/.env.local)
	cd web && npm run dev

# --- Docker ---
up: tracker    ## build tracker, start Postgres + API
	docker compose up -d --build

tracker:       ## build tracker/ -> api/static/t.js
	cd tracker && npm ci && npm run build

example:       ## serve the tracker test page on :3000
	cd tracker/example && python3 -m http.server 3000

down:
	docker compose down

logs:
	docker compose logs -f api

seed:          ## insert dev sites
	docker compose exec -T db psql -U tracker -d tracker < api/scripts/seed-dev.sql

psql:
	docker compose exec db psql -U tracker -d tracker

events:        ## send sample events
	bash api/scripts/send-test-events.sh

test:
	cd api && go test ./...
	cd tracker && npm test && npm run typecheck

test-integration:  ## real Postgres via embedded-postgres (no Docker needed)
	cd api && go test -tags integration -count=1 ./internal/integration/

api-local:     ## run the API on the host against the compose Postgres
	cd api && DATABASE_URL=postgres://tracker:tracker@localhost:5432/tracker?sslmode=disable \
		HASH_SECRET=dev-secret-change-me API_TOKEN=dev-token-change-me-please ALLOW_LOCALHOST=true LOG_LEVEL=debug go run ./cmd/server
