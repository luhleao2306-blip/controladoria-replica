import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { setRuntimeEnv } from "./lib/runtime-env";
import { replicaBindings } from "../scripts/replica-db.mjs";

let localBindings: ReturnType<typeof replicaBindings> | undefined;

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      localBindings ??= replicaBindings();
      setRuntimeEnv(localBindings);
      if (new URL(request.url).pathname === "/api/integrations/conta-azul/scheduler") {
        return new Response("Agendador desativado na réplica local.", { status: 404 });
      }
      if (new URL(request.url).pathname === "/mcp") {
        return new Response("Not found", { status: 404 });
      }
      const handler = await getServerEntry();
      const response = await normalizeCatastrophicSsrResponse(await handler.fetch(request, env, ctx));
      if (!(response.headers.get("content-type") ?? "").includes("text/html")) return response;
      // HTML references versioned chunks and must never outlive a deployment.
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store, max-age=0");
      headers.set("CDN-Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
  },
};
