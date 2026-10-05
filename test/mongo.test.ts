import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Run } from "../src/domain/types.ts";
import { retroFacilitator } from "../src/model/facilitator.ts";
import { ScriptedModel } from "../src/model/scripted.ts";
import { MongoRunStore } from "../src/runtime/runStore.ts";
import { MongoBoardStore } from "../src/tools/boardStores.ts";
import { ManualClock, executorFor, seed, serviceFor } from "./helpers.ts";

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = await MongoClient.connect(server.getUri());
});

afterAll(async () => {
    await client.close();
    await server.stop();
});

beforeEach(async () => {
    db = client.db(`test_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    await MongoRunStore.ensureIndexes(db.collection<Run>("runs"));
    await MongoBoardStore.ensureIndexes(db.collection("stickies"));
});

function stores() {
    return { runs: new MongoRunStore(db.collection<Run>("runs")), boards: new MongoBoardStore(db.collection("stickies")) };
}

describe("MongoDB persistence", () => {
    it("completes a run and persists the board changes", async () => {
        const clock = new ManualClock();
        const { runs, boards } = stores();
        await seed(boards, "retro");
        const service = serviceFor(runs, executorFor(runs, boards, new ScriptedModel(retroFacilitator), clock), clock);

        const { runId } = await service.start("retro", "Cluster the retro notes");
        await service.drain();

        const run = await service.get(runId);
        expect(run.status).toBe("completed");
        expect(run.lease).toBeUndefined();
        expect((await boards.list("retro")).filter((sticky) => sticky.group)).toHaveLength(3);
    });

    it("grants a lease to one worker at a time and hands it over after expiry", async () => {
        const { runs } = stores();
        const now = Date.UTC(2026, 9, 5);
        await runs.create({
            runId: "run_1",
            boardId: "b",
            goal: "g",
            status: "queued",
            messages: [],
            steps: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            spans: [],
            createdAt: "",
            updatedAt: "",
        });

        const [first, second] = await Promise.all([runs.claim("run_1", "a", now, 1_000), runs.claim("run_1", "b", now, 1_000)]);
        expect([first, second].filter(Boolean)).toHaveLength(1);
        const winner = first ? "a" : "b";
        const loser = first ? "b" : "a";

        expect(await runs.claim("run_1", loser, now + 999, 1_000)).toBeNull();
        expect((await runs.claim("run_1", winner, now + 500, 1_000))?.lease?.expiresAt).toBe(now + 1_500);
        expect((await runs.claim("run_1", loser, now + 1_501, 1_000))?.lease?.owner).toBe(loser);
    });

    it("ignores checkpoints from a worker that lost its lease", async () => {
        const { runs } = stores();
        const now = Date.UTC(2026, 9, 5);
        await runs.create({
            runId: "run_2",
            boardId: "b",
            goal: "g",
            status: "queued",
            messages: [],
            steps: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            spans: [],
            createdAt: "",
            updatedAt: "",
        });
        const stale = await runs.claim("run_2", "a", now, 1_000);
        await runs.claim("run_2", "b", now + 2_000, 1_000);

        await runs.save({ ...stale!, steps: 99 });

        expect((await runs.get("run_2"))?.steps).toBe(0);
    });
});
