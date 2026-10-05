import { randomUUID } from "node:crypto";

import type { Run } from "../domain/types.ts";
import type { AgentExecutor } from "./executor.ts";
import type { RunStore } from "./runStore.ts";

const SYSTEM_PROMPT =
    "You are a facilitator working on a collaborative whiteboard. Use the tools to read and change the board. Keep changes small and explain what you did in one sentence when finished.";

export class RunNotFoundError extends Error {}

export interface RunServiceOptions {
    clock: () => number;
    onBackgroundError: (runId: string, error: unknown) => void;
}

export class RunService {
    private readonly store: RunStore;
    private readonly executor: AgentExecutor;
    private readonly options: RunServiceOptions;
    private readonly inFlight = new Set<Promise<unknown>>();

    constructor(store: RunStore, executor: AgentExecutor, options: RunServiceOptions) {
        this.store = store;
        this.executor = executor;
        this.options = options;
    }

    async start(boardId: string, goal: string): Promise<Run> {
        const now = new Date(this.options.clock()).toISOString();
        const run: Run = {
            runId: `run_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
            boardId,
            goal,
            status: "queued",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: goal },
            ],
            steps: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            spans: [],
            createdAt: now,
            updatedAt: now,
        };
        await this.store.create(run);
        this.dispatch(run.runId);
        return run;
    }

    async get(runId: string): Promise<Run> {
        const run = await this.store.get(runId);
        if (!run) {
            throw new RunNotFoundError(`Run ${runId} not found`);
        }
        return run;
    }

    async resume(runId: string): Promise<Run> {
        const run = await this.get(runId);
        this.dispatch(runId);
        return run;
    }

    async drain(): Promise<void> {
        await Promise.allSettled([...this.inFlight]);
    }

    private dispatch(runId: string): void {
        const task = this.executor
            .execute(runId)
            .catch((error: unknown) => this.options.onBackgroundError(runId, error))
            .finally(() => this.inFlight.delete(task));
        this.inFlight.add(task);
    }
}
