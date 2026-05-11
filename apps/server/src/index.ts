import { buildApp } from "./app.js";
import { loadServerEnv } from "./env.js";

loadServerEnv();

const port = Number(process.env.PORT ?? "3001");
const host = process.env.HOST ?? "0.0.0.0";

const app = buildApp();

app
  .listen({ port, host })
  .then(() => {
    console.log(`amesh server listening on http://${host}:${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
