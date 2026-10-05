import { loadConfig } from "./config.ts";
import { createContainer } from "./container.ts";
import { buildApp } from "./http/app.ts";

const config = loadConfig();
const container = await createContainer(config);
const app = buildApp(container.runs, container.boards, true);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        void app.close().then(() => container.close());
    });
}

await app.listen({ port: config.port, host: "0.0.0.0" });
