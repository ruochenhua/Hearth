// Progressive enhancement for browsers with the optional imperative WebMCP API.
// These actions use the same authenticated endpoints as the visible import center.
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: object;
  execute: (input: unknown) => Promise<unknown>;
};
export function registerImportTools(
  read: () => Promise<unknown>,
  scan: () => Promise<unknown>,
) {
  const context = (
    document as unknown as {
      modelContext?: {
        registerTool: (
          tool: Tool,
          options: { signal: AbortSignal },
        ) => void | Promise<void>;
      };
    }
  ).modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const validate = (input: unknown) => {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).length
    )
      throw new Error('Expected an empty object');
  };
  const tools: Tool[] = [
    {
      name: 'get_import_status',
      description:
        'Read the signed-in family album import queue and disk status.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        validate(input);
        return read();
      },
    },
    {
      name: 'start_folder_import',
      description:
        'Scan the configured computer import folder, queue new media, and open the import center. This does not indicate processing has finished.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute(input) {
        validate(input);
        return scan();
      },
    },
  ];
  for (const tool of tools) {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Unsupported experimental registration leaves the normal interface available. */
    }
  }
  return () => lifecycle.abort();
}
