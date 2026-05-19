export class SseHttpError extends Error {
  constructor(public readonly status: number, public readonly statusText: string) {
    super(`SSE HTTP ${status}: ${statusText}`);
    this.name = "SseHttpError";
  }
}

export interface SseTransportOptions {
  url: string;
  headers?: Record<string, string>;
  lastEventId?: string;
  signal: AbortSignal;
  onEvent: (raw: string, id: string | undefined) => void;
  onOpen: () => void;
  onError: (err: Error) => void;
}

export async function connectSse(opts: SseTransportOptions): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    ...(opts.headers ?? {}),
  };
  if (opts.lastEventId !== undefined) {
    headers["Last-Event-ID"] = opts.lastEventId;
  }

  let response: Response;
  try {
    response = await fetch(opts.url, { headers, signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    opts.onError(err as Error);
    return;
  }

  if (!response.ok) {
    opts.onError(new SseHttpError(response.status, response.statusText));
    return;
  }

  if (!response.body) {
    opts.onError(new Error("SSE response has no body"));
    return;
  }

  opts.onOpen();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let currentId: string | undefined;

  function flushEvent() {
    if (dataLines.length === 0) {
      dataLines = [];
      return;
    }
    const raw = dataLines.join("\n");
    dataLines = [];
    opts.onEvent(raw, currentId);
  }

  function processLine(line: string) {
    if (line === "") {
      flushEvent();
      return;
    }
    if (line.startsWith(":")) return;
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? "" : line.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "data":
        dataLines.push(value);
        break;
      case "id":
        currentId = value;
        break;
      case "event":
      case "retry":
        break;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        processLine(line);
      }
    }
    if (buffer.length > 0) {
      processLine(buffer);
      buffer = "";
    }
    flushEvent();
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    opts.onError(err as Error);
  }
}
