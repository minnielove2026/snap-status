import "./styles.css";
import {
  classifyStatus,
  compareVersions,
  type ChannelRisk,
  type SnapStatus,
} from "./status";

type ChannelInfo = { version: string | null; versions: string[] };
type SnapRecord = {
  name: string;
  title: string;
  storeUrl: string;
  channels: Record<ChannelRisk, ChannelInfo>;
  storeError: string | null;
  upstream: { version: string | null; url: string | null; error: string | null };
};
type DashboardData = {
  generatedAt: string;
  publisher: string;
  count: number;
  snaps: SnapRecord[];
};
type EnrichedSnap = SnapRecord & { status: SnapStatus };
type SortKey = "title" | "status" | ChannelRisk | "upstream";

const risks: ChannelRisk[] = ["stable", "candidate", "beta", "edge"];
const statusOrder: Record<SnapStatus, number> = {
  outdated: 0,
  testing: 1,
  unknown: 2,
  current: 3,
};
const statusLabels: Record<SnapStatus, string> = {
  current: "Current",
  testing: "In testing",
  outdated: "Update needed",
  unknown: "Needs mapping",
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"]/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!,
  );

const safeUrl = (value: string | null): string => {
  if (!value) return "#";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? escapeHtml(url.href) : "#";
  } catch {
    return "#";
  }
};

const relativeTime = (iso: string): string => {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 90) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 90) return formatter.format(minutes, "minute");
  return formatter.format(Math.round(minutes / 60), "hour");
};

