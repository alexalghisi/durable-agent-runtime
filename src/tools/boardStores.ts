import type { Collection } from "mongodb";

import type { BoardStore, Sticky } from "./board.ts";

interface StickyDocument extends Sticky {
    boardId: string;
}

export class MongoBoardStore implements BoardStore {
    private readonly stickies: Collection<StickyDocument>;

    constructor(stickies: Collection<StickyDocument>) {
        this.stickies = stickies;
    }

    static async ensureIndexes(stickies: Collection<StickyDocument>): Promise<void> {
        await stickies.createIndex({ boardId: 1, id: 1 }, { unique: true });
    }

    async list(boardId: string): Promise<Sticky[]> {
        const documents = await this.stickies.find({ boardId }, { projection: { _id: 0, boardId: 0 } }).sort({ id: 1 }).toArray();
        return documents as Sticky[];
    }

    async upsert(boardId: string, sticky: Sticky): Promise<void> {
        await this.stickies.updateOne({ boardId, id: sticky.id }, { $set: { ...sticky, boardId } }, { upsert: true });
    }

    async assignGroup(boardId: string, stickyIds: string[], group: string): Promise<number> {
        const result = await this.stickies.updateMany({ boardId, id: { $in: stickyIds } }, { $set: { group } });
        return result.matchedCount;
    }
}

export class InMemoryBoardStore implements BoardStore {
    private readonly boards = new Map<string, Map<string, Sticky>>();

    private board(boardId: string): Map<string, Sticky> {
        let board = this.boards.get(boardId);
        if (!board) {
            board = new Map();
            this.boards.set(boardId, board);
        }
        return board;
    }

    async list(boardId: string): Promise<Sticky[]> {
        return [...this.board(boardId).values()].sort((a, b) => a.id.localeCompare(b.id)).map((sticky) => ({ ...sticky }));
    }

    async upsert(boardId: string, sticky: Sticky): Promise<void> {
        this.board(boardId).set(sticky.id, { ...sticky });
    }

    async assignGroup(boardId: string, stickyIds: string[], group: string): Promise<number> {
        const board = this.board(boardId);
        let updated = 0;
        for (const id of stickyIds) {
            const sticky = board.get(id);
            if (sticky) {
                sticky.group = group;
                updated += 1;
            }
        }
        return updated;
    }
}
