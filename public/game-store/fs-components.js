import { sdk } from "./fs-sdk.js";

const FONT_STACK =
  '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';

const THEMES = {
  dark: {
    inputBg: "#1a1d27",
    border: "#2a2d3a",
    borderHover: "#3a3d4a",
    text: "#f2f3f7",
    placeholder: "#9296a8",
    accent: "#5b8cff",
    accentHover: "#4577ee",
    accentActive: "#3a63d1",
    danger: "#f87171",
    errorText: "#fecaca",
    disabledBg: "#1a1d27",
    disabledText: "#9296a8",
    disclosureText: "#9296a8",
  },
  light: {
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
  },
};

let cardComponent = null;
let payButtonComponent = null;
let disclosuresComponent = null;
let couponComponent = null;

// TNP-29563 - buyer-facing coupon entry. Backend owns all validation. The
// iframe posts an internal "applyCoupon" message that the SDK turns into
// POST {sessionUrl}/cart/coupon, then reloads the session - which is what
// fires onSessionLoaded in fs-sdk.js. No onEvent option exists on this SDK
// version (v1.2.0) despite the ticket's spec - the component reads applied/
// error state straight from the reloaded session itself, entirely inside
// its own iframe. It does not render a discount amount - that's meant to
// live in a cart/totals component we don't have here, so applying a code
// won't move the price shown above the modal.
//
// Style keys/shape below are from FastSpring product directly (not our own
// guess) - notably `background` rather than `backgroundColor`, and `button`
// rather than the `btn` we'd been guessing from the component's raw CSS
// variable names. No `wrap` key in their example, and confirmed live via
// update() that adding one (with the correct `background` property) still
// does nothing - the outer panel is white regardless of theme and there's
// currently no way to override it. Flagged to product; not a config mistake
// on our end.
function couponOptions(c) {
  return {
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
          input: {
            borderColor: c.accent,
          },
        },
        hover: {
          button: {
            background: c.accentHover,
          },
          toggle: {
            color: c.accentHover,
          },
        },
        disabled: {
          button: {
            background: c.disabledBg,
          },
        },
      },
    },
  };
}

function cardOptions(c) {
  return {
    labelMode: "fixed",
    // We show our own title/price summary above the modal, so the built-in
    // "Payment" header (icon + title) would be redundant.
    hideCardHeader: true,

    style: {
      state: {
        // The SDK's card panel defaults to a light theme on hover/focus/active
        // independently of "default" - every state below repeats the same
        // background/border so nothing leaks through on interaction.
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
          card: {
            backgroundColor: "transparent",
            border: "none",
          },
          input: {
            backgroundColor: c.inputBg,
            borderColor: c.borderHover,
          },
        },
        focus: {
          card: {
            backgroundColor: "transparent",
            border: "none",
          },
          input: {
            backgroundColor: c.inputBg,
            borderColor: c.accent,
            outlineColor: c.accent,
          },
        },
        active: {
          card: {
            backgroundColor: "transparent",
            border: "none",
          },
        },
        error: {
          card: {
            backgroundColor: "transparent",
            border: "none",
          },
          input: {
            backgroundColor: c.inputBg,
            borderColor: c.danger,
            color: c.errorText,
          },
        },
      },
    },
  };
}

function payButtonOptions(c) {
  return {
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
          button: {
            backgroundColor: c.accentHover,
          },
        },
        active: {
          button: {
            backgroundColor: c.accentActive,
          },
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
  };
}

function disclosuresOptions(c) {
  return {
    style: {
      state: {
        default: {
          container: {
            color: c.disclosureText,
            fontFamily: FONT_STACK,
            fontSize: "12px",
          },
          link: {
            color: c.accent,
          },
        },
        hover: {
          link: {
            color: c.accentHover,
          },
        },
      },
    },
  };
}

// Each component instance exposes update(options), which re-sends the whole
// config over postMessage to the already-mounted iframe - confirmed live
// against the real SDK (v1.2.0), despite not being documented anywhere.
// That means re-theming doesn't need a destroy/recreate cycle: mount once,
// then just update() on every theme change.
function mountOrUpdate(component, containerId, type, options) {
  if (component) {
    component.update(options);
    return component;
  }
  const created = sdk.components.create(type, options);
  created.mount(`#${containerId}`);
  return created;
}

export function mountComponents(theme) {
  const c = THEMES[theme] || THEMES.dark;

  couponComponent = mountOrUpdate(
    couponComponent,
    "coupon-element",
    "fs-coupon",
    couponOptions(c),
  );
  cardComponent = mountOrUpdate(
    cardComponent,
    "card-element",
    "fs-card",
    cardOptions(c),
  );
  payButtonComponent = mountOrUpdate(
    payButtonComponent,
    "pay-button-element",
    "fs-pay-button",
    payButtonOptions(c),
  );
  disclosuresComponent = mountOrUpdate(
    disclosuresComponent,
    "disclosures-element",
    "fs-disclosures",
    disclosuresOptions(c),
  );
}

mountComponents(
  document.documentElement.dataset.theme === "light" ? "light" : "dark",
);
