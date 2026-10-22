import { sdk } from "./fs-sdk-ibm.js";

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Helvetica, Arial, sans-serif';

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
  // Matched to the HCP billing portal: white inputs, neutral grey borders,
  // HCP primary blue for focus and the pay button.
  light: {
    inputBg: "#ffffff",
    border: "#c2c5cb",
    borderHover: "#8c909c",
    text: "#0c0c0e",
    placeholder: "#656a76",
    accent: "#1060ff",
    accentHover: "#0c56e9",
    accentActive: "#0046d1",
    danger: "#c00005",
    errorText: "#8f0004",
    disabledBg: "#f1f2f3",
    disabledText: "#8c909c",
    disclosureText: "#656a76",
  },
};

let emailComponent = null;
let googlePayComponent = null;
let applePayComponent = null;
let cardComponent = null;
let payButtonComponent = null;
let disclosuresComponent = null;

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

function createWallet(type, containerId, options) {
  try {
    const component = sdk.components.create(type, options);
    component.mount(`#${containerId}`);
    return component;
  } catch (err) {
    console.warn(`${type} not available here`, err);
    return null;
  }
}

export function mountComponents(theme) {
  const c = THEMES[theme] || THEMES.dark;

  teardown(emailComponent, "email-element");
  teardown(googlePayComponent, "google-pay-element");
  teardown(applePayComponent, "apple-pay-element");
  teardown(cardComponent, "card-element");
  teardown(payButtonComponent, "pay-button-element");
  teardown(disclosuresComponent, "disclosures-element");

  // Email shows first, like the embedded checkout did. If the session was
  // created with the logged-in user's email it renders locked/read-only;
  // without one it's editable and collects it.
  emailComponent = sdk.components.create("fs-email", {
    fields: { email: "auto" },
    labelMode: "fixed",
    hideEmailHeader: true,
    style: {
      state: {
        default: {
          email: {
            backgroundColor: "transparent",
            borderRadius: "0",
            padding: "0",
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

  // Wallet buttons, same setup as the game store. Google Pay only takes a
  // brand-locked dark/light variant plus button geometry. fs-apple-pay
  // throws on create() when the browser/device doesn't support Apple Pay, so
  // each wallet is guarded and a failure just leaves its slot empty.
  googlePayComponent = createWallet("fs-google-pay", "google-pay-element", {
    // fs-google-pay variants are "black" (default) | "white".
    variant: "black",
    style: {
      state: {
        default: {
          button: {
            height: "48px",
            borderRadius: "8px",
          },
        },
      },
    },
  });
  applePayComponent = createWallet("fs-apple-pay", "apple-pay-element", {});

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

// The HCP portal is light-only, so this page always mounts the light theme.
mountComponents("light");
