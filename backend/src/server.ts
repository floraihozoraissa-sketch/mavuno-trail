import "dotenv/config";
import express from "express";
import cors from "cors";
import { supabase } from "./config/supabase";
import dashboardRoutes from "./routes/dashboard.routes";
import farmersRoutes from "./routes/farmers.routes";
import deliveriesRoutes from "./routes/deliveries.routes";
import batchesRoutes from "./routes/batches.routes";
import salesRoutes from "./routes/sales.routes";
import allocationsRoutes from "./routes/allocations.routes";
import paymentsRoutes from "./routes/payments.routes";
import statementsRoutes from "./routes/statements.routes";
import authRoutes from "./routes/auth.routes";
import auditBlockchainRoutes from "./routes/auditBlockchain.routes";
import referenceRoutes from "./routes/reference.routes";

const app = express();

const PORT = Number(process.env.PORT || 4000);
const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5173";

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/farmers", farmersRoutes);
app.use("/api/deliveries", deliveriesRoutes);
app.use("/api/batches", batchesRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/allocations", allocationsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/statements", statementsRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/audit-blockchain", auditBlockchainRoutes);
app.use("/api/reference", referenceRoutes);


// Basic API health check
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "MavunoTrail API is running.",
    timestamp: new Date().toISOString()
  });
});

// Supabase database connection check
app.get("/api/health/db", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("cooperatives")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Database check failed:", error.message);

      return res.status(503).json({
        success: false,
        message: "Database connection check failed."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Supabase connection successful.",
      databaseConnected: true,
      demoCooperativeFound: data.length > 0
    });
  } catch (error) {
    console.error("Unexpected database error:", error);

    return res.status(500).json({
      success: false,
      message: "Unexpected server error."
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `MavunoTrail API running at http://localhost:${PORT}`
  );
});
