BENCH_COMPOSE := docker compose -f docker-compose.bench.yml

.PHONY: bench-up bench-down bench-trivial bench-knowdex-coalesce claim

BENCH_WORKLOADS ?= one_typist five_typists paste_burst ai_stream

bench-up:
	$(BENCH_COMPOSE) up -d --build --wait
	@curl --fail --silent --show-error http://127.0.0.1:18000/health >/dev/null
	@curl --fail --silent --show-error http://127.0.0.1:18080/health >/dev/null
	@curl --fail --silent --show-error http://127.0.0.1:19000/health >/dev/null
	@curl --fail --silent --show-error http://127.0.0.1:19100/health >/dev/null
	$(BENCH_COMPOSE) --profile seed run --rm --no-deps seed-bench
	@$(BENCH_COMPOSE) exec -T postgres-bench psql -U knowdex -d knowdex -tAc "SELECT count(*) FROM projectbench_seed" | grep -qx 2
	@$(BENCH_COMPOSE) exec -T postgres-bench psql -U knowdex -d knowdex -tAc "SELECT count(*) FROM \"Content\" WHERE id = '00000000-0000-4000-8000-000000000002'" | grep -qx 1

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

bench-knowdex-coalesce:
	@set -eu; \
		memory_bytes=$$(docker info --format '{{.MemTotal}}'); \
		test "$$memory_bytes" -ge 12000000000 || { echo "Docker memory checkpoint not met: need at least 12 GB (decimal, 12000000000 bytes); 12 GiB (binary) is 12884901888 bytes; Docker reports $$memory_bytes bytes." >&2; exit 2; }; \
		$(MAKE) bench-up; \
		commit=$$(git rev-parse HEAD); host_cpu=$$(sh bench/host-cpu.sh); docker_version=$$(docker version --format '{{.Server.Version}}'); host_os=$$(uname -srv); \
		test -n "$$commit"; test -n "$$host_cpu"; test -n "$$docker_version"; test -n "$$host_os"; \
		mkdir -p bench/results; \
		for workload in $(BENCH_WORKLOADS); do \
			for variant_spec in 'baseline 0' 'candidate 16'; do \
				set -- $$variant_spec; variant=$$1; interval=$$2; \
				KNOWDEX_COALESCE_INTERVAL_MS=$$interval $(BENCH_COMPOSE) up -d --no-deps --force-recreate --wait ws-backend-bench >/dev/null; \
				curl --fail --silent http://127.0.0.1:18080/bench/config | grep -q '"coalesce_interval_ms":'"$$interval"; \
				$(BENCH_COMPOSE) run --rm --no-deps \
					-e KNOWDEX_VARIANT=$$variant -e KNOWDEX_COALESCE_INTERVAL_MS=$$interval -e BENCH_COMMIT=$$commit -e HOST_CPU="$$host_cpu" -e DOCKER_VERSION=$$docker_version -e HOST_OS="$$host_os" \
					generator-bench node --experimental-strip-types /app/bench/knowdex-coalesce.ts $$workload --warmup; \
			done; \
			for repetition in 1 2 3 4 5; do \
				for variant_spec in 'baseline 0' 'candidate 16'; do \
					set -- $$variant_spec; variant=$$1; interval=$$2; \
					KNOWDEX_COALESCE_INTERVAL_MS=$$interval $(BENCH_COMPOSE) up -d --no-deps --force-recreate --wait ws-backend-bench >/dev/null; \
					curl --fail --silent http://127.0.0.1:18080/bench/config | grep -q '"coalesce_interval_ms":'"$$interval"; \
					container_id=$$($(BENCH_COMPOSE) ps -q ws-backend-bench); digest=$$(docker inspect "$$container_id" --format='{{.Image}}'); \
					printf '%s\n' "$$digest" | grep -Eq '^sha256:[0-9a-f]{64}$$'; \
					$(BENCH_COMPOSE) run --rm --no-deps \
						-e KNOWDEX_VARIANT=$$variant -e KNOWDEX_REPETITION=$$repetition -e KNOWDEX_COALESCE_INTERVAL_MS=$$interval -e BENCH_COMMIT=$$commit -e BENCH_IMAGE_DIGEST=$$digest -e HOST_CPU="$$host_cpu" -e DOCKER_VERSION=$$docker_version -e HOST_OS="$$host_os" \
						generator-bench node --experimental-strip-types /app/bench/knowdex-coalesce.ts $$workload /app/results/$$variant-$$workload-$$repetition.json; \
				done; \
			done; \
		done
