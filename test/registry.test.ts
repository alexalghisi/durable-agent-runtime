import { describe, expect, it } from "vitest";

import { registerBoardTools } from "../src/tools/board.ts";
import { InMemoryBoardStore } from "../src/tools/boardStores.ts";
import { ToolInputError, ToolRegistry } from "../src/tools/registry.ts";

const registry = registerBoardTools(new ToolRegistry(), new InMemoryBoardStore());
const context = { boardId: "b1", toolCallId: "call_1" };

describe("ToolRegistry", () => {
    it("publishes JSON schemas the model can call", () => {
        const create = registry.specs().find((spec) => spec.name === "create_sticky");
        expect(create?.parameters).toEqual({
            type: "object",
            properties: {
                text: { type: "string", description: "Text on the sticky note" },
                color: { type: "string", enum: ["yellow", "pink", "blue", "green"], description: "Sticky colour, yellow by default" },
            },
            required: ["text"],
            additionalProperties: false,
        });
    });

    it("validates arguments before running a tool", async () => {
        await expect(registry.execute("create_sticky", { text: "" }, context)).rejects.toThrow(ToolInputError);
        await expect(registry.execute("create_sticky", { text: "ok", color: "purple" }, context)).rejects.toThrow(/color/);
    });

    it("rejects unknown tools", async () => {
        await expect(registry.execute("delete_board", {}, context)).rejects.toThrow('Unknown tool "delete_board"');
    });

    it("derives sticky ids from the tool call so retries do not duplicate notes", async () => {
        const boards = new InMemoryBoardStore();
        const tools = registerBoardTools(new ToolRegistry(), boards);
        await tools.execute("create_sticky", { text: "Action item" }, context);
        await tools.execute("create_sticky", { text: "Action item" }, context);
        expect(await boards.list("b1")).toEqual([{ id: "stk_call_1", text: "Action item", color: "yellow" }]);
    });
});
