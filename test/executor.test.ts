import { describe, expect, it } from "vitest";

import type { Run } from "../src/domain/types.ts";
import { retroFacilitator } from "../src/model/facilitator.ts";
import { ScriptedModel } from "../src/model/scripted.ts";
import { LeaseUnavailableError } from "../src/runtime/executor.ts";
import { InMemoryRunStore } from "../src/runtime/runStore.ts";
import { InMemoryBoardStore } from "../src/tools/boardStores.ts";
import { ManualClock, executorFor, seed, serviceFor, toolMessages } from "./helpers.ts";

class CrashingStore extends InMemoryRunStore {
    savesUntilCrash: number;
    private readonly deadOwners = new Set<string>();

    constructor(savesUntilCrash: number) {
        super();
        this.savesUntilCrash = savesUntilCrash;
    }

    override async save(run: Run): Promise<void> {
        this.savesUntilCrash -= 1;
        if (this.savesUntilCrash < 0) {
            this.deadOwners.add(run.lease?.owner ?? "");
            throw new Error("process killed");
        }
        await super.save(run);
    }

    override async release(runId: string, owner: string): Promise<void> {
        if (!this.deadOwners.has(owner)) {
            await super.release(runId, owner);
        }
    }
}

async function startRun(store: InMemoryRunStore, boards: InMemoryBoardStore, clock: ManualClock): Promise<string> {
    const service = serviceFor(store, executorFor(store, boards, new ScriptedModel(() => ({ content: "", toolCalls: [] })), clock), clock);
    const run = await service.start("retro", "Cluster the retro notes");
    await service.drain();
    return run.runId;
}

describe("AgentExecutor", () => {
    it("runs the agent loop until the model answers without tool calls", async () => {
        const clock = new ManualClock();
        const store = new InMemoryRunStore();
        const boards = new InMemoryBoardStore();
        await seed(boards, "retro");
        const service = serviceFor(store, executorFor(store, boards, new ScriptedModel(retroFacilitator), clock), clock);

        const { runId } = await service.start("retro", "Cluster the retro notes");
        await service.drain();
        const run = await service.get(runId);

        expect(run.status).toBe("completed");
        expect(run.output).toBe("Grouped the retro notes into themes and added an action item.");
        expect(run.steps).toBe(4);
        expect(run.spans.map((span) => span.name)).toContain("tool.group_stickies");
        expect(run.lease).toBeUndefined();
        const groups = (await boards.list("retro")).map((sticky) => sticky.group);
        expect(groups).toEqual(["Release process", "Quality", "Team communication", undefined]);
    });

    it("returns invalid tool arguments to the model instead of failing the run", async () => {
        const clock = new ManualClock();
        const store = new InMemoryRunStore();
        const boards = new InMemoryBoardStore();
        const model = new ScriptedModel((messages) =>
            toolMessages(messages).length === 0
                ? { content: "", toolCalls: [{ id: "bad", name: "create_sticky", arguments: { text: "" } }] }
                : { content: "Could not add the note.", toolCalls: [] },
        );
        const service = serviceFor(store, executorFor(store, boards, model, clock), clock);

        const { runId } = await service.start("retro", "Add a note");
        await service.drain();
        const run = await service.get(runId);

        expect(run.status).toBe("completed");
        expect(toolMessages(run.messages)[0]?.content).toMatch(/^Invalid arguments: text:/);
    });

    it("stops runaway loops at the step limit", async () => {
        const clock = new ManualClock();
        const store = new InMemoryRunStore();
        const boards = new InMemoryBoardStore();
        const looping = new ScriptedModel((messages) => ({
            content: "",
            toolCalls: [{ id: `call_${messages.length}`, name: "list_stickies", arguments: {} }],
        }));
        const service = serviceFor(store, executorFor(store, boards, looping, clock, { maxSteps: 3 }), clock);

        const { runId } = await service.start("retro", "Loop forever");
        await service.drain();
        const run = await service.get(runId);

        expect(run.status).toBe("failed");
        expect(run.error).toBe("Stopped after 3 model steps");
        expect(run.steps).toBe(3);
    });

    it("marks the run failed when the model call throws", async () => {
        const clock = new ManualClock();
        const store = new InMemoryRunStore();
        const boards = new InMemoryBoardStore();
        const broken = { complete: () => Promise.reject(new Error("model unavailable")) };
        const service = serviceFor(store, executorFor(store, boards, broken, clock), clock);

        const { runId } = await service.start("retro", "Anything");
        await service.drain();

        expect(await service.get(runId)).toMatchObject({ status: "failed", error: "model unavailable" });
    });

    it("resumes a crashed run from its last checkpoint without repeating side effects", async () => {
        const clock = new ManualClock();
        const store = new CrashingStore(7);
        const boards = new InMemoryBoardStore();
        await seed(boards, "retro");
        const crashing = executorFor(store, boards, new ScriptedModel(retroFacilitator), clock);
        const { runId } = await serviceFor(store, crashing, clock).start("retro", "Cluster the retro notes");
        await new Promise((resolve) => setTimeout(resolve, 0));

        const crashed = await store.get(runId);
        expect(crashed?.status).toBe("running");
        expect(crashed?.lease?.owner).toBe("worker-a");
        expect((await boards.list("retro")).some((sticky) => sticky.text.startsWith("Action:"))).toBe(true);
        expect(crashed?.messages.at(-1)?.toolCalls?.[0]?.name).toBe("create_sticky");

        store.savesUntilCrash = Number.POSITIVE_INFINITY;
        const takeover = executorFor(store, boards, new ScriptedModel(retroFacilitator), clock, { owner: "worker-b" });
        await expect(takeover.execute(runId)).rejects.toThrow(LeaseUnavailableError);

        clock.advance(30_001);
        const finished = await takeover.execute(runId);

        expect(finished.status).toBe("completed");
        const stickies = await boards.list("retro");
        expect(stickies.filter((sticky) => sticky.text.startsWith("Action:"))).toHaveLength(1);
        expect(stickies.every((sticky) => sticky.text.startsWith("Action:") || sticky.group)).toBe(true);
    });

    it("refuses to execute runs that already finished", async () => {
        const clock = new ManualClock();
        const store = new InMemoryRunStore();
        const boards = new InMemoryBoardStore();
        const runId = await startRun(store, boards, clock);
        const executor = executorFor(store, boards, new ScriptedModel(retroFacilitator), clock);
        await expect(executor.execute(runId)).rejects.toThrow(LeaseUnavailableError);
    });
});
