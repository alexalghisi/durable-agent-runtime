import type { Message } from "../domain/types.ts";

export type Summarize = (messages: Message[]) => Promise<string>;

export function estimateTokens(messages: Message[]): number {
    return messages.reduce(
        (total, message) => total + Math.ceil((message.content.length + JSON.stringify(message.toolCalls ?? []).length) / 4) + 4,
        0,
    );
}

function turnStarts(messages: Message[]): number[] {
    return messages.flatMap((message, index) => (message.role === "user" || (message.role === "assistant" && index > 0) ? [index] : []));
}

export async function compact(messages: Message[], budget: number, keepRecent: number, summarize: Summarize): Promise<Message[]> {
    if (estimateTokens(messages) <= budget) {
        return messages;
    }
    const [system, ...rest] = messages;
    if (!system) {
        return messages;
    }
    const starts = turnStarts(rest);
    const cut = starts.length > keepRecent ? (starts[starts.length - keepRecent] ?? 0) : 0;
    if (cut === 0) {
        return messages;
    }
    const summary = await summarize(rest.slice(0, cut));
    return [system, { role: "system", content: `Summary of earlier steps: ${summary}` }, ...rest.slice(cut)];
}

export const extractiveSummary: Summarize = async (messages) => {
    const calls = messages.flatMap((message) => message.toolCalls ?? []).map((call) => call.name);
    const users = messages.filter((message) => message.role === "user").map((message) => message.content);
    const parts = [
        users.length ? `user asked: ${users.join(" / ")}` : "",
        calls.length ? `tools already called: ${calls.join(", ")}` : "",
    ];
    return parts.filter(Boolean).join("; ") || "no earlier activity";
};
