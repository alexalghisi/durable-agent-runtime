export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface Message {
    role: Role;
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
}

export interface Usage {
    inputTokens: number;
    outputTokens: number;
}

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface Span {
    name: string;
    startedAt: string;
    durationMs: number;
    attributes: Record<string, string | number | boolean>;
}

export interface Run {
    runId: string;
    boardId: string;
    goal: string;
    status: RunStatus;
    messages: Message[];
    steps: number;
    usage: Usage;
    spans: Span[];
    output?: string;
    error?: string;
    lease?: { owner: string; expiresAt: number };
    createdAt: string;
    updatedAt: string;
}
