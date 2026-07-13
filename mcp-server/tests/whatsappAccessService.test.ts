import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedWhatsAppGroup,
  maskWhatsAppGroupId,
  type ChatIdentity,
  type GroupAccessConfig,
} from "../src/services/whatsappAccessService.js";

const allowedGroup: ChatIdentity = {
  isGroup: true,
  id: "123456789@g.us",
  name: "test bot",
};

function config(overrides: Partial<GroupAccessConfig> = {}): GroupAccessConfig {
  return {
    allowedGroupId: "",
    allowedGroupName: "test bot",
    ...overrides,
  };
}

test("authorizes the configured WhatsApp group ID", () => {
  assert.equal(
    isAllowedWhatsAppGroup(allowedGroup, config({ allowedGroupId: "123456789@g.us" })),
    true,
  );
});

test("rejects the wrong WhatsApp group ID", () => {
  assert.equal(
    isAllowedWhatsAppGroup(allowedGroup, config({ allowedGroupId: "987654321@g.us" })),
    false,
  );
});

test("rejects private chats", () => {
  assert.equal(
    isAllowedWhatsAppGroup(
      { isGroup: false, id: "15551234567@c.us", name: "" },
      config({ allowedGroupId: "15551234567@c.us" }),
    ),
    false,
  );
});

test("falls back to group name when no group ID is configured", () => {
  assert.equal(isAllowedWhatsAppGroup(allowedGroup, config()), true);
});

test("rejects the wrong fallback group name when no group ID is configured", () => {
  assert.equal(
    isAllowedWhatsAppGroup(allowedGroup, config({ allowedGroupName: "other group" })),
    false,
  );
});

test("fallback group name matching is trimmed and case-insensitive", () => {
  assert.equal(
    isAllowedWhatsAppGroup(
      { ...allowedGroup, name: "  Test Bot  " },
      config({ allowedGroupName: " TEST BOT " }),
    ),
    true,
  );
});

test("configured group ID takes priority over a matching fallback name", () => {
  assert.equal(
    isAllowedWhatsAppGroup(allowedGroup, config({ allowedGroupId: "987654321@g.us" })),
    false,
  );
});

test("empty or whitespace-only group configuration rejects group chats", () => {
  assert.equal(
    isAllowedWhatsAppGroup(
      allowedGroup,
      config({ allowedGroupId: "   ", allowedGroupName: "   " }),
    ),
    false,
  );
});

test("masks WhatsApp group IDs without dropping the group suffix", () => {
  assert.equal(maskWhatsAppGroupId("123456789@g.us"), "123...789@g.us");
});
