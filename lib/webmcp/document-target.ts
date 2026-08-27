import type {
  RegisteredWebMcpTool,
  WebMcpRegistrationTarget,
} from "@/lib/webmcp/registry";

interface ModelContextCandidate {
  registerTool: (
    tool: RegisteredWebMcpTool,
    options: { signal: AbortSignal },
  ) => Promise<void>;
}

export function resolveDocumentWebMcpTarget(
  candidate: unknown,
): WebMcpRegistrationTarget | null {
  if (!isRecord(candidate)) return null;
  const modelContext = candidate.modelContext;
  if (!isRecord(modelContext) || typeof modelContext.registerTool !== "function")
    return null;

  const target = modelContext as unknown as ModelContextCandidate;
  return {
    registerTool: (tool, options) => target.registerTool(tool, options),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
