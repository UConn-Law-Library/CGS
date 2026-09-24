(() => {
  "use strict";

  const API = "https://api.github.com/repos/UConn-Law-Library/CGS/commits";
  const HISTORY = "https://github.com/UConn-Law-Library/CGS/commits/main/";
  const COMMIT_BASE = "https://github.com/UConn-Law-Library/CGS/commit/";
  const params = new URLSearchParams(location.search);

  function integerOption(name, fallback, minimum, maximum) {
    const value = params.get(name);
    if (value === null || !/^[0-9]+$/.test(value)) return fallback;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
  }

  const limit = integerOption("limit", 10, 1, 10);
  const refreshMs = integerOption("refresh", 300, 60, 3600) * 1000;
  const feed = document.querySelector(".feed");
  const status = document.querySelector("#feed-status");
  const list = document.querySelector("#commit-list");
  const footnote = document.querySelector("#feed-footnote");
  if (params.get("compact") === "true") feed.classList.add("compact");

  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" });
  const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  let lastAttempt = 0;
  let inFlight = false;

  function relativeDate(date) {
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const absolute = Math.abs(seconds);
    if (absolute < 60) return "just now";
    if (absolute < 3600) return relativeFormat.format(Math.round(seconds / 60), "minute");
    if (absolute < 86400) return relativeFormat.format(Math.round(seconds / 3600), "hour");
    if (absolute < 604800) return relativeFormat.format(Math.round(seconds / 86400), "day");
    if (absolute < 2629800) return relativeFormat.format(Math.round(seconds / 604800), "week");
    if (absolute < 31557600) return relativeFormat.format(Math.round(seconds / 2629800), "month");
    return relativeFormat.format(Math.round(seconds / 31557600), "year");
  }

  function normalizeCommit(item) {
    if (!item || typeof item !== "object" || !/^[a-f0-9]{40}$/i.test(item.sha)) return null;
    const message = item.commit?.message;
    const author = item.commit?.author;
    const committer = item.commit?.committer;
    if (typeof message !== "string" || typeof author?.name !== "string") return null;
    const firstLine = message.split(/\r?\n/, 1)[0].trim();
    if (!firstLine) return null;
    const rawDate = committer?.date ?? author.date;
    if (typeof rawDate !== "string" || !rawDate.trim()) return null;
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return null;
    const login = typeof item.author?.login === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(item.author.login)
      ? item.author.login : null;
    let avatar = null;
    if (login && typeof item.author.avatar_url === "string") {
      try {
        const url = new URL(item.author.avatar_url);
        if (url.protocol === "https:" && url.hostname === "avatars.githubusercontent.com") avatar = url.href;
      } catch { /* Use the initials fallback. */ }
    }
    return { sha: item.sha, message: firstLine, name: author.name, date, login, avatar };
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function renderCommit(commit) {
    const item = element("li", "commit-item");
    const avatar = element("span", "avatar", commit.name.trim().slice(0, 1).toUpperCase() || "?");
    avatar.setAttribute("aria-hidden", "true");
    if (commit.avatar) {
      const image = element("img");
      image.src = commit.avatar;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove(), { once: true });
      avatar.append(image);
    }

    const body = element("div", "commit-body");
    const title = element("a", "commit-message", commit.message);
    title.href = COMMIT_BASE + commit.sha;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    title.setAttribute("aria-label", `${commit.message} (opens commit on GitHub in a new tab)`);
    title.append(element("span", "external-icon", "↗"));
    title.lastChild.setAttribute("aria-hidden", "true");
    body.append(title);

    const meta = element("div", "commit-meta");
    if (commit.login) {
      const author = element("a", "", commit.name);
      author.href = `https://github.com/${commit.login}`;
      author.target = "_blank";
      author.rel = "noopener noreferrer";
      author.setAttribute("aria-label", `${commit.name} on GitHub (opens in a new tab)`);
      meta.append(author);
    } else {
      meta.append(element("span", "", commit.name));
    }
    meta.append(element("span", "separator", "·"));
    const time = element("time", "", relativeDate(commit.date));
    time.dateTime = commit.date.toISOString();
    time.title = dateFormat.format(commit.date);
    time.setAttribute("aria-label", dateFormat.format(commit.date));
    meta.append(time);
    body.append(meta);

    const sha = element("span", "sha", commit.sha.slice(0, 7));
    sha.title = `Commit ${commit.sha}`;
    item.append(avatar, body, sha);
    return item;
  }

  function showStatus(message, offerHistory = false, preserveList = false) {
    if (!preserveList) {
      list.hidden = true;
      footnote.hidden = true;
    }
    status.classList.toggle("stale", preserveList);
    status.replaceChildren(document.createTextNode(message));
    if (offerHistory) {
      status.append(document.createTextNode(" "));
      const link = element("a", "", "View commits on GitHub");
      link.href = HISTORY;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      status.append(link, document.createTextNode("."));
    }
    status.hidden = false;
  }

  async function load() {
    if (inFlight || document.hidden) return;
    inFlight = true;
    lastAttempt = Date.now();
    if (list.hidden) showStatus("Loading recent commits…");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const url = new URL(API);
      url.search = new URLSearchParams({ sha: "main", per_page: String(limit) }).toString();
      const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", signal: controller.signal });
      if (response.status === 403 || response.status === 429) throw new Error("rate-limit");
      if (!response.ok) throw new Error("request-failed");
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("invalid-response");
      if (data.length === 0) {
        showStatus("No commits are available on the main branch yet.", true);
        return;
      }
      const commits = data.map(normalizeCommit).filter(Boolean).slice(0, limit);
      if (commits.length === 0) throw new Error("invalid-response");
      list.replaceChildren(...commits.map(renderCommit));
      list.hidden = false;
      status.hidden = true;
      footnote.hidden = false;
    } catch (error) {
      if (list.hidden) {
        showStatus(error.message === "rate-limit"
          ? "GitHub’s request limit has been reached. Please try again later."
          : "Recent commits are unavailable right now.", true);
      } else {
        showStatus("Unable to refresh; showing the last loaded commits.", true, true);
      }
    } finally {
      clearTimeout(timeout);
      inFlight = false;
    }
  }

  load();
  setInterval(() => { if (Date.now() - lastAttempt >= refreshMs) load(); }, refreshMs);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastAttempt >= refreshMs) load();
  });
})();
