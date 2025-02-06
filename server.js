const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");
const { body, validationResult } = require("express-validator");
require("dotenv").config();

const {
  createAvailabilityRequestBody,
  fetchCronofyAvailability,
  batchMembers,
} = require("./helpers/cronofyHelpers");

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet()); // Adds various HTTP headers for security
app.use(cors()); // Allow all origins

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests",
    message: "Please try again later",
  },
});
app.use(limiter);

// Middleware for parsing JSON with size limit
app.use(express.json({ limit: "10kb" }));

// Request validation middleware
const validateRequest = [
  body("members").isArray().notEmpty(),
  body("duration").isInt({ min: 1 }).notEmpty(),
  body("query_periods").isArray().notEmpty(),
  body("buffer.before.minutes").optional().isInt({ min: 0 }),
  body("buffer.after.minutes").optional().isInt({ min: 0 }),
];

// Validate API Token middleware
const validateApiToken = (req, res, next) => {
  // You can check the header, query, or body
  const token =
    req.get("x-api-token") || req.query.api_token || req.body.api_token;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "API token is missing",
    });
  }

  // Compare against your expected token from an environment variable
  if (token !== process.env.API_TOKEN) {
    return res.status(403).json({
      success: false,
      error: "Invalid API token",
    });
  }

  next();
};

// Cache and TTL definitions:
const CACHE_TTL = 0; // 15 minutes
const cache = new Map();

// Main POST request handler with validation
app.post(
  "/api/availability",
  validateApiToken,
  validateRequest,
  async (req, res) => {
    // Destructure minutes_from_now along with other properties.
    // "minutes_from_now" is used solely for the caching key.
    const { minutes_from_now, members, duration, query_periods, buffer } =
      req.body;

    // Build a cache key using minutes_from_now.
    const cacheKey = `availability:${minutes_from_now}`;

    // Check if the cache already has data for this minutes_from_now value.
    if (cache.has(cacheKey)) {
      console.log("Serving from cache for minutes_from_now:", minutes_from_now);
      return res.json({ success: true, data: cache.get(cacheKey) });
    }

    try {
      // Create member batches from the provided members list
      const memberBatches = batchMembers(members);

      // Call Cronofy for each batch. Note how we do not include minutes_from_now in the Cronofy request.
      const results = await Promise.all(
        memberBatches.map(async (batch) => {
          const requestBody = createAvailabilityRequestBody(
            batch,
            query_periods,
            duration,
            buffer
          );
          return fetchCronofyAvailability(requestBody, batch);
        })
      );

      // Cache the results using our cache key.
      cache.set(cacheKey, results);
      // Set up a timer to expire (remove) the cache entry after 15 minutes.
      setTimeout(() => {
        cache.delete(cacheKey);
        console.log("Cache expired for key:", cacheKey);
      }, CACHE_TTL);

      // Return the fetched results.
      res.json({ success: true, data: results });
    } catch (error) {
      console.error("Error processing request:", error);
      res.status(500).json({
        success: false,
        error: "Internal Server Error",
        message: error.message || "Something went wrong",
      });
    }
  }
);

// Error handler
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  res.status(500).json({
    success: false,
    error: "Internal Server Error",
    message: err.message || "Something went wrong",
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
