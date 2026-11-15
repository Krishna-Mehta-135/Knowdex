#!/bin/sh

set -eu

host_os=$(uname -s)
cpu=

case "$host_os" in
    Darwin)
        cpu=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || true)
        if test -z "$cpu" && command -v system_profiler >/dev/null 2>&1; then
            cpu=$(system_profiler SPHardwareDataType 2>/dev/null |
                awk -F': ' '/^[[:space:]]*(Chip|Processor Name):/ { print $2; exit }')
        fi
        ;;
    Linux)
        cpu=$(awk -F': ' \
            '/^model name[[:space:]]*:/ { print $2; exit } \
             /^Hardware[[:space:]]*:/ { print $2; exit }' \
            /proc/cpuinfo 2>/dev/null || true)
        ;;
    *)
        cpu=
        ;;
esac

if test -z "$cpu"; then
    echo "unable to determine host CPU model on $host_os" >&2
    exit 1
fi

printf '%s\n' "$cpu"
