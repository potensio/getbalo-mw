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
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : "*",
    methods: ["POST"],
  })
);

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
  body("buffer").optional().isInt({ min: 0 }),
];

// Main POST request handler with validation
app.post("*", validateRequest, async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }

  try {
    const { members, duration, query_periods, buffer } = req.body;
    const memberBatches = batchMembers(members);

    const results = await Promise.all(
      memberBatches.map(async (batch) => {
        const requestBody = createAvailabilityRequestBody(
          batch,
          query_periods,
          duration,
          buffer
        );
        return fetchCronofyAvailability(requestBody);
      })
    );

    res.json({ success: true, data: results });
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({
      success: false,
      error: "Internal Server Error",
      message:
        process.env.NODE_ENV === "development"
          ? error.message
          : "Something went wrong",
    });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);
  res.status(500).json({
    success: false,
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