const channelCell = (channel: ChannelInfo): string => {
  if (!channel.version) return '<span class="empty">—</span>';
  const variants = channel.versions.length - 1;
  const title = variants > 0 ? ` title="Also: ${escapeHtml(channel.versions.slice(1).join(", "))}"` : "";
  return `<code>${escapeHtml(channel.version)}</code>${
    variants > 0 ? `<span class="variant"${title}>+${variants}</span>` : ""
  }`;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

async function load(): Promise<void> {
  const response = await fetch(`/data.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Data request failed (${response.status})`);
  const data = (await response.json()) as DashboardData;
  const snaps: EnrichedSnap[] = data.snaps.map((snap) => ({
    ...snap,
    status: classifyStatus(
      Object.fromEntries(risks.map((risk) => [risk, snap.channels[risk]?.versions ?? []])),
      snap.upstream.version,
    ),
  }));
  render(data, snaps);
}

function render(data: DashboardData, snaps: EnrichedSnap[]): void {
  let activeStatus: SnapStatus | "all" = "all";
  let search = "";
  let sortKey: SortKey = "status";
  let sortDirection: 1 | -1 = 1;

  const counts = Object.fromEntries(
    (["current", "testing", "outdated", "unknown"] as SnapStatus[]).map((status) => [
      status,
      snaps.filter((snap) => snap.status === status).length,
    ]),
  ) as Record<SnapStatus, number>;

  app!.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/" aria-label="Snap Status home"><span class="brand-mark">S</span><span>SNAP STATUS</span></a>
        <div class="live"><span class="live-dot"></span> Updated ${escapeHtml(relativeTime(data.generatedAt))}</div>
      </div>
    </header>
    <main class="shell">
      <section class="intro">
        <div>
          <p class="eyebrow">MAINTENANCE CONSOLE / ${escapeHtml(data.publisher.toUpperCase())}</p>
          <h1>Release status at a glance.</h1>
          <p class="lede">Stable, candidate, beta and edge channels compared with each project's latest upstream release.</p>
        </div>
        <a class="source-link" href="https://github.com/popey/snap-status" target="_blank" rel="noreferrer">View source <span aria-hidden="true">↗</span></a>
      </section>

      <section class="summary" aria-label="Status summary">
        ${summaryCard("All snaps", data.count, "all")}
        ${summaryCard("Update needed", counts.outdated, "outdated")}
        ${summaryCard("In testing", counts.testing, "testing")}
        ${summaryCard("Needs mapping", counts.unknown, "unknown")}
      </section>

      <section class="panel">
        <div class="toolbar">
          <label class="search"><span class="search-icon" aria-hidden="true">⌕</span><span class="sr-only">Search snaps</span><input id="search" type="search" placeholder="Filter by app or snap name…" autocomplete="off" /></label>
          <div class="filters" aria-label="Filter by status">
            ${filterButton("All", "all", data.count, true)}
            ${filterButton("Current", "current", counts.current)}
            ${filterButton("Testing", "testing", counts.testing)}
            ${filterButton("Outdated", "outdated", counts.outdated)}
            ${filterButton("Unknown", "unknown", counts.unknown)}
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              ${heading("Application", "title")}
              ${heading("Stable", "stable")}
              ${heading("Candidate", "candidate")}
              ${heading("Beta", "beta")}
              ${heading("Edge", "edge")}
              ${heading("Upstream", "upstream")}
              ${heading("Status", "status")}
            </tr></thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
        <div class="panel-footer"><span id="result-count"></span><span>Generated <time datetime="${escapeHtml(data.generatedAt)}">${escapeHtml(new Date(data.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" }))}</time></span></div>
      </section>
    </main>
    <footer><div class="shell footer-inner"><span>Data from Snap Store and upstream release APIs.</span><span>Refreshes hourly.</span></div></footer>
  `;

  const rows = document.querySelector<HTMLTableSectionElement>("#rows")!;
  const resultCount = document.querySelector<HTMLSpanElement>("#result-count")!;

  const drawRows = (): void => {
    const filtered = snaps
      .filter((snap) => activeStatus === "all" || snap.status === activeStatus)
      .filter((snap) => `${snap.title} ${snap.name}`.toLowerCase().includes(search))
      .sort((a, b) => sortSnaps(a, b, sortKey) * sortDirection);

    rows.innerHTML = filtered.length
      ? filtered.map(rowHtml).join("")
      : '<tr><td class="no-results" colspan="7">No snaps match this view.</td></tr>';
    resultCount.textContent = `Showing ${filtered.length} of ${snaps.length} snaps`;

    document.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
      const active = button.dataset.sort === sortKey;
      button.classList.toggle("sorted", active);
      button.setAttribute("aria-sort", active ? (sortDirection === 1 ? "ascending" : "descending") : "none");
      button.querySelector(".sort-arrow")!.textContent = active ? (sortDirection === 1 ? "↑" : "↓") : "↕";
    });
  };

  document.querySelector<HTMLInputElement>("#search")!.addEventListener("input", (event) => {
    search = (event.currentTarget as HTMLInputElement).value.trim().toLowerCase();
    drawRows();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      activeStatus = button.dataset.status as SnapStatus | "all";
      document.querySelectorAll("[data-status]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      drawRows();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-summary]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.querySelector<HTMLButtonElement>(`[data-status="${button.dataset.summary}"]`);
      target?.click();
      document.querySelector(".panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.sort as SortKey;
      if (sortKey === next) sortDirection = sortDirection === 1 ? -1 : 1;
      else {
        sortKey = next;
        sortDirection = 1;
      }
      drawRows();
    });
  });

  drawRows();
  document.querySelector("main")?.setAttribute("aria-busy", "false");
}

function summaryCard(label: string, count: number, status: SnapStatus | "all"): string {
  return `<button class="summary-card summary-${status}" data-summary="${status}"><span>${escapeHtml(label)}</span><strong>${count}</strong><i></i></button>`;
}

function filterButton(label: string, status: SnapStatus | "all", count: number, active = false): string {
  return `<button class="filter ${active ? "active" : ""}" data-status="${status}">${escapeHtml(label)} <span>${count}</span></button>`;
}

function heading(label: string, key: SortKey): string {
  return `<th><button data-sort="${key}" aria-sort="none">${escapeHtml(label)} <span class="sort-arrow" aria-hidden="true">↕</span></button></th>`;
}

function sortSnaps(a: EnrichedSnap, b: EnrichedSnap, key: SortKey): number {
  if (key === "title") return a.title.localeCompare(b.title);
  if (key === "status") {
    return statusOrder[a.status] - statusOrder[b.status] || a.title.localeCompare(b.title);
  }
  if (key === "upstream") {
    const left = a.upstream.version;
    const right = b.upstream.version;
    if (!left || !right) return left ? -1 : right ? 1 : a.title.localeCompare(b.title);
    return compareVersions(left, right);
  }
  const left = a.channels[key]?.version;
  const right = b.channels[key]?.version;
  if (!left || !right) return left ? -1 : right ? 1 : a.title.localeCompare(b.title);
  return compareVersions(left, right);
}

function rowHtml(snap: EnrichedSnap): string {
  const upstream = snap.upstream.version
    ? snap.upstream.url
      ? `<a class="version-link" href="${safeUrl(snap.upstream.url)}" target="_blank" rel="noreferrer"><code>${escapeHtml(snap.upstream.version)}</code> <span aria-hidden="true">↗</span></a>`
      : `<code>${escapeHtml(snap.upstream.version)}</code>`
    : `<span class="empty" title="${escapeHtml(snap.upstream.error ?? "No upstream version")}">—</span>`;
  return `<tr class="row-${snap.status}">
    <td class="app-cell"><a href="${safeUrl(snap.storeUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(snap.title)}</strong><span>${escapeHtml(snap.name)} ↗</span></a></td>
    ${risks.map((risk) => `<td data-label="${risk}">${channelCell(snap.channels[risk])}</td>`).join("")}
    <td data-label="upstream">${upstream}</td>
    <td data-label="status"><span class="status status-${snap.status}"><i></i>${statusLabels[snap.status]}</span></td>
  </tr>`;
}

load().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  app!.innerHTML = `<main class="shell"><div class="error-state"><p class="eyebrow">DATA UNAVAILABLE</p><h1>Could not load snap status.</h1><p>${escapeHtml(message)}</p><button onclick="location.reload()">Try again</button></div></main>`;
});
