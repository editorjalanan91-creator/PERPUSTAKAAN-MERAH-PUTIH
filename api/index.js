// src/server/app.ts
import express from "express";
function createApp() {
  const app2 = express();
  app2.use(express.json());
  app2.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      service: "PERPUSTAKAAN MERAH PUTIH",
      database: "Supabase PostgreSQL",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  return app2;
}

// api/index.ts
var app = createApp();
var index_default = app;
export {
  index_default as default
};
