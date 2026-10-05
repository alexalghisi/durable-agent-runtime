import { z } from "zod";

import type { ToolDefinition, ToolRegistry } from "./registry.ts";

export const STICKY_COLORS = ["yellow", "pink", "blue", "green"] as const;

export interface Sticky {
    id: string;
    text: string;
    color: (typeof STICKY_COLORS)[number];
    group?: string;
}

export interface BoardStore {
    list(boardId: string): Promise<Sticky[]>;
    upsert(boardId: string, sticky: Sticky): Promise<void>;
    assignGroup(boardId: string, stickyIds: string[], group: string): Promise<number>;
}

const listStickies = z.object({});

const createSticky = z.object({
    text: z.string().min(1).max(280).describe("Text on the sticky note"),
    color: z.enum(STICKY_COLORS).optional().describe("Sticky colour, yellow by default"),
});

const groupStickies = z.object({
    group: z.string().min(1).max(60).describe("Name of the cluster, e.g. 'Release process'"),
    sticky_ids: z.array(z.string()).min(1).describe("Ids of the stickies that belong to the cluster"),
});

export function registerBoardTools(registry: ToolRegistry, store: BoardStore): ToolRegistry {
    const list: ToolDefinition<typeof listStickies> = {
        name: "list_stickies",
        description: "Lists every sticky note on the board with its id, text, colour and group.",
        schema: listStickies,
        execute: (_args, { boardId }) => store.list(boardId),
    };
    const create: ToolDefinition<typeof createSticky> = {
        name: "create_sticky",
        description: "Adds a sticky note to the board.",
        schema: createSticky,
        async execute({ text, color }, { boardId, toolCallId }) {
            const sticky: Sticky = { id: `stk_${toolCallId}`, text, color: color ?? "yellow" };
            await store.upsert(boardId, sticky);
            return sticky;
        },
    };
    const group: ToolDefinition<typeof groupStickies> = {
        name: "group_stickies",
        description: "Places existing stickies into a named cluster.",
        schema: groupStickies,
        async execute({ group: name, sticky_ids }, { boardId }) {
            const updated = await store.assignGroup(boardId, sticky_ids, name);
            return { group: name, updated };
        },
    };
    return registry.register(list).register(create).register(group);
}
