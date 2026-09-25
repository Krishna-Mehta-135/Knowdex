import "./env.js";
import { app } from "./app.js";
import connectDB from "./db/index.js";

// PORT is injected by Heroku; HTTP_PORT is used by docker-compose and local dev.
const port = parseInt(process.env.PORT ?? process.env.HTTP_PORT ?? "8000", 10);

connectDB()
  .then(() => {
    app.listen(port, () => {
      console.log(`🚀 Server is running at http://localhost:${port}`);
      console.log(`🔌 API Base URL: http://localhost:${port}/api/v1`);
    });
  })
  .catch((err) => {
    console.log("Database connection failed", err);
  });
