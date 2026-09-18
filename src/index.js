import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { router } from "./routes.js";
import { startScheduler } from "./scheduler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "dashboard.html"));
});
app.use("/api", router);

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  logError(`express ${req.method} ${req.originalUrl}`, err);
  res.status(status).json({ error: err.message || "Unexpected error" });
});

app.listen(config.port, () => {
  console.log(`Loky outreach engine on http://localhost:${config.port}`);
  startScheduler();
});
