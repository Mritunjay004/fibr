import express from "express";
import apiRoutes from "./routes/api";
import dashboardRoutes from "./routes/dashboard";
import { startWorker, stopWorker } from "./worker";
import { closeDb } from "./db";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", apiRoutes);
app.use("/dashboard", dashboardRoutes);

app.get("/", (_req, res) => res.redirect("/dashboard"));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const server = app.listen(PORT, () => {
  console.log(`Fibr webhook service running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`API: http://localhost:${PORT}/api`);
  startWorker();
});

function shutdown() {
  console.log("\nShutting down...");
  stopWorker();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
