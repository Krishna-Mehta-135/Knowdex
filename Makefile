BENCH_COMPOSE := docker compose -f docker-compose.bench.yml

.PHONY: bench-up bench-down bench-trivial claim

bench-up:
	$(BENCH_COMPOSE) up -d --build --wait
	@curl --fail --silent --show-error http://127.0.0.1:18000/health >/dev/null
	@curl --fail --silent --show-error http://127.0.0.1:18080/health >/dev/null
	@curl --fail --silent --show-error http://127.0.0.1:19000/health >/dev/null
	@curl --fail --silent --show-error http://127.0.0.1:19100/health >/dev/null
	$(BENCH_COMPOSE) --profile seed run --rm --no-deps seed-bench
	@$(BENCH_COMPOSE) exec -T postgres-bench psql -U knowdex -d knowdex -tAc "SELECT count(*) FROM projectbench_seed" | grep -qx 2

bench-down:
	$(BENCH_COMPOSE) down --volumes --remove-orphans

bench-trivial:
	@mkdir -p bench/results
	@set -eu; \
		commit=$$(git rev-parse HEAD); \
		host_cpu=$$(sh bench/host-cpu.sh); \
		docker_version=$$(docker version --format '{{.Server.Version}}'); \
		host_os=$$(uname -srv); \
		container_id=$$($(BENCH_COMPOSE) ps -q http-backend-bench | head -n1); \
		digest=$$(test -n "$$container_id" && docker inspect "$$container_id" --format='{{.Image}}'); \
		test -n "$$commit"; test -n "$$host_cpu"; test -n "$$docker_version"; test -n "$$host_os"; \
		printf '%s\n' "$$digest" | awk 'length == 71 && substr($$0, 1, 7) == "sha256:" && substr($$0, 8) !~ /[^0-9a-f]/ { found=1 } END { exit found ? 0 : 1 }'; \
		BENCH_COMMIT=$$commit HOST_CPU=$$host_cpu DOCKER_VERSION=$$docker_version HOST_OS=$$host_os BENCH_IMAGE_DIGEST=$$digest \
		$(BENCH_COMPOSE) run --rm --no-deps \
			-e BENCH_COMMIT="$$commit" \
			-e HOST_CPU="$$host_cpu" \
			-e DOCKER_VERSION="$$docker_version" \
			-e HOST_OS="$$host_os" \
			-e BENCH_IMAGE_DIGEST="$$digest" \
			generator-bench node --experimental-strip-types /app/bench/trivial.ts /app/results/trivial.json; \
		node bench/validate-schema.mjs bench/results/trivial.json bench/result-schema.schema.json

claim: bench-trivial
