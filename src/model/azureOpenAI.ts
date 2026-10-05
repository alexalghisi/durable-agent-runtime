import type { Message, ToolCall } from "../domain/types.ts";
import type { ModelClient, ModelResponse, ToolSpec } from "./ModelClient.ts";

interface ChatChoice {
    message: {
        content: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
}

interface ChatCompletion {
    choices: ChatChoice[];
    usage: { prompt_tokens: number; completion_tokens: number };
}

export interface AzureOpenAIConfig {
    endpoint: string;
    deployment: string;
    apiKey: string;
    apiVersion?: string;
    fetchImpl?: typeof fetch;
}

function toWire(message: Message): Record<string, unknown> {
    if (message.role === "tool") {
        return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.toolCalls?.length) {
        return {
            role: "assistant",
            content: message.content || null,
            tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
        };
    }
    return { role: message.role, content: message.content };
}

export class AzureOpenAIClient implements ModelClient {
    private readonly config: AzureOpenAIConfig;
    private readonly fetchImpl: typeof fetch;

    constructor(config: AzureOpenAIConfig) {
        this.config = config;
        this.fetchImpl = config.fetchImpl ?? fetch;
    }

    async complete(messages: Message[], tools: ToolSpec[]): Promise<ModelResponse> {
        const { endpoint, deployment, apiKey, apiVersion = "2024-10-21" } = this.config;
        const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
        const response = await this.fetchImpl(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": apiKey },
            body: JSON.stringify({
                messages: messages.map(toWire),
                tools: tools.map((tool) => ({ type: "function", function: tool })),
            }),
            signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
            throw new Error(`Azure OpenAI responded with HTTP ${response.status}`);
        }
        const completion = (await response.json()) as ChatCompletion;
        const message = completion.choices[0]?.message;
        const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: JSON.parse(call.function.arguments) as Record<string, unknown>,
        }));
        return {
            content: message?.content ?? "",
            toolCalls,
            usage: {
                inputTokens: completion.usage.prompt_tokens,
                outputTokens: completion.usage.completion_tokens,
            },
        };
    }
}
