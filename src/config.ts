export interface Config {
    port: number;
    mongoUrl: string | undefined;
    mongoDatabase: string;
    workerId: string;
    azure: { endpoint: string; deployment: string; apiKey: string } | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const { AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_KEY } = env;
    return {
        port: Number(env.PORT ?? 3000),
        mongoUrl: env.MONGO_URL || undefined,
        mongoDatabase: env.MONGO_DATABASE ?? "agent_runtime",
        workerId: env.WORKER_ID ?? `worker-${process.pid}`,
        azure:
            AZURE_OPENAI_ENDPOINT && AZURE_OPENAI_DEPLOYMENT && AZURE_OPENAI_API_KEY
                ? { endpoint: AZURE_OPENAI_ENDPOINT, deployment: AZURE_OPENAI_DEPLOYMENT, apiKey: AZURE_OPENAI_API_KEY }
                : undefined,
    };
}
