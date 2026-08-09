import assert from "node:assert/strict";
import test from "node:test";

import {
  hasPublicCatalogAction,
  normalizePublicExternalTicketUrl,
  resolvePublicCatalogAvailability,
} from "./publicCatalog";

test("public catalog keeps external URLs safe and resolves action labels", () => {
  assert.equal(normalizePublicExternalTicketUrl("javascript:alert(1)"), "");
  assert.equal(normalizePublicExternalTicketUrl("https://tickets.example/show"), "https://tickets.example/show");
  assert.equal(hasPublicCatalogAction({ registrationEnabled: false, externalTicketUrl: "", directTicketingEnabled: false }), false);
  assert.equal(hasPublicCatalogAction({ registrationEnabled: true, externalTicketUrl: "", directTicketingEnabled: false }), true);
  assert.deepEqual(
    resolvePublicCatalogAvailability({
      registrationEnabled: true,
      registrationAvailability: "open",
      externalTicketUrl: "",
      directTicketingEnabled: false,
      availableSeatCount: 0,
    }),
    { state: "open", label: "Registration open" },
  );
  assert.deepEqual(
    resolvePublicCatalogAvailability({
      registrationEnabled: false,
      registrationAvailability: "closed",
      externalTicketUrl: "",
      directTicketingEnabled: true,
      availableSeatCount: 0,
    }),
    { state: "tickets_unavailable", label: "Tickets unavailable" },
  );
});
