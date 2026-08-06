/* JalenBuilds Tools — checkout registry.

   `link` is injected at build time from environment variables. Regenerate with:

     node scripts/generate-checkout-config.mjs

   reading JB_STRIPE_LINK_* from the environment (see scripts/README-checkout.md).
   A link that is empty leaves that product's checkout inert: the buy button
   falls back to the email order flow instead of sending anyone to a broken
   payment page. A value that is not a real https:// URL is treated as unset. */
window.JB_CHECKOUT = {
  contact: "contact@nymrel.com",

  /* Optional. When set to an endpoint that returns {"paid":true} for a completed
     Stripe session, the unlock after checkout is confirmed server-side.
     Injected from JB_PRO_VERIFY_URL. Unset = the checkout return itself unlocks. */
  verifyUrl: "",

  products: {
    "scorecard-pro": {
      name:         "AI Visibility Scorecard — Pro Report",
      price:        "$9 one-time",
      recurrence:   "one_time",
      whatItIs:     "The pro report for the AI Visibility Scorecard: the exact fixes, ranked.",
      delivery:     "instant-download",
      deliveryTime: "instant",
      env:          "JB_STRIPE_LINK_SCORECARD_PRO",
      link:         "",
      returnPath:   "/tools/ai-visibility-scorecard/"
    },
    "llms-deluxe": {
      name:         "llms.txt Generator — Deluxe Kit",
      price:        "$9 one-time",
      recurrence:   "one_time",
      whatItIs:     "The deluxe kit for the llms.txt Generator: a ready-to-publish llms.txt file.",
      delivery:     "instant-download",
      deliveryTime: "instant",
      env:          "JB_STRIPE_LINK_LLMS_DELUXE",
      link:         "",
      returnPath:   "/tools/llms-txt-generator/"
    },
    "jsonld-pro": {
      name:         "JSON-LD Studio — Pro",
      price:        "$19 one-time",
      recurrence:   "one_time",
      whatItIs:     "The pro tier of JSON-LD Studio: generate and check structured-data markup.",
      delivery:     "instant-download",
      deliveryTime: "instant",
      env:          "JB_STRIPE_LINK_JSONLD_PRO",
      link:         "",
      returnPath:   "/tools/json-ld-generator/"
    },
    "qr-deluxe": {
      name:         "QR + UTM Studio — Deluxe",
      price:        "$9 one-time",
      recurrence:   "one_time",
      whatItIs:     "The deluxe tier of QR + UTM Studio: campaign tracking built into every code.",
      delivery:     "instant-download",
      deliveryTime: "instant",
      env:          "JB_STRIPE_LINK_QR_DELUXE",
      link:         "",
      returnPath:   "/tools/qr-utm-generator/"
    },
    "tokens-pro": {
      name:         "Token Ledger — Pro",
      price:        "$49 one-time",
      recurrence:   "one_time",
      whatItIs:     "The pro Token Ledger dashboard: AI spend by model and by day from your export.",
      delivery:     "instant-download",
      deliveryTime: "instant",
      env:          "JB_STRIPE_LINK_TOKENS_PRO",
      link:         "",
      returnPath:   "/tools/token-spend-dashboard/"
    },
    "recommends-pro": {
      name:         "ChatGPT Recommendation Check — Full Report",
      price:        "$9 one-time",
      recurrence:   "one_time",
      whatItIs:     "The full ChatGPT Recommendation Check report: a straight verdict with a score.",
      delivery:     "instant-download",
      deliveryTime: "instant",
      env:          "JB_STRIPE_LINK_RECOMMENDS_PRO",
      link:         "",
      returnPath:   "/tools/chatgpt-recommends/"
    }
  }
};
