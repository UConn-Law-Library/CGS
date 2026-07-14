function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`Only local JSON Schema references are supported: ${ref}`);
  return ref.slice(2).split("/").reduce((value, key) => value?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

function validFormat(value, format) {
  if (format === "date-time") return !Number.isNaN(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value);
  if (format === "uri") {
    try {
      const url = new URL(value);
      return Boolean(url.protocol && url.hostname);
    } catch {
      return false;
    }
  }
  return true;
}

export function validateSchema(value, schema) {
  const errors = [];

  function visit(instance, rule, pointer) {
    if (rule.$ref) {
      const target = resolveRef(schema, rule.$ref);
      if (!target) errors.push(`${pointer}: unresolved schema reference ${rule.$ref}`);
      else visit(instance, target, pointer);
      return;
    }
    if (Object.hasOwn(rule, "const") && instance !== rule.const) errors.push(`${pointer}: must equal ${JSON.stringify(rule.const)}`);
    if (rule.enum && !rule.enum.includes(instance)) errors.push(`${pointer}: must be one of ${rule.enum.join(", ")}`);

    if (rule.type) {
      const actual = typeOf(instance);
      const accepted = Array.isArray(rule.type) ? rule.type : [rule.type];
      const matches = accepted.includes(actual) || (actual === "integer" && accepted.includes("number"));
      if (!matches) {
        errors.push(`${pointer}: expected ${accepted.join(" or ")}, received ${actual}`);
        return;
      }
    }

    if (typeof instance === "string") {
      if (rule.minLength !== undefined && instance.length < rule.minLength) errors.push(`${pointer}: is shorter than ${rule.minLength}`);
      if (rule.pattern && !new RegExp(rule.pattern, "u").test(instance)) errors.push(`${pointer}: does not match ${rule.pattern}`);
      if (rule.format && !validFormat(instance, rule.format)) errors.push(`${pointer}: is not a valid ${rule.format}`);
    }
    if (typeof instance === "number" && rule.minimum !== undefined && instance < rule.minimum) {
      errors.push(`${pointer}: must be at least ${rule.minimum}`);
    }
    if (Array.isArray(instance)) {
      if (rule.minItems !== undefined && instance.length < rule.minItems) errors.push(`${pointer}: has fewer than ${rule.minItems} items`);
      if (rule.uniqueItems) {
        const unique = new Set(instance.map((item) => JSON.stringify(item)));
        if (unique.size !== instance.length) errors.push(`${pointer}: contains duplicate items`);
      }
      if (rule.items) instance.forEach((item, index) => visit(item, rule.items, `${pointer}/${index}`));
    }
    if (instance && typeof instance === "object" && !Array.isArray(instance)) {
      for (const key of rule.required ?? []) {
        if (!Object.hasOwn(instance, key)) errors.push(`${pointer}: missing required property ${key}`);
      }
      for (const [key, child] of Object.entries(instance)) {
        if (rule.properties?.[key]) visit(child, rule.properties[key], `${pointer}/${key}`);
        else if (rule.additionalProperties === false) errors.push(`${pointer}: unexpected property ${key}`);
      }
    }
  }

  visit(value, schema, "$" );
  return errors;
}
