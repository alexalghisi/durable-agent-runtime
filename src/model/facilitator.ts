import type { Message } from "../domain/types.ts";
import type { Sticky } from "../tools/board.ts";
import type { Script } from "./scripted.ts";

const THEMES: Record<string, RegExp> = {
    "Release process": /\b(release|deploy|rollback|pipeline|ci)\b/i,
    "Team communication": /\b(meeting|standup|slack|async|handover|communicat\w*)\b/i,
    "Quality": /\b(bug|test|flaky|incident|regression|quality)\b/i,
};

function listedStickies(messages: Message[]): Sticky[] {
    const listCall = messages.flatMap((message) => message.toolCalls ?? []).findLast((call) => call.name === "list_stickies");
    const result = messages.find((message) => message.role === "tool" && message.toolCallId === listCall?.id);
    return result ? (JSON.parse(result.content) as Sticky[]) : [];
}

function callCount(messages: Message[], name: string): number {
    return messages.flatMap((message) => message.toolCalls ?? []).filter((call) => call.name === name).length;
}

export const retroFacilitator: Script = (messages) => {
    const step = `s${messages.length}`;
    const listed = callCount(messages, "list_stickies");
    if (listed === 0) {
        return { content: "", toolCalls: [{ id: `${step}_list`, name: "list_stickies", arguments: {} }] };
    }
    if (callCount(messages, "group_stickies") === 0) {
        const stickies = listedStickies(messages);
        const toolCalls = Object.entries(THEMES)
            .map(([group, pattern]) => ({ group, ids: stickies.filter((sticky) => pattern.test(sticky.text)).map((sticky) => sticky.id) }))
            .filter(({ ids }) => ids.length > 0)
            .map(({ group, ids }, index) => ({
                id: `${step}_group_${index}`,
                name: "group_stickies",
                arguments: { group, sticky_ids: ids },
            }));
        if (toolCalls.length > 0) {
            return { content: "", toolCalls };
        }
    }
    if (callCount(messages, "create_sticky") === 0) {
        return {
            content: "",
            toolCalls: [
                {
                    id: `${step}_action`,
                    name: "create_sticky",
                    arguments: { text: "Action: pick one owner per cluster before Friday", color: "green" },
                },
            ],
        };
    }
    return { content: "Grouped the retro notes into themes and added an action item.", toolCalls: [] };
};
