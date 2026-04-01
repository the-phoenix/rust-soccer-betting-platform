#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_PATH="${WASM_PATH:-$ROOT_DIR/target/wasm32-unknown-unknown/release/soccer_betting_contract.wasm}"
INIT_MSG_PATH="${INIT_MSG_PATH:-$ROOT_DIR/deployment/instantiate.local.json}"
LABEL="${LABEL:-soccer-betting}"
OUTPUT_FORMAT="${OUTPUT_FORMAT:-json}"

: "${CHAIN_CLI:?set CHAIN_CLI to your chain binary, for example wasmd or junod}"
: "${CHAIN_ID:?set CHAIN_ID to your target chain id}"
: "${NODE:?set NODE to your RPC endpoint, for example http://localhost:26657}"
: "${FROM:?set FROM to your local key name}"
: "${GAS_PRICES:?set GAS_PRICES to a fee value, for example 0.025ucosm}"

TX_FLAGS=(
  "--chain-id" "$CHAIN_ID"
  "--node" "$NODE"
  "--from" "$FROM"
  "--gas" "${GAS:-auto}"
  "--gas-adjustment" "${GAS_ADJUSTMENT:-1.3}"
  "--gas-prices" "$GAS_PRICES"
  "--yes"
  "--output" "$OUTPUT_FORMAT"
  "${EXTRA_TX_FLAG:-}"
)

trim_empty_flags() {
  local cleaned=()
  local item
  for item in "$@"; do
    if [[ -n "$item" ]]; then
      cleaned+=("$item")
    fi
  done
  printf '%s\n' "${cleaned[@]}"
}

mapfile -t TX_FLAGS < <(trim_empty_flags "${TX_FLAGS[@]}")

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "missing file: $path" >&2
    exit 1
  fi
}

extract_value() {
  local content="$1"
  local key="$2"
  python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$content" "$key"
}

require_file "$WASM_PATH"
require_file "$INIT_MSG_PATH"

echo "Building schema and wasm artifacts"
cargo run --bin schema >/dev/null
cargo build --release --target wasm32-unknown-unknown >/dev/null

echo "Storing wasm: $WASM_PATH"
STORE_OUTPUT="$("$CHAIN_CLI" tx wasm store "$WASM_PATH" "${TX_FLAGS[@]}")"
echo "$STORE_OUTPUT"

CODE_ID="$(extract_value "$STORE_OUTPUT" "code_id")"
if [[ -z "$CODE_ID" ]]; then
  echo "failed to extract code_id from store transaction output" >&2
  exit 1
fi

echo "Instantiating code id $CODE_ID"
INSTANTIATE_OUTPUT="$("$CHAIN_CLI" tx wasm instantiate "$CODE_ID" "$(cat "$INIT_MSG_PATH")" --label "$LABEL" --no-admin "${TX_FLAGS[@]}")"
echo "$INSTANTIATE_OUTPUT"

CONTRACT_ADDRESS="$(extract_value "$INSTANTIATE_OUTPUT" "contract_address")"
if [[ -z "$CONTRACT_ADDRESS" ]]; then
  echo "failed to extract contract_address from instantiate transaction output" >&2
  exit 1
fi

cat <<EOF
Deployment complete
code_id=$CODE_ID
contract_address=$CONTRACT_ADDRESS
EOF
