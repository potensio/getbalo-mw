// Helper function to create availability request body
const createAvailabilityRequestBody = (
  memberBatch,
  query_periods,
  duration,
  buffer
) => {
  return {
    participants: [
      {
        members: memberBatch.map((member) => ({
          sub: member.sub,
          calendar_ids: member.calendar_ids,
          managed_availability: true,
        })),
        required: "all",
      },
    ],
    query_periods: query_periods,
    required_duration: {
      minutes: duration,
    },
    buffer: {
      before: { minutes: buffer.before },
      after: { minutes: buffer.after },
    },
    max_results: 512,
    response_format: "slots",
  };
};

// Helper function to fetch availability from Cronofy
const fetchCronofyAvailability = async (requestBody, originalMembers = []) => {
  if (!process.env.CRONOFY_AUTH_TOKEN) {
    throw new Error("CRONOFY_AUTH_TOKEN is not configured");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25 second timeout

    const response = await fetch("https://api-au.cronofy.com/v1/availability", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRONOFY_AUTH_TOKEN}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Cronofy API error:", {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });
      throw new Error(
        `Cronofy API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // If the response is successful and we have original members with UIDs
    if (data.available_slots) {
      // Create a map of sub to uid for quick lookup
      const subToUidMap = {};
      originalMembers.forEach((member) => {
        if (member && member.sub && member.uid) {
          subToUidMap[member.sub] = member.uid;
        }
      });

      // Only enrich with UIDs if we have mapping data
      if (Object.keys(subToUidMap).length > 0) {
        data.available_slots = data.available_slots.map((slot) => ({
          ...slot,
          participants: slot.participants.map((participant) => ({
            ...participant,
            uid: subToUidMap[participant.sub] || null,
          })),
        }));
      }
    }

    return data;
  } catch (error) {
    console.error("Error fetching availability from Cronofy:", error);
    throw error;
  }
};

// Helper function to batch members into groups of 5
const batchMembers = (members, batchSize = 5) => {
  const batches = [];
  for (let i = 0; i < members.length; i += batchSize) {
    batches.push(members.slice(i, i + batchSize));
  }
  return batches;
};

module.exports = {
  createAvailabilityRequestBody,
  fetchCronofyAvailability,
  batchMembers,
};
