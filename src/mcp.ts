import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { actionSchema, type RequestRecord } from './contracts.js';

const DEFAULT_URL = 'http://127.0.0.1:3741';
const RESPONSE_LIMIT = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

function gatewayUrl(path: string): URL {
  const raw = process.env.AAG_URL ?? DEFAULT_URL;
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new Error('AAG_URL must be a valid URL.');
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !new Set(['127.0.0.1', 'localhost', '[::1]']).has(base.hostname) ||
    base.username ||
    base.password
  ) {
    throw new Error('AAG_URL must use HTTP(S) on a loopback host and contain no credentials.');
  }
  return new URL(path.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`);
}

async function callGateway(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const token = process.env.AAG_TOKEN;
  if (!token)
    throw new Error(
      'AAG_TOKEN is required. Set it to the agent token from the gateway data directory.',
    );
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-AAG-Intent'] = 'agent';
  }
  const response = await fetch(gatewayUrl(path), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'error',
  });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > RESPONSE_LIMIT) {
        await reader.cancel();
        throw new Error('Gateway response exceeded the 16 MiB limit.');
      }
      chunks.push(value);
    }
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(data);
  let result: unknown = text;
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      /* Keep plain text for the error below. */
    }
  }
  if (!response.ok) {
    const detail =
      typeof result === 'object' && result !== null && 'error' in result
        ? String((result as { error: unknown }).error)
        : typeof result === 'string'
          ? result
          : JSON.stringify(result);
    throw new Error(`Gateway returned HTTP ${response.status}: ${detail}`);
  }
  return result;
}

function result(value: unknown): {
  content: [{ type: 'text'; text: string }];
  structuredContent: Record<string, unknown>;
} {
  const structuredContent =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent };
}

function errorResult(error: unknown): { content: [{ type: 'text'; text: string }]; isError: true } {
  return {
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

export async function runMcpServer(): Promise<void> {
  const server = new McpServer({ name: 'agent-approval-gate', version: '2.1.0' });
  server.registerTool(
    'aag_submit',
    {
      title: 'Submit action for policy evaluation',
      description:
        'Submit an action to Agent Approval Gate. The gateway evaluates policy and returns its persisted request record. This tool cannot approve actions.',
      inputSchema: z.object({ action: actionSchema }).strict(),
    },
    async ({ action }) => {
      try {
        return result(await callGateway('/v1/requests', { method: 'POST', body: action }));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    'aag_inspect',
    {
      title: 'Inspect action request',
      description: 'Read a request record visible to the authenticated agent.',
      inputSchema: z.object({ id: z.string().min(1).max(96) }).strict(),
    },
    async ({ id }) => {
      try {
        return result(await callGateway(`/v1/requests/${encodeURIComponent(id)}`));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    'aag_cancel',
    {
      title: 'Cancel action request',
      description:
        'Cancel an action request owned by the authenticated agent. This does not approve or execute it.',
      inputSchema: z.object({ id: z.string().min(1).max(96) }).strict(),
    },
    async ({ id }) => {
      try {
        return result(
          await callGateway(`/v1/requests/${encodeURIComponent(id)}/cancel`, {
            method: 'POST',
            body: {},
          }),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  server.registerTool(
    'aag_wait',
    {
      title: 'Wait for action result',
      description:
        'Wait until an action reaches a terminal state (COMPLETED, FAILED, DENIED, EXPIRED, CANCELLED), an optional requested target state, or the timeout. Returns the current actual record.',
      inputSchema: z
        .object({
          id: z.string().min(1).max(96),
          state: z.string().min(1).max(40).optional(),
          timeoutMs: z.number().int().min(0).max(60_000).default(60_000),
        })
        .strict(),
    },
    async ({ id, state, timeoutMs }) => {
      try {
        const deadline = Date.now() + timeoutMs;
        let record = (await callGateway(`/v1/requests/${encodeURIComponent(id)}`)) as RequestRecord;
        const terminal = new Set(['COMPLETED', 'FAILED', 'DENIED', 'EXPIRED', 'CANCELLED']);
        while (
          !terminal.has(record.state) &&
          (!state || record.state !== state) &&
          Date.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(500, deadline - Date.now())));
          record = (await callGateway(`/v1/requests/${encodeURIComponent(id)}`)) as RequestRecord;
        }
        return result(record);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
