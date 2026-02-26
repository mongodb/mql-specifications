## Contributing

### Validating definition schemas

`schema.json` contains the JSON Schema for validating the operator and stage definition files under `definitions/`. To validate the definitions against the schema, you can use the `validate-definitions` script:

```bash
cd scripts/schema-validator
pnpm install
pnpm run validate
```

### Formatting

We use prettier and yamlfix to format the code and yaml files. You can run the following command to format the code:

```bash
# Install yamlfix if you don't have it already
brew install yamlfix

# Alternatively, you can also install via pip
pip install yamlfix

# Format the operator definitions
yamlfix --check definitions

# Format JSONSchema definition
npx prettier --check schema.json
```
