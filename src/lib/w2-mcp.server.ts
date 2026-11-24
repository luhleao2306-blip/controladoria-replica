import { backgroundOwnerAuthorized, runBackgroundW2 } from "@/lib/conta-azul-background.server";

const tools = [
  { name: "w2_sync_status", description: "Confere a autorizacao e a ultima importacao automatica da W2, sem alterar dados financeiros.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "w2_sync_step", description: "Executa uma etapa duravel da importacao Conta Azul da W2. Repita enquanto status=continue. Pare em completed, busy ou erro. Nunca importa outras empresas.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
  { name: "somus_sync_status", description: "Confere a autorizacao e a ultima importacao automatica da Somus, separada da W2. Apenas vencimentos desde 01/09/2025.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "somus_sync_step", description: "Executa uma etapa duravel da importacao Conta Azul da Somus. Apenas vencimentos a partir de 01/09/2025 inclusive. Repita enquanto status=continue. Pare em completed, busy ou erro. Nunca importa W2 ou D61.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
];

export async function handleW2Mcp(request: Request) {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method === "GET") return new Response(null, { status: 405 });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const body = await request.text();
  if (body.length > 16_384) return json({ error: "Request too large" }, 413);
  let message: any;
  try { message = JSON.parse(body); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return json({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32600, message: "Invalid request" } });
  const reply = (result: unknown) => json({ jsonrpc: "2.0", id: message.id, result });
  if (message.method === "initialize") return reply({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "somus-w2-sync", version: "1.0.0" } });
  if (message.method.startsWith("notifications/")) return new Response(null, { status: 202 });
  if (message.method === "ping") return reply({});
  if (message.method === "server/discover") return reply({ supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
  if (message.method === "tools/list") return reply({ tools });
  if (message.method !== "tools/call") return json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  if (!backgroundOwnerAuthorized(request)) return json({ error: "Unauthorized" }, 403);
  if (!tools.some(tool => tool.name === message.params?.name) || Object.keys(message.params?.arguments ?? {}).length) {
    return json({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Invalid tool or arguments" } });
  }
  try {
    const result = await runBackgroundW2(message.params.name.endsWith("_status") ? "status" : "step", message.params.name.startsWith("somus_") ? "somus" : "w2");
    return reply({ content: [{ type: "text", text: JSON.stringify(result) }] });
  } catch {
    // No provider responses, financial descriptions or credentials in MCP errors/logs.
    return reply({ isError: true, content: [{ type: "text", text: "A atualizacao automatica nao foi concluida. Dados anteriores preservados. Confira a autorizacao e tente novamente." }] });
  }
}
