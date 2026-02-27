#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import * as bson from "bson";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const repoRootPath = path.resolve(currentDirPath, "../..");
const require = createRequire(import.meta.url);

const operatorPath = path.join(repoRootPath, "operator.json");
const typePath = path.join(repoRootPath, "type.json");
const definitionsPath = path.join(repoRootPath, "definitions");

const Ajv = require("ajv").default;
const addFormats = require("ajv-formats").default;
const draft06MetaSchema = require("ajv/dist/refs/json-schema-draft-06.json");
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addMetaSchema(draft06MetaSchema);
addFormats(ajv);

const schemas = {
  'operator.json': ajv.compile(JSON.parse(fs.readFileSync(operatorPath, "utf8"))),
  'type.json': ajv.compile(JSON.parse(fs.readFileSync(typePath, "utf8"))) 
};

class BsonDate extends Date {
  constructor(value: string | number | Date) {
    if (typeof value === "string") {
      const number = Number(value);
      if (!Number.isNaN(number)) {
        value = number;
      }
    }
    super(value);
  }

  toString(): string {
    if (this.getTime() === 0) {
      return "0";
    }

    return this.toISOString();
  }
}

const loadOptions: yaml.LoadOptions = {
  schema: yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type("!bson_utcdatetime", {
      kind: "scalar",
      construct(data: string) {
        return new BsonDate(data);
      },
      instanceOf: BsonDate,
      represent(data) {
        if (data instanceof BsonDate) {
          return data.toString();
        }
        throw new Error(`Expected Date, but got ${data.constructor.name}`);
      },
    }),
    new yaml.Type("!bson_objectId", {
      kind: "scalar",
      construct(data: string) {
        return bson.ObjectId.createFromHexString(data);
      },
      predicate(data) {
        return data instanceof bson.ObjectId;
      },
      represent(data) {
        if (data instanceof bson.ObjectId) {
          return data.toHexString();
        }

        throw new Error(
          `Expected bson.ObjectId, but got ${data.constructor.name}`,
        );
      },
    }),
    new yaml.Type("!bson_uuid", {
      kind: "scalar",
      construct(data: string) {
        return bson.UUID.createFromHexString(data);
      },
      predicate(data) {
        return data instanceof bson.UUID;
      },
      represent(data) {
        if (data instanceof bson.UUID) {
          return data.toHexString();
        }

        throw new Error(`Expected bson.UUID, but got ${data.constructor.name}`);
      },
    }),
    new yaml.Type("!bson_regex", {
      kind: "scalar",
      construct(data: string) {
        return new bson.BSONRegExp(data);
      },
      predicate(data) {
        return data instanceof bson.BSONRegExp && !data.options;
      },
      represent(data) {
        if (data instanceof bson.BSONRegExp) {
          return data.pattern;
        }

        throw new Error(
          `Expected bson.BSONRegExp, but got ${data.constructor.name}`,
        );
      },
    }),
    new yaml.Type("!bson_regex", {
      kind: "sequence",
      construct([data, flags]: [string, string]) {
        return new bson.BSONRegExp(data, flags);
      },
      predicate(data) {
        return data instanceof bson.BSONRegExp && !!data.options;
      },
      represent(data) {
        if (data instanceof bson.BSONRegExp) {
          return [data.pattern, data.options];
        }

        throw new Error(
          `Expected bson.BSONRegExp, but got ${data.constructor.name}`,
        );
      },
    }),
    new yaml.Type("!bson_binary", {
      kind: "scalar",
      construct(data: string) {
        return bson.Binary.createFromBase64(data);
      },
      predicate(data) {
        return data instanceof bson.Binary;
      },
      represent(data) {
        if (data instanceof bson.Binary) {
          return data.toString("base64");
        }

        throw new Error(
          `Expected bson.Binary, but got ${data.constructor.name}`,
        );
      },
    }),
    new yaml.Type("!bson_decimal128", {
      kind: "scalar",
      construct(data: string) {
        return bson.Decimal128.fromString(data);
      },
      predicate(data) {
        return data instanceof bson.Decimal128;
      },
      represent(data) {
        if (data instanceof bson.Decimal128) {
          return data.toString();
        }

        throw new Error(
          `Expected bson.Decimal128, but got ${data.constructor.name}`,
        );
      },
    }),
    new yaml.Type("!bson_int64", {
      kind: "scalar",
      construct(data: string) {
        return bson.Long.fromString(data);
      },
      predicate(data) {
        return data instanceof bson.Long;
      },
      represent(data) {
        if (data instanceof bson.Long) {
          return data.toString();
        }

        throw new Error(`Expected bson.Long, but got ${data.constructor.name}`);
      },
    }),
  ]),
};

function findYamlFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findYamlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".yaml")) {
      files.push(fullPath);
    }
  }

  return files;
}

function findSchemaName(source: string): string | null {
  const firstLine = source.split("\n")[0].trim();
  const match = firstLine.match(/^#\s*\$schema:\s*(.+)$/);
  if (!match) {
    return null;
  }
  return path.basename(match[1]);
}

function parseYamlDocument(filePath: string): { document: unknown, schemaName: string} {
  const source = fs.readFileSync(filePath, "utf8");
  const schemaName = findSchemaName(source);

  if (!schemaName) {
    throw new Error(`Missing schema comment in ${filePath}. The first line must be a comment like "# $schema: <pathh-to-schema>"`);
  }

  return {
    document: yaml.load(source, loadOptions),
    schemaName 
  };
}

function updateDateParser(): void {
  // The default YAML schema will represent BsonDate using the Date representation because
  // it's a subclass of Date. We find the implicit type for Date and modify it to use predicate
  // instead of instanceOf, so it will only match Date instances that are not BsonDate.
  if ("implicit" in yaml.DEFAULT_SCHEMA) {
    const implicit = yaml.DEFAULT_SCHEMA.implicit as yaml.Type[];
    const timestamp = implicit.find((type) => type.instanceOf === Date);
    if (timestamp) {
      timestamp.instanceOf = null;
      timestamp.predicate = (data) => {
        return data instanceof Date && !(data instanceof BsonDate);
      };
    }
  }
}

function validate(): void {
  updateDateParser();
  const yamlFiles = findYamlFiles(definitionsPath).sort();

  if (yamlFiles.length === 0) {
    console.error(`No YAML files found under ${definitionsPath}/`);
    process.exit(1);
  }

  const failures: string[] = [];

  for (const file of yamlFiles) {
    try {
      const { document, schemaName } = parseYamlDocument(file);
      if (!(schemaName in schemas)) {
        throw new Error(`Schema "${schemaName}" not found for ${file}`);
      }
      const validateSchema = schemas[schemaName as keyof typeof schemas];
      const valid = validateSchema(document)

      if (!valid) {
        for (const error of validateSchema.errors ?? []) {
          const location = error.instancePath || "<root>";
          failures.push(`${file}: ${location}: ${error.message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${file}: ${message}`);
    }
  }

  if (failures.length > 0) {
    console.error("YAML/Schema validation failed:\n");
    console.error(failures.join("\n"));
    process.exit(1);
  }

  console.log(
    `Validated ${yamlFiles.length} YAML file(s) under ${definitionsPath} against ${operatorPath}`,
  );
}

validate();
