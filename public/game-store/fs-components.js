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

// The SDK doesn't document a style-update API - the reliable way to re-theme
// a mounted component is to tear it down and create it again. Method name
// isn't confirmed by FastSpring's docs, so try the common candidates and
// always fall back to clearing the container directly.
function teardown(component, containerId) {
  if (component) {
    for (const method of ["unmount", "destroy", "remove"]) {
      try {
        if (typeof component[method] === "function") {
          component[method]();
          break;
        }
      } catch {
        // fall through to the DOM clear below
      }
    }
  }
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = "";
}

export function mountComponents(theme) {
  const c = THEMES[theme] || THEMES.dark;

  teardown(cardComponent, "card-element");
  teardown(payButtonComponent, "pay-button-element");
  teardown(disclosuresComponent, "disclosures-element");
  teardown(couponComponent, "coupon-element");

  // TNP-29563 - buyer-facing coupon entry. Backend owns all validation. The
  // iframe posts an internal "applyCoupon" message that the SDK turns into
  // POST {sessionUrl}/cart/coupon, then reloads the session - which is what
  // fires onSessionLoaded in fs-sdk.js. No onEvent option exists on this SDK
  // version (v1.2.0) despite the ticket's spec - the component reads applied/
  // error state straight from the reloaded session itself, entirely inside
  // its own iframe. It does not render a discount amount - that's meant to
  // live in a cart/totals component we don't have here, so applying a code
  // won't move the price shown above the modal.
  couponComponent = sdk.components.create("fs-coupon", {
    presentation: "expanded",
    style: {
      state: {
        default: {
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
          button: {
            backgroundColor: "transparent",
            color: c.accent,
            border: "none",
            fontFamily: FONT_STACK,
            fontSize: "14px",
            fontWeight: "700",
          },
          chip: {
            backgroundColor: c.inputBg,
            color: c.text,
            borderRadius: "999px",
            padding: "6px 12px",
            fontFamily: FONT_STACK,
            fontSize: "13px",
          },
          error: {
            color: c.danger,
            fontSize: "12px",
          },
          toggle: {
            color: c.accent,
            fontFamily: FONT_STACK,
            fontSize: "14px",
          },
        },
        hover: {
          input: {
            borderColor: c.borderHover,
          },
          button: {
            color: c.accentHover,
          },
        },
        focus: {
          input: {
            borderColor: c.accent,
            outlineColor: c.accent,
          },
        },
      },
    },
  });
  couponComponent.mount("#coupon-element");

  cardComponent = sdk.components.create("fs-card", {
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
  });
  cardComponent.mount("#card-element");

  payButtonComponent = sdk.components.create("fs-pay-button", {
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
  });
  payButtonComponent.mount("#pay-button-element");

  disclosuresComponent = sdk.components.create("fs-disclosures", {
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
  });
  disclosuresComponent.mount("#disclosures-element");
}

mountComponents(
  document.documentElement.dataset.theme === "light" ? "light" : "dark",
);
