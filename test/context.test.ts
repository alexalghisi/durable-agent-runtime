import { describe, expect, it, vi } from "vitest";

import type { Message } from "../src/domain/types.ts";
import { compact, estimateTokens, extractiveSummary } from "../src/memory/context.ts";

function conversation(turns: number): Message[] {
    const messages: Message[] = [{ role: "system", content: "You are a facilitator." }, { role: "user", content: "Cluster the notes" }];
    for (let index = 0; index < turns; index += 1) {
        messages.push({ role: "assistant", content: "", toolCalls: [{ id: `c${index}`, name: "list_stickies", arguments: {} }] });
        messages.push({ role: "tool", toolCallId: `c${index}`, content: "x".repeat(400) });
    }
    return messages;
}

describe("compact", () => {
    it("returns the conversation untouched while it fits the budget", async () => {
        const messages = conversation(2);
        const summarize = vi.fn();
        expect(await compact(messages, estimateTokens(messages), 2, summarize)).toBe(messages);
        expect(summarize).not.toHaveBeenCalled();
    });

    it("keeps the system prompt and the most recent turns, summarising the rest", async () => {
        const messages = conversation(6);
        const compacted = await compact(messages, 200, 2, extractiveSummary);

        expect(compacted[0]).toEqual(messages[0]);
        expect(compacted[1]?.content).toMatch(/^Summary of earlier steps: user asked: Cluster the notes; tools already called: list_stickies/);
        expect(compacted.slice(2)).toEqual(messages.slice(-4));
        expect(estimateTokens(compacted)).toBeLessThan(estimateTokens(messages));
    });

    it("never separates a tool result from the call that produced it", async () => {
        const compacted = await compact(conversation(6), 200, 3, extractiveSummary);
        const firstKept = compacted[2];
        expect(firstKept?.role).toBe("assistant");
        for (const [index, message] of compacted.entries()) {
            if (message.role === "tool") {
                const previous = compacted.slice(0, index).findLast((candidate) => candidate.role === "assistant");
                expect(previous?.toolCalls?.map((call) => call.id)).toContain(message.toolCallId);
            }
        }
    });
});
