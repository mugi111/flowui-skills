import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseDocument, visit } from "yaml";

const maxDocumentBytes = 2 * 1024 * 1024;
const maxAliasCount = 20;

export class DocumentLoadError extends Error {
  constructor(readonly file: string, readonly code: string, readonly line?: number, readonly column?: number) {
    super(`${file}${line === undefined ? "" : `:${line}:${column ?? 1}`}: ${code}`);
    this.name = "DocumentLoadError";
  }
}

export async function loadDocument(file: string): Promise<unknown> {
  const extension = extname(file).toLowerCase();
  if (![".yaml", ".yml", ".json"].includes(extension)) throw new DocumentLoadError(file, "UNSUPPORTED_FORMAT");
  const buffer = await readFile(file);
  if (buffer.byteLength > maxDocumentBytes) throw new DocumentLoadError(file, "DOCUMENT_TOO_LARGE");
  const source = buffer.toString("utf8");
  if (extension === ".json") {
    try { return JSON.parse(source) as unknown; }
    catch { throw new DocumentLoadError(file, "INVALID_JSON"); }
  }
  const document = parseDocument(source, { uniqueKeys: true, prettyErrors: false });
  const syntaxError = document.errors[0];
  if (syntaxError) {
    const position = syntaxError.linePos?.[0];
    throw new DocumentLoadError(file, syntaxError.code, position?.line, position?.col);
  }
  let customTag = false;
  visit(document, (_key, node) => {
    if (node && typeof node === "object" && "tag" in node && typeof node.tag === "string") customTag = true;
  });
  if (customTag) throw new DocumentLoadError(file, "CUSTOM_TAG_NOT_ALLOWED");
  try { return document.toJS({ maxAliasCount }) as unknown; }
  catch { throw new DocumentLoadError(file, "INVALID_YAML"); }
}
