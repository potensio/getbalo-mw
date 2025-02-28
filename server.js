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
app.use(express.json({ limit: "1000kb" }));

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
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds

// Cache structure to store both data and metadata
const cache = new Map();

// Helper function to extract member subs from results
const extractMemberSubs = (results) => {
  const memberSubs = new Set();
  results.forEach((result) => {
    result.available_slots.forEach((slot) => {
      slot.participants.forEach((participant) => {
        memberSubs.add(participant.sub);
      });
    });
  });
  return memberSubs;
};

// Helper function to get missing members - now with O(1) lookup
const getMissingMembers = (cacheEntry, requestedMembers) => {
  return requestedMembers.filter(
    (member) => !cacheEntry.memberSubs.has(member.sub)
  );
};

// Main POST request handler with validation
app.post(
  "/api/availability",
  validateApiToken,
  validateRequest,
  async (req, res) => {
    const { minutes_from_now, members, duration, query_periods, buffer } =
      req.body;

    // Validate minutes_from_now
    if (![60, 1440, 10080].includes(minutes_from_now)) {
      return res.status(400).json({
        success: false,
        error: "Invalid minutes_from_now value. Must be 60, 1440, or 10080.",
      });
    }

    const cacheKey = `availability:${minutes_from_now}`;
    let results = [];
    let missingMembers = members;

    // First check: Does cache exist for minutes_from_now?
    if (!cache.has(cacheKey)) {
      console.log(
        `No cache found for minutes_from_now: ${minutes_from_now}. Fetching all data.`
      );
    } else {
      // Second check: Check for missing members in existing cache
      const cacheEntry = cache.get(cacheKey);
      results = [...cacheEntry.data];
      missingMembers = getMissingMembers(cacheEntry, members);

      if (missingMembers.length === 0) {
        console.log(
          `Cache hit: Complete data found for minutes_from_now: ${minutes_from_now}`
        );
        return res.json({ success: true, data: results });
      }
      console.log(
        `Partial cache hit: Fetching data for ${missingMembers.length} missing members`
      );
    }

    try {
      if (missingMembers.length > 0) {
        // Create member batches from the missing members list
        const memberBatches = batchMembers(missingMembers);

        // Fetch data only for missing members
        const newResults = await Promise.all(
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

        // Merge new results with existing cached results
        results = [...results, ...newResults];

        // Update cache with combined results and member subs
        const memberSubs = extractMemberSubs(results);
        cache.set(cacheKey, {
          data: results,
          memberSubs,
          timestamp: Date.now(),
        });

        // Set up cache expiration
        setTimeout(() => {
          if (cache.has(cacheKey)) {
            cache.delete(cacheKey);
            console.log("Cache expired for key:", cacheKey);
          }
        }, CACHE_TTL);
      }

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
