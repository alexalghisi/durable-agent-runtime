import { MongoClient } from "mongodb";

import type { Run } from "./domain/types.ts";
import { extractiveSummary } from "./memory/context.ts";
import { AzureOpenAIClient } from "./model/azureOpenAI.ts";
import { retroFacilitator } from "./model/facilitator.ts";
import type { ModelClient } from "./model/ModelClient.ts";
import { ScriptedModel } from "./model/scripted.ts";
import { AgentExecutor, type ExecutorOptions } from "./runtime/executor.ts";
import { RunService } from "./runtime/runService.ts";
import { InMemoryRunStore, MongoRunStore, type RunStore } from "./runtime/runStore.ts";
import { registerBoardTools, type BoardStore } from "./tools/board.ts";
import { InMemoryBoardStore, MongoBoardStore } from "./tools/boardStores.ts";
import { ToolRegistry } from "./tools/registry.ts";
import type { Config } from "./config.ts";

export interface Container {
    runs: RunService;
    boards: BoardStore;
    close(): Promise<void>;
}

export interface ContainerOverrides {
    model?: ModelClient;
    executor?: Partial<ExecutorOptions>;
}

export function assemble(store: RunStore, boards: BoardStore, model: ModelClient, owner: string, overrides: Partial<ExecutorOptions> = {}): RunService {
    const tools = registerBoardTools(new ToolRegistry(), boards);
    const options: ExecutorOptions = {
        owner,
        maxSteps: 12,
        leaseMs: 30_000,
        contextBudget: 6_000,
        keepRecentTurns: 4,
        clock: Date.now,
        ...overrides,
    };
    const executor = new AgentExecutor(store, model, tools, extractiveSummary, options);
    return new RunService(store, executor, {
        clock: options.clock,
        onBackgroundError: (runId, error) => console.error(JSON.stringify({ level: "error", runId, error: String(error) })),
    });
}

export async function createContainer(config: Config, overrides: ContainerOverrides = {}): Promise<Container> {
    const model = overrides.model ?? (config.azure ? new AzureOpenAIClient(config.azure) : new ScriptedModel(retroFacilitator));
    if (!config.mongoUrl) {
        const boards = new InMemoryBoardStore();
        const runs = assemble(new InMemoryRunStore(), boards, model, config.workerId, overrides.executor);
        return { runs, boards, close: () => runs.drain() };
    }
    const client = await MongoClient.connect(config.mongoUrl);
    const db = client.db(config.mongoDatabase);
    const runCollection = db.collection<Run>("runs");
    await MongoRunStore.ensureIndexes(runCollection);
    const boards = new MongoBoardStore(db.collection("stickies"));
    await MongoBoardStore.ensureIndexes(db.collection("stickies"));
    const runs = assemble(new MongoRunStore(runCollection), boards, model, config.workerId, overrides.executor);
    return {
        runs,
        boards,
        close: async () => {
            await runs.drain();
            await client.close();
        },
    };
}
