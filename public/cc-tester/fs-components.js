import { sdk } from "./fs-sdk.js";

const FONT_STACK =
  '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';

// Single fixed light theme - this page is for testing whether each
// component works at all, not re-theming, so no light/dark toggle here.
const c = {
  inputBg: "#ffffff",
  border: "#e2e5ec",
  borderHover: "#c7ccd6",
  text: "#14161d",
  placeholder: "#8a8f9c",
  accent: "#4f7df0",
  accentHover: "#3f6bdb",
  accentActive: "#3559b8",
  danger: "#dc2626",
  errorText: "#991b1b",
  disabledBg: "#f1f2f6",
  disabledText: "#9296a8",
  disclosureText: "#6b7080",
};

// email is mounted with NO plain HTML email field anywhere on this page -
// the session is created without one (server.js's /api/session no longer
// requires it) specifically so fs-email is unlocked and can actually
// collect it, instead of echoing back a value we already set (see the gym/
// game-store versions, where it's always locked read-only).
const emailComponent = sdk.components.create("fs-email", {
  fields: { email: "auto" },
  labelMode: "fixed",
  hideEmailHeader: false,
  style: {
    state: {
      default: {
        email: {
          backgroundColor: "transparent",
          borderRadius: "0",
          padding: "0",
        },
        emailTitle: {
          color: c.text,
          fontSize: "16px",
        },
        label: {
          color: c.placeholder,
        },
        input: {
          backgroundColor: c.inputBg,
          borderColor: c.border,
          borderRadius: "8px",
          height: "48px",
          color: c.text,
          fontFamily: FONT_STACK,
          fontSize: "16px",
        },
      },
      hover: {
        input: {
          borderColor: c.borderHover,
        },
      },
      focus: {
        input: {
          borderColor: c.accent,
        },
      },
    },
  },
});
emailComponent.mount("#email-element");

const cardComponent = sdk.components.create("fs-card", {
  labelMode: "fixed",
  // Matches game-store/gym exactly - was false here, which is why the card
  // rendered with a visible header/checkbox row that looks different from
  // the other two integrations.
  hideCardHeader: true,
  style: {
    state: {
      default: {
        card: {
          backgroundColor: "transparent",
          border: "none",
          boxShadow: "none",
          padding: "0",
          color: c.text,
        },
        input: {
          backgroundColor: c.inputBg,
          borderColor: c.border,
          borderRadius: "8px",
          height: "48px",
          padding: "0 10px",
          color: c.text,
          fontSize: "16px",
          fontFamily: FONT_STACK,
          placeholderColor: c.placeholder,
        },
        inlineError: {
          color: c.danger,
          fontSize: "12px",
        },
      },
      hover: {
        card: { backgroundColor: "transparent", border: "none" },
        input: { backgroundColor: c.inputBg, borderColor: c.borderHover },
      },
      focus: {
        card: { backgroundColor: "transparent", border: "none" },
        input: {
          backgroundColor: c.inputBg,
          borderColor: c.accent,
          outlineColor: c.accent,
        },
      },
      active: {
        card: { backgroundColor: "transparent", border: "none" },
      },
      error: {
        card: { backgroundColor: "transparent", border: "none" },
        input: {
          backgroundColor: c.inputBg,
          borderColor: c.danger,
          color: c.errorText,
        },
      },
    },
  },
});
cardComponent.mount("#card-element");

// Real config from FastSpring product (Lauren Steyn, Slack) - `background`/
// `button` keys, not the `backgroundColor`/`btn` we'd originally guessed
// from the component's raw CSS variable names. The outer panel (`wrap`)
// still can't be styled - confirmed bug, product is removing that panel
// entirely in a future release.
const couponComponent = sdk.components.create("fs-coupon", {
  presentation: "expanded",
  style: {
    state: {
      default: {
        input: {
          background: c.inputBg,
          color: c.text,
          borderColor: c.border,
          borderRadius: "8px",
          placeholderColor: c.placeholder,
        },
        button: {
          background: c.accent,
          color: "#ffffff",
          fontWeight: "700",
          borderRadius: "8px",
        },
        chip: {
          color: c.text,
          iconColor: c.placeholder,
        },
        error: {
          color: c.danger,
        },
        toggle: {
          color: c.accent,
        },
      },
      focus: {
        input: { borderColor: c.accent },
      },
      hover: {
        button: { background: c.accentHover },
        toggle: { color: c.accentHover },
      },
      disabled: {
        button: { background: c.disabledBg },
      },
    },
  },
});
couponComponent.mount("#coupon-element");

const payButtonComponent = sdk.components.create("fs-pay-button", {
  style: {
    state: {
      default: {
        button: {
          backgroundColor: c.accent,
          borderColor: c.accent,
          color: "#ffffff",
          border: "none",
          borderRadius: "8px",
          width: "100%",
          height: "48px",
          fontSize: "15px",
          fontWeight: "700",
          fontFamily: FONT_STACK,
          cursor: "pointer",
        },
      },
      hover: {
        button: { backgroundColor: c.accentHover },
      },
      active: {
        button: { backgroundColor: c.accentActive },
      },
      disabled: {
        button: {
          backgroundColor: c.disabledBg,
          color: c.disabledText,
          border: `1px solid ${c.border}`,
          opacity: "1",
          cursor: "not-allowed",
        },
      },
    },
  },
});
payButtonComponent.mount("#pay-button-element");

const disclosuresComponent = sdk.components.create("fs-disclosures", {
  style: {
    state: {
      default: {
        container: {
          color: c.disclosureText,
          fontFamily: FONT_STACK,
          fontSize: "12px",
        },
        link: { color: c.accent },
      },
      hover: {
        link: { color: c.accentHover },
      },
    },
  },
});
disclosuresComponent.mount("#disclosures-element");

// Mounted last and left unstyled - if Apple Pay isn't available on this
// device/browser, the SDK is expected to hide it on its own (per the
// hide-mapping found in the SDK bundle: {"fs-apple-pay":"hide", ...}).
try {
  const applePayComponent = sdk.components.create("fs-apple-pay", {});
  applePayComponent.mount("#apple-pay-element");
} catch (err) {
  console.warn("fs-apple-pay failed to create/mount", err);
}
