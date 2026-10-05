import { describe, expect, it, vi } from "vitest";

import { AzureOpenAIClient } from "../src/model/azureOpenAI.ts";

describe("AzureOpenAIClient", () => {
    it("maps messages and tool calls to the chat completions API and back", async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [{ message: { content: null, tool_calls: [{ id: "call_9", function: { name: "list_stickies", arguments: "{}" } }] } }],
                    usage: { prompt_tokens: 120, completion_tokens: 12 },
                }),
            ),
        );
        const client = new AzureOpenAIClient({ endpoint: "https://acme.openai.azure.com", deployment: "gpt-4o", apiKey: "k", fetchImpl });

        const response = await client.complete(
            [
                { role: "user", content: "Cluster" },
                { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "list_stickies", arguments: {} }] },
                { role: "tool", toolCallId: "call_1", content: "[]" },
            ],
            [{ name: "list_stickies", description: "List", parameters: { type: "object", properties: {} } }],
        );

        const [url, init] = fetchImpl.mock.calls[0] ?? [];
        expect(String(url)).toBe("https://acme.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21");
        expect(init?.headers).toMatchObject({ "api-key": "k" });
        const body = JSON.parse(String(init?.body)) as { messages: unknown[]; tools: unknown[] };
        expect(body.messages[1]).toEqual({
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_1", type: "function", function: { name: "list_stickies", arguments: "{}" } }],
        });
        expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "call_1", content: "[]" });
        expect(response).toEqual({
            content: "",
            toolCalls: [{ id: "call_9", name: "list_stickies", arguments: {} }],
            usage: { inputTokens: 120, outputTokens: 12 },
        });
    });

    it("surfaces HTTP failures", async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("busy", { status: 429 }));
        const client = new AzureOpenAIClient({ endpoint: "https://x", deployment: "d", apiKey: "k", fetchImpl });
        await expect(client.complete([], [])).rejects.toThrow("Azure OpenAI responded with HTTP 429");
    });
});
