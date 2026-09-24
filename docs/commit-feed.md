# CGS commit feed for Confluence

The standalone widget lives in `public/commit-feed/`. The existing Pages build copies that directory to `dist/commit-feed/`, so after deployment from `main` its URL is:

https://uconn-law-library.github.io/CGS/commit-feed/

It requests the latest 10 `main` commits from GitHub's public REST API when opened and every five minutes while visible. It uses no credentials. Each commit links to GitHub and shows the subject, author, local relative time (with full time on hover or for assistive technology), and short SHA. A linked GitHub author gets an avatar when available; otherwise the feed displays an initial. If GitHub cannot be reached or the response is unusable, the feed offers a link to the full history.

## Embed in Confluence

1. Deploy the repository's `main` branch through the existing GitHub Pages workflow, then open the URL above directly to confirm the feed loads.
2. Edit the Confluence page and insert the **iFrame** macro (search for `/iframe` in Confluence Cloud).
3. Set its URL to the widget URL. Use the page's full-width layout where practical.
4. Set a width near **800 px** (or the available page width) and a height of **1000 px** for 10 commits. At roughly 320 px wide, allow around **1200 px**. In a narrow column, use `?limit=5&compact=true` and begin with **600 px** of height. Adjust the height after viewing real commit subjects; long subjects wrap and increase it.
5. Set the macro's border to **hide** and scrolling to **auto**, then publish and check the result at desktop and mobile widths.

Confluence Cloud's iFrame macro exposes fixed pixel height and width settings, not automatic height adjustment. The widget itself has no fixed height. If your Confluence site does not permit the iFrame macro or the embed appears blank, ask a site administrator to check iframe policy and the page's browser console. A direct link to the widget or GitHub history is a usable fallback. This site's own files do not set a frame-blocking policy; the response headers served by GitHub Pages and the particular Confluence site must be confirmed in the deployed environment. GitHub repository pages and GitHub Pages sites are different hosts.

## URL options

| Parameter | Allowed values | Default |
| --- | --- | --- |
| `limit` | 1–10 commits | 10 |
| `compact` | `true` for tighter spacing | standard |
| `refresh` | 60–3600 seconds | 300 seconds |

Invalid values use the defaults. The feed skips scheduled requests while the browser tab is hidden and catches up after it becomes visible. GitHub limits unauthenticated REST API requests by originating IP address; a shared office IP can therefore reach its limit even if individual staff view the feed infrequently. The feed requests no extra per-commit details. `public/commit-feed/` has separate CSS and JavaScript and does not change the main CGS application.
