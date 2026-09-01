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

const resolvedTargets = new WeakMap<object, WebMcpRegistrationTarget>();

export function resolveDocumentWebMcpTarget(
  candidate: unknown,
): WebMcpRegistrationTarget | null {
  if (!isRecord(candidate)) return null;
  const modelContext = candidate.modelContext;
  if (!isRecord(modelContext) || typeof modelContext.registerTool !== "function")
    return null;

  const cached = resolvedTargets.get(modelContext);
  if (cached) return cached;

  const target = modelContext as unknown as ModelContextCandidate;
  const resolved: WebMcpRegistrationTarget = {
    registerTool: (tool, options) => target.registerTool(tool, options),
  };
  resolvedTargets.set(modelContext, resolved);
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
