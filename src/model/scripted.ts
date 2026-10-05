import type { Message } from "../domain/types.ts";
import type { ModelClient, ModelResponse, ToolSpec } from "./ModelClient.ts";

export type Script = (messages: Message[], tools: ToolSpec[]) => Omit<ModelResponse, "usage">;

export class ScriptedModel implements ModelClient {
    private readonly script: Script;

    constructor(script: Script) {
        this.script = script;
    }

    async complete(messages: Message[], tools: ToolSpec[]): Promise<ModelResponse> {
        const response = this.script(messages, tools);
        const input = messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0);
        return { ...response, usage: { inputTokens: input, outputTokens: Math.ceil(response.content.length / 4) + 8 } };
    }
}
