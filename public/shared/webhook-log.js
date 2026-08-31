// Live feed of FastSpring webhook events, piped from the server over SSE
// (/api/webhooks/stream). Mounts a compact toggle + scrollable dropdown into
// any element with id="webhook-log-root".
//
// Pages can call `webhookLog.expect(matchFn, label)` right before an action
// that should produce a webhook (a charge, a cancel, an authorization) so
// the matching event gets pinned and highlighted instead of blending into
// the account-wide feed - the feed shows every webhook on the account, not
// just the ones this tab caused.

const MAX_EVENTS = 50;
const EXPECT_TIMEOUT_MS = 20000;

const CATEGORY_BY_KEYWORD = [
  [/failed|chargeback/, "danger"],
  [/completed|activated/, "success"],
  [/canceled|deactivated|overdue/, "warn"],
];

function categoryFor(type) {
  const hit = CATEGORY_BY_KEYWORD.find(([re]) => re.test(type));
  return hit ? hit[1] : "neutral";
}

function relativeTime(ms) {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function shortDetail(event) {
  const d = event.data || {};
  return d.id || d.subscription || d.account || d.order || "";
}

class WebhookLog {
  constructor(root) {
    this.root = root;
    this.events = [];
    this.expandedIds = new Set();
    this.pending = null; // { match, label, timeoutId }
    this.open = false;
    this.unseen = 0;
    this.render();
    this.connect();
  }

  render() {
    this.root.innerHTML = "";
    this.root.classList.add("wh-log");

    this.toggleBtn = document.createElement("button");
    this.toggleBtn.type = "button";
    this.toggleBtn.className = "wh-toggle";
    this.toggleBtn.innerHTML =
      '<span class="wh-dot" data-state="connecting"></span>' +
      "<span>Webhooks</span>" +
      '<span class="wh-count" hidden></span>';
    this.dotEl = this.toggleBtn.querySelector(".wh-dot");
    this.countEl = this.toggleBtn.querySelector(".wh-count");
    this.toggleBtn.addEventListener("click", () => this.setOpen(!this.open));

    this.panel = document.createElement("div");
    this.panel.className = "wh-panel";

    const header = document.createElement("div");
    header.className = "wh-panel-header";
    const headerLabel = document.createElement("span");
    headerLabel.textContent = "Webhook activity";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "wh-clear";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      this.events = [];
      this.expandedIds.clear();
      this.renderList();
    });
    header.append(headerLabel, clearBtn);

    this.listEl = document.createElement("div");
    this.listEl.className = "wh-list";

    this.panel.append(header, this.listEl);
    this.root.append(this.toggleBtn, this.panel);
    this.renderList();

    document.addEventListener("click", (e) => {
      if (this.open && !this.root.contains(e.target)) this.setOpen(false);
    });
  }

  setOpen(open) {
    this.open = open;
    this.panel.classList.toggle("wh-panel-open", open);
    if (open) {
      this.unseen = 0;
      this.updateCount();
      this.renderList();
    }
  }

  connect() {
    const source = new EventSource("/api/webhooks/stream");
    source.onopen = () => this.setConnectionState("connected");
    source.onerror = () => this.setConnectionState("error");
    source.onmessage = (msg) => {
      try {
        this.handleEvent(JSON.parse(msg.data));
      } catch {
        // ignore malformed frames
      }
    };
  }

  setConnectionState(state) {
    this.dotEl.dataset.state = state;
  }

  handleEvent(event) {
    this.setConnectionState("connected");
    const receivedAt = Date.now();
    const isMatch = Boolean(this.pending && this.pending.match(event));

    this.events.unshift({ event, receivedAt, matched: isMatch });
    this.events.length = Math.min(this.events.length, MAX_EVENTS);

    if (isMatch) {
      clearTimeout(this.pending.timeoutId);
      this.pending = null;
      this.setOpen(true);
    } else if (!this.open) {
      this.unseen += 1;
    }

    this.updateCount();
    this.renderList();
  }

  updateCount() {
    if (this.unseen > 0) {
      this.countEl.hidden = false;
      this.countEl.textContent = String(this.unseen);
    } else {
      this.countEl.hidden = true;
    }
  }

  // Arms a one-shot match for the next relevant webhook. Silently expires
  // after 20s - the event may just not have landed yet (FastSpring can
  // queue/batch these), the raw feed below still shows it whenever it does.
  expect(match, label) {
    if (this.pending) clearTimeout(this.pending.timeoutId);
    const timeoutId = setTimeout(() => {
      if (this.pending?.label === label) {
        this.pending = null;
        this.renderList();
      }
    }, EXPECT_TIMEOUT_MS);
    this.pending = { match, label, timeoutId };
    this.renderList();
  }

  renderList() {
    this.listEl.innerHTML = "";

    if (this.pending) {
      const waiting = document.createElement("div");
      waiting.className = "wh-waiting";
      waiting.innerHTML = `<span class="spinner wh-spinner"></span> Waiting for ${this.pending.label}…`;
      this.listEl.appendChild(waiting);
    }

    if (this.events.length === 0 && !this.pending) {
      const empty = document.createElement("div");
      empty.className = "wh-empty";
      empty.textContent = "No webhook events yet.";
      this.listEl.appendChild(empty);
      return;
    }

    this.events.forEach(({ event, receivedAt, matched }) => {
      const row = document.createElement("div");
      row.className = `wh-row wh-cat-${categoryFor(event.type)}${matched ? " wh-matched" : ""}`;

      const summary = document.createElement("div");
      summary.className = "wh-row-summary";
      const typeEl = document.createElement("span");
      typeEl.className = "wh-row-type";
      typeEl.textContent = event.type;
      const timeEl = document.createElement("span");
      timeEl.className = "wh-row-time";
      timeEl.textContent = relativeTime(receivedAt);
      summary.append(typeEl, timeEl);

      const meta = document.createElement("div");
      meta.className = "wh-row-meta";
      meta.textContent = shortDetail(event);

      const detail = document.createElement("pre");
      detail.className = "wh-row-detail";
      detail.textContent = JSON.stringify(event, null, 2);
      detail.hidden = !this.expandedIds.has(event.id);

      row.append(summary, meta, detail);
      row.addEventListener("click", () => {
        if (this.expandedIds.has(event.id)) {
          this.expandedIds.delete(event.id);
        } else {
          this.expandedIds.add(event.id);
        }
        detail.hidden = !this.expandedIds.has(event.id);
      });

      this.listEl.appendChild(row);
    });
  }
}

export function mountWebhookLog(rootId = "webhook-log-root") {
  const root = document.getElementById(rootId);
  if (!root) return null;
  const instance = new WebhookLog(root);
  window.webhookLog = instance;
  return instance;
}

mountWebhookLog();
