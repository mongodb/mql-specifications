ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

yamlfix "$ROOT_DIR/definitions"
npx prettier --write "$ROOT_DIR/schema.json"
