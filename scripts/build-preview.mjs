#!/usr/bin/env node
import { PREVIEW_SITE_URL } from "./lib/preview-build.mjs";

process.env.CGS_SITE_URL = PREVIEW_SITE_URL;
process.env.CGS_PREVIEW_BUILD = "true";
await import("./build-site.mjs");
