import type { Message } from "../src/domain/types.ts";
import { extractiveSummary } from "../src/memory/context.ts";
import type { ModelClient } from "../src/model/ModelClient.ts";
import { AgentExecutor, type ExecutorOptions } from "../src/runtime/executor.ts";
import { RunService } from "../src/runtime/runService.ts";
import type { RunStore } from "../src/runtime/runStore.ts";
import { registerBoardTools, type BoardStore, type Sticky } from "../src/tools/board.ts";
import { ToolRegistry } from "../src/tools/registry.ts";

export const RETRO: Sticky[] = [
    { id: "s1", text: "Release took 3 days because of manual rollback steps", color: "pink" },
    { id: "s2", text: "Flaky tests failed twice this sprint", color: "yellow" },
    { id: "s3", text: "Standups run long, move status updates to async", color: "blue" },
];

export class ManualClock {
    now = Date.UTC(2026, 9, 5, 9, 0, 0);

    readonly read = (): number => this.now;

    advance(ms: number): void {
        this.now += ms;
    }
}

export async function seed(boards: BoardStore, boardId: string, stickies: Sticky[] = RETRO): Promise<void> {
    for (const sticky of stickies) {
        await boards.upsert(boardId, sticky);
    }
}

export function executorFor(
    store: RunStore,
    boards: BoardStore,
    model: ModelClient,
    clock: ManualClock,
    overrides: Partial<ExecutorOptions> = {},
): AgentExecutor {
    return new AgentExecutor(store, model, registerBoardTools(new ToolRegistry(), boards), extractiveSummary, {
        owner: "worker-a",
        maxSteps: 10,
        leaseMs: 30_000,
        contextBudget: 10_000,
        keepRecentTurns: 4,
        clock: clock.read,
        ...overrides,
    });
}

export function serviceFor(store: RunStore, executor: AgentExecutor, clock: ManualClock): RunService {
    return new RunService(store, executor, {
        clock: clock.read,
        onBackgroundError: () => undefined,
    });
}

export function toolMessages(messages: Message[]): Message[] {
    return messages.filter((message) => message.role === "tool");
}
