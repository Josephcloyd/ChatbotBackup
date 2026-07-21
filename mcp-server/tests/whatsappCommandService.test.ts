import assert from "node:assert/strict";
import test from "node:test";
import {
  getSimpleMathReply,
  getSocialReply,
  isProductionPlanningRequest,
  normalizeBotMessageText,
  parseProductionPlanCommand,
} from "../src/services/whatsappCommandService.js";

test("parses supported production plan commands", () => {
  const expectedDescription = "Create a 1-week plan with 8 total hours.";

  for (const input of [
    `plan: ${expectedDescription}`,
    `plan ${expectedDescription}`,
    `production plan: ${expectedDescription}`,
    `production plan ${expectedDescription}`,
    `create production plan ${expectedDescription}`,
    `create a production plan ${expectedDescription}`,
  ]) {
    assert.deepEqual(parseProductionPlanCommand(input), {
      projectDescription: expectedDescription,
    });
  }
});

test("normalizes bot mentions before parsing commands", () => {
  assert.equal(normalizeBotMessageText("@Flowboard ping"), "ping");
  assert.equal(normalizeBotMessageText("ping @Flowboard"), "ping");

  assert.deepEqual(parseProductionPlanCommand("@Flowboard plan: Create a 1-week plan with 8 total hours."), {
    projectDescription: "Create a 1-week plan with 8 total hours.",
  });
});

test("returns social replies for simple bot questions", () => {
  assert.match(getSocialReply("@Flowboard who are you?") ?? "", /Flowboard production-planning assistant/);
  assert.match(getSocialReply("help") ?? "", /Mention me with a project description/);
});

test("answers simple math prompts", () => {
  assert.equal(getSimpleMathReply("@Flowboard what is 12 x 4?"), "12 x 4 = 48");
  assert.equal(getSimpleMathReply("20 divided by 5"), "20 divided by 5 = 4");
  assert.equal(getSimpleMathReply("10 / 0"), "I cannot divide by zero.");
  assert.equal(getSimpleMathReply("what is the plan today?"), null);
});

test("detects production-planning intent without accepting general questions", () => {
  assert.equal(isProductionPlanningRequest("what's the weather today?"), false);
  assert.equal(isProductionPlanningRequest("tell me the weather forecast"), false);
  assert.equal(
    isProductionPlanningRequest("We need to collect 350000 images in 6 months starting today."),
    true,
  );
  assert.equal(
    isProductionPlanningRequest("Create a production plan about our text capture collection."),
    true,
  );
});

test("returns an empty description when the command has no request body", () => {
  assert.deepEqual(parseProductionPlanCommand("production plan"), {
    projectDescription: "",
  });
});

test("ignores unrelated messages", () => {
  assert.equal(parseProductionPlanCommand("ping"), null);
  assert.equal(parseProductionPlanCommand("planet status"), null);
});
