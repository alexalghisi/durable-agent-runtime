import type { Message, ToolCall, Usage } from "../domain/types.ts";

export interface ToolSpec {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface ModelResponse {
    content: string;
    toolCalls: ToolCall[];
    usage: Usage;
}

export interface ModelClient {
    complete(messages: Message[], tools: ToolSpec[]): Promise<ModelResponse>;
}
