#!/usr/bin/env bash
# Optional operator-run inventory. This script neither modifies services nor
# reads environment files, private keys, certificate keys, or container env vars.
set -u
report() {
  printf '\n%s\n' "$1"
  shift
  "$@" 2>&1 || true
}
report 'CPU' lscpu
report 'Memory' free -h
report 'Storage capacity' df -h
report 'Network addresses' ip -brief address
report 'Network routes' ip route show
report 'Listening sockets (process names may require operator privileges)' ss -lntup
report 'Running services' systemctl list-units --type=service --state=running --no-pager
report 'Timers' systemctl list-timers --all --no-pager
report 'Docker availability' docker version --format '{{.Server.Version}}'
report 'Compose availability' docker compose version
report 'Existing containers and port assignments' docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
report 'Resource snapshot' docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}'
report 'Firewall (if readable without privilege)' nft list ruleset
report 'Legacy firewall (if readable without privilege)' iptables -S
report 'UFW (if available/readable)' ufw status verbose
printf '\nProvider bandwidth/transfer quotas, hardware reservations, authoritative DNS, certificate renewal, Plesk ownership and Coturn authentication remain manual read-only checks.\n'
