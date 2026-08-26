#!/usr/bin/env bash
set -euo pipefail

required_paths=(
  "package.json"
  "package-lock.json"
  "next.config.ts"
  "vercel.json"
  "app/page.tsx"
  "app/layout.tsx"
  "app/api/crm/route.ts"
  "app/api/credit-policy/route.ts"
  "app/api/fulfilment/route.ts"
  "app/api/lms-queue/route.ts"
  "app/api/auth/login/route.ts"
  "app/credit-policy.mjs"
  "app/credit-policy-control.mjs"
  "app/fulfilment-control.mjs"
  "app/lms-queue.mjs"
  "public/loanbuddy-logo.png"
)

for required_path in "${required_paths[@]}"; do
  if [[ ! -f "$required_path" ]]; then
    echo "Missing required deployment file: $required_path" >&2
    exit 1
  fi
done

node -e "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')); JSON.parse(require('node:fs').readFileSync('vercel.json', 'utf8'))"

if ! grep -q '"next"' package.json; then
  echo "package.json does not declare Next.js." >&2
  exit 1
fi

echo "LoanBuddy CRM deployment artifact is structurally valid."
