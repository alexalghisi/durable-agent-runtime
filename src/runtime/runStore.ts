import type { Collection } from "mongodb";

import type { Run } from "../domain/types.ts";

export interface RunStore {
    create(run: Run): Promise<void>;
    get(runId: string): Promise<Run | null>;
    save(run: Run): Promise<void>;
    claim(runId: string, owner: string, now: number, leaseMs: number): Promise<Run | null>;
    release(runId: string, owner: string): Promise<void>;
}

export class MongoRunStore implements RunStore {
    private readonly runs: Collection<Run>;

    constructor(runs: Collection<Run>) {
        this.runs = runs;
    }

    static async ensureIndexes(runs: Collection<Run>): Promise<void> {
        await runs.createIndex({ runId: 1 }, { unique: true });
    }

    async create(run: Run): Promise<void> {
        await this.runs.insertOne({ ...run });
    }

    async get(runId: string): Promise<Run | null> {
        return this.runs.findOne({ runId }, { projection: { _id: 0 } });
    }

    async save(run: Run): Promise<void> {
        const { runId, ...rest } = run;
        await this.runs.updateOne({ runId, "lease.owner": run.lease?.owner }, { $set: rest });
    }

    async claim(runId: string, owner: string, now: number, leaseMs: number): Promise<Run | null> {
        return this.runs.findOneAndUpdate(
            {
                runId,
                status: { $in: ["queued", "running"] },
                $or: [{ lease: { $exists: false } }, { "lease.expiresAt": { $lt: now } }, { "lease.owner": owner }],
            },
            { $set: { lease: { owner, expiresAt: now + leaseMs }, status: "running" } },
            { returnDocument: "after", projection: { _id: 0 } },
        );
    }

    async release(runId: string, owner: string): Promise<void> {
        await this.runs.updateOne({ runId, "lease.owner": owner }, { $unset: { lease: "" } });
    }
}

export class InMemoryRunStore implements RunStore {
    private readonly runs = new Map<string, Run>();

    async create(run: Run): Promise<void> {
        this.runs.set(run.runId, structuredClone(run));
    }

    async get(runId: string): Promise<Run | null> {
        const run = this.runs.get(runId);
        return run ? structuredClone(run) : null;
    }

    async save(run: Run): Promise<void> {
        const current = this.runs.get(run.runId);
        if (current?.lease?.owner === run.lease?.owner) {
            this.runs.set(run.runId, structuredClone(run));
        }
    }

    async claim(runId: string, owner: string, now: number, leaseMs: number): Promise<Run | null> {
        const run = this.runs.get(runId);
        if (!run || (run.status !== "queued" && run.status !== "running")) {
            return null;
        }
        if (run.lease && run.lease.expiresAt >= now && run.lease.owner !== owner) {
            return null;
        }
        run.lease = { owner, expiresAt: now + leaseMs };
        run.status = "running";
        return structuredClone(run);
    }

    async release(runId: string, owner: string): Promise<void> {
        const run = this.runs.get(runId);
        if (run?.lease?.owner === owner) {
            delete run.lease;
        }
    }
}
