import type { Sticky } from "../src/tools/board.ts";

export interface Scenario {
    name: string;
    goal: string;
    board: Sticky[];
    expectGroups: Record<string, string>;
    maxSteps: number;
    expectActionItem: boolean;
}

export const SCENARIOS: Scenario[] = [
    {
        name: "sprint retro with three clear themes",
        goal: "Cluster the sprint retro notes into themes and propose one action",
        board: [
            { id: "a", text: "Release took 3 days because of manual rollback steps", color: "pink" },
            { id: "b", text: "Flaky tests failed the build twice", color: "yellow" },
            { id: "c", text: "Standups run long, move updates to async", color: "blue" },
            { id: "d", text: "Incident on Tuesday caused by a regression", color: "yellow" },
        ],
        expectGroups: { a: "Release process", b: "Quality", c: "Team communication", d: "Quality" },
        maxSteps: 5,
        expectActionItem: true,
    },
    {
        name: "board with a single theme",
        goal: "Group these notes",
        board: [
            { id: "a", text: "Deploy pipeline is slow", color: "yellow" },
            { id: "b", text: "Rollback needs a runbook", color: "yellow" },
        ],
        expectGroups: { a: "Release process", b: "Release process" },
        maxSteps: 5,
        expectActionItem: true,
    },
    {
        name: "notes that match no theme stay ungrouped",
        goal: "Group these notes",
        board: [{ id: "a", text: "Office plants need water", color: "green" }],
        expectGroups: {},
        maxSteps: 4,
        expectActionItem: true,
    },
];
