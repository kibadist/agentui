const RESERVED = new Set([
  "Class", "Return", "Function", "Const", "Let", "Var", "Import", "Export",
  "Default", "If", "Else", "For", "While", "Do", "Switch", "Case", "Break",
  "Continue", "New", "This", "Super", "Typeof", "Instanceof", "Void", "Delete",
  "Throw", "Try", "Catch", "Finally", "Yield", "Async", "Await", "Static",
  "Public", "Private", "Protected", "Interface", "Implements", "Enum",
]);

export type ValidateResult = { ok: true } | { ok: false; error: string };

export function validateName(name: string): ValidateResult {
  if (!name || name.length < 2) {
    return { ok: false, error: "Component names must be PascalCase, e.g. QuoteCard." };
  }
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    return { ok: false, error: "Component names must be PascalCase, e.g. QuoteCard." };
  }
  if (RESERVED.has(name)) {
    return { ok: false, error: `"${name}" is a reserved word. Pick a different name.` };
  }
  return { ok: true };
}

export function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
