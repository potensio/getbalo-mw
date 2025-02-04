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
          ...member,
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
const fetchCronofyAvailability = async (requestBody) => {
  const response = await fetch("https://api-au.cronofy.com/v1/availability", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer CRN_aSorJHcYAKAZr4Cxqb11HZTSNnJhS8W67QDvvT",
    },
    body: JSON.stringify(requestBody),
  });
  return response.json();
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
